import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { installSkill, upgradeSkill } from './installer.js';
import { readSkillLock, upsertSkill } from './skill-lock.js';
import type { ConfigFile } from '../types/config.js';
import type { ResolvedSource, FetchResult, SkillBackend } from '../types/backend.js';
import type { SkillLockEntry } from '../types/lock.js';

// 构造一个可注入的 fake backend,避开真网络
class FakeBackend implements SkillBackend {
    readonly id = 'fake';
    readonly displayName = 'Fake';
    fetchCalls = 0;
    failOnFetch = false;
    fetchSkillPath: string;
    fetchMeta: Record<string, unknown> | undefined;
    resolvedFor: string | undefined;

    constructor(opts: { skillPath: string; meta?: Record<string, unknown> }) {
        this.fetchSkillPath = opts.skillPath;
        this.fetchMeta = opts.meta;
    }

    async available(): Promise<{ ok: boolean }> {
        return { ok: true };
    }
    async search(): Promise<never[]> {
        return [];
    }
    async resolve(ref: string): Promise<ResolvedSource> {
        this.resolvedFor = ref;
        return { ref, kind: 'registry', package: ref, downloadUrl: 'https://fake/x.zip' };
    }
    async fetch(_source: ResolvedSource, destDir: string): Promise<FetchResult> {
        this.fetchCalls++;
        if (this.failOnFetch) throw new Error('simulated fetch failure');
        // 模拟 backend 把 skill 写到 destDir/<name>
        const target = path.join(destDir, 'my-skill');
        await fs.mkdir(target, { recursive: true });
        await fs.writeFile(
            path.join(target, 'SKILL.md'),
            '---\nname: my-skill\ndescription: test skill\n---\n# body\n'
        );
        if (this.fetchMeta) {
            await fs.writeFile(path.join(target, '.skill-meta.json'), JSON.stringify(this.fetchMeta));
        }
        return { skillPath: target, version: '1.2.3' };
    }
    async upgrade(): Promise<{ from: string; to: string }> {
        return { from: '1.0.0', to: '1.0.1' };
    }
}

let workDir: string;
let installRoot: string;
let lockPath: string;
let config: ConfigFile;

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skkill-install-'));
    installRoot = path.join(workDir, 'skills');
    lockPath = path.join(workDir, '.skill-lock.json');
    config = { version: 1, installRoot };
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

describe('installSkill', () => {
    it('fetches, copies, and writes manifest for new install', async () => {
        const backend = new FakeBackend({ skillPath: '' });
        const skill = await installSkill('my-skill', config, { backend, lockPath });

        expect(skill.name).toBe('my-skill');
        expect(skill.path).toBe(path.join(installRoot, 'my-skill'));
        expect(skill.packageJson.name).toBe('my-skill');
        // ensureManifest 自动生成时使用 '0.1.0' (后端返回的 version 没合并进 package.json)
        expect(skill.packageJson.version).toBe('0.1.0');
        expect(backend.fetchCalls).toBe(1);

        // 文件确实落地
        const skillMd = await fs.readFile(path.join(skill.path, 'SKILL.md'), 'utf-8');
        expect(skillMd).toContain('test skill');

        // lock entry 写入: name / source / backend / sourceUrl / installedAt 齐全
        const lock = await readSkillLock(lockPath);
        const entry = lock.skills['my-skill'];
        expect(entry).toBeDefined();
        expect(entry?.backend).toBe('fake');
        expect(entry?.source).toBe('my-skill');
        expect(entry?.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('copies .skill-meta.json from onetool source', async () => {
        const backend = new FakeBackend({
            skillPath: '',
            meta: { skill_id: '866', namespace: 'someone', version: '1.0.1' },
        });
        const skill = await installSkill('my-skill', config, { backend, lockPath });
        const metaRaw = await fs.readFile(path.join(skill.path, '.skill-meta.json'), 'utf-8');
        expect(JSON.parse(metaRaw)).toMatchObject({ skill_id: '866', namespace: 'someone' });
    });

    it('is idempotent: re-install reuses existing version (re-fetches but does not overwrite)', async () => {
        const backend = new FakeBackend({ skillPath: '' });
        // 第一次装
        const first = await installSkill('my-skill', config, { backend, lockPath });
        const lockAfterFirst = await readSkillLock(lockPath);
        const installedAtFirst = lockAfterFirst.skills['my-skill']?.installedAt;
        // 改 package.json 模拟 owner 改了
        await fs.writeFile(
            path.join(first.path, 'package.json'),
            JSON.stringify({ name: 'my-skill', version: '9.9.9' })
        );
        // 第二次装 (同名, 同 backend) — fetch 仍会跑(无法跳过),但已装版本被 reuse
        const second = await installSkill('my-skill', config, { backend, lockPath });
        // 复用了已装版本,而不是 fetch 后的新 generated version
        expect(second.packageJson.version).toBe('9.9.9');
        // destPath 文件没被覆盖 — 改的 9.9.9 还在
        const pkgOnDisk = JSON.parse(await fs.readFile(path.join(second.path, 'package.json'), 'utf-8'));
        expect(pkgOnDisk.version).toBe('9.9.9');
        // 幂等再装时,installedAt 不应被刷新
        const lockAfterSecond = await readSkillLock(lockPath);
        expect(lockAfterSecond.skills['my-skill']?.installedAt).toBe(installedAtFirst);
    });

    it('uses opts.destName to override directory name', async () => {
        const backend = new FakeBackend({ skillPath: '' });
        const skill = await installSkill('my-skill', config, { backend, destName: 'renamed', lockPath });
        expect(skill.name).toBe('renamed');
        expect(skill.path).toBe(path.join(installRoot, 'renamed'));
    });

    it('cleans up the temp dir even when fetch throws', async () => {
        const backend = new FakeBackend({ skillPath: '' });
        backend.failOnFetch = true;
        // 抓 backend.fetch throw 时,installer 应该冒泡错误且不污染 installRoot
        await expect(installSkill('my-skill', config, { backend, lockPath })).rejects.toThrow(/simulated/);
        const exists = await fs
            .stat(installRoot)
            .then(() => true)
            .catch(() => false);
        // installRoot 可能被 ensureDir 创建了,但里面没有 skill 目录
        if (exists) {
            const entries = await fs.readdir(installRoot);
            expect(entries.filter(e => e === 'my-skill')).toEqual([]);
        }
        // fetch 失败时不应写 lock
        const lock = await readSkillLock(lockPath);
        expect(lock.skills['my-skill']).toBeUndefined();
    });
});

// upgradeSkill 三分支测试: 已是最新 / 有更新 / 降级到 git pull
// 用 vi.mock 替换 checkUpdate + fetchSkillFolderHash + pickDefaultBackend,避开真 GitHub API
vi.mock('./skill-upgrade.js', async importOriginal => {
    const actual = await importOriginal<typeof import('./skill-upgrade.js')>();
    return {
        ...actual,
        // 默认返回 null,避免污染 installSkill baseline 算 hash 那条路;具体 test 里按需 override
        checkUpdate: vi.fn(),
        fetchSkillFolderHash: vi.fn().mockResolvedValue(null),
    };
});
vi.mock('../backends/index.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../backends/index.js')>();
    return {
        ...actual,
        pickDefaultBackend: vi.fn(),
    };
});

import { checkUpdate, fetchSkillFolderHash } from './skill-upgrade.js';
import { pickDefaultBackend } from '../backends/index.js';

// 构造一个已装好的 skill + lock entry,供 upgradeSkill 三个分支复用
async function seedInstalledSkill(
    name: string,
    overrides: Partial<SkillLockEntry> = {}
): Promise<void> {
    const skillPath = path.join(installRoot, name);
    await fs.mkdir(skillPath, { recursive: true });
    await fs.writeFile(
        path.join(skillPath, 'package.json'),
        JSON.stringify({ name, version: '1.0.0' }, null, 2)
    );
    const entry: SkillLockEntry = {
        name,
        source: name,
        sourceType: 'git',
        sourceUrl: 'https://github.com/owner/repo',
        backend: 'git',
        installedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
    await upsertSkill(entry, lockPath);
}

describe('upgradeSkill', () => {
    beforeEach(() => {
        vi.mocked(checkUpdate).mockReset();
        vi.mocked(fetchSkillFolderHash).mockReset();
        vi.mocked(pickDefaultBackend).mockReset();
    });
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('已是最新: 仅刷新 upgradedAt,不调 backend.upgrade', async () => {
        await seedInstalledSkill('up-to-date', { skillFolderHash: 'h-baseline' });
        vi.mocked(checkUpdate).mockResolvedValue({ updateAvailable: false, latestHash: 'h-baseline' });

        const fake = new FakeBackend({ skillPath: '' });
        vi.mocked(pickDefaultBackend).mockResolvedValue(fake);

        const result = await upgradeSkill('up-to-date', config, { lockPath });

        expect(result.from).toBe('h-baseline');
        expect(result.to).toBe('h-baseline');
        // backend.upgrade 不应被调
        expect(fake.fetchCalls).toBe(0);
        // lock entry 的 upgradedAt 应该被写入
        const lock = await readSkillLock(lockPath);
        expect(lock.skills['up-to-date']?.upgradedAt).toMatch(/^\d{4}-/);
        // skillFolderHash 不变
        expect(lock.skills['up-to-date']?.skillFolderHash).toBe('h-baseline');
    });

    it('有更新: 调 backend.upgrade + 重算 hash 写回 lock', async () => {
        await seedInstalledSkill('has-update', { skillFolderHash: 'old-hash' });
        vi.mocked(checkUpdate).mockResolvedValue({ updateAvailable: true, latestHash: 'new-hash' });
        vi.mocked(fetchSkillFolderHash).mockResolvedValue('new-hash-actual');

        const fake = new FakeBackend({ skillPath: '' });
        // FakeBackend.upgrade 返回 {from:'1.0.0', to:'1.0.1'},直接复用
        vi.mocked(pickDefaultBackend).mockResolvedValue(fake);

        const result = await upgradeSkill('has-update', config, { lockPath });

        expect(result.from).toBe('1.0.0');
        expect(result.to).toBe('1.0.1');
        // 重算 hash 调过一次
        expect(fetchSkillFolderHash).toHaveBeenCalledTimes(1);
        // lock entry 的 skillFolderHash 应该是重算的新 hash
        const lock = await readSkillLock(lockPath);
        expect(lock.skills['has-update']?.skillFolderHash).toBe('new-hash-actual');
        expect(lock.skills['has-update']?.upgradedAt).toMatch(/^\d{4}-/);
    });

    it('降级 (checkUpdate 返回 null): 走 backend.upgrade,只刷 upgradedAt', async () => {
        await seedInstalledSkill('degraded', { skillFolderHash: 'h' });
        vi.mocked(checkUpdate).mockResolvedValue(null);

        const fake = new FakeBackend({ skillPath: '' });
        vi.mocked(pickDefaultBackend).mockResolvedValue(fake);

        const result = await upgradeSkill('degraded', config, { lockPath });

        // 走 git pull 路径,from/to 来自 FakeBackend.upgrade
        expect(result.from).toBe('1.0.0');
        expect(result.to).toBe('1.0.1');
        // 没 updateAvailable 信息,不重算 hash
        expect(fetchSkillFolderHash).not.toHaveBeenCalled();
        // lock entry 的 upgradedAt 应该被写入
        const lock = await readSkillLock(lockPath);
        expect(lock.skills['degraded']?.upgradedAt).toMatch(/^\d{4}-/);
    });

    it('未安装抛 E_NOT_INSTALLED', async () => {
        await expect(upgradeSkill('never-installed', config, { lockPath })).rejects.toThrow();
    });
});
