import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { installSkill } from './installer.js';
import type { ConfigFile } from '../types/config.js';
import type { ResolvedSource, FetchResult, SkillBackend } from '../types/backend.js';

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
let config: ConfigFile;

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skkill-install-'));
    installRoot = path.join(workDir, 'skills');
    config = { version: 1, installRoot };
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

describe('installSkill', () => {
    it('fetches, copies, and writes manifest for new install', async () => {
        const backend = new FakeBackend({ skillPath: '' });
        const skill = await installSkill('my-skill', config, { backend });

        expect(skill.name).toBe('my-skill');
        expect(skill.path).toBe(path.join(installRoot, 'my-skill'));
        expect(skill.packageJson.name).toBe('my-skill');
        // ensureManifest 自动生成时使用 '0.1.0' (后端返回的 version 没合并进 package.json)
        expect(skill.packageJson.version).toBe('0.1.0');
        expect(backend.fetchCalls).toBe(1);

        // 文件确实落地
        const skillMd = await fs.readFile(path.join(skill.path, 'SKILL.md'), 'utf-8');
        expect(skillMd).toContain('test skill');
    });

    it('copies .skill-meta.json from onetool source', async () => {
        const backend = new FakeBackend({
            skillPath: '',
            meta: { skill_id: '866', namespace: 'someone', version: '1.0.1' },
        });
        const skill = await installSkill('my-skill', config, { backend });
        const metaRaw = await fs.readFile(path.join(skill.path, '.skill-meta.json'), 'utf-8');
        expect(JSON.parse(metaRaw)).toMatchObject({ skill_id: '866', namespace: 'someone' });
    });

    it('is idempotent: re-install reuses existing version (re-fetches but does not overwrite)', async () => {
        const backend = new FakeBackend({ skillPath: '' });
        // 第一次装
        const first = await installSkill('my-skill', config, { backend });
        // 改 package.json 模拟 owner 改了
        await fs.writeFile(
            path.join(first.path, 'package.json'),
            JSON.stringify({ name: 'my-skill', version: '9.9.9' })
        );
        // 第二次装 (同名, 同 backend) — fetch 仍会跑(无法跳过),但已装版本被 reuse
        const second = await installSkill('my-skill', config, { backend });
        // 复用了已装版本,而不是 fetch 后的新 generated version
        expect(second.packageJson.version).toBe('9.9.9');
        // destPath 文件没被覆盖 — 改的 9.9.9 还在
        const pkgOnDisk = JSON.parse(await fs.readFile(path.join(second.path, 'package.json'), 'utf-8'));
        expect(pkgOnDisk.version).toBe('9.9.9');
    });

    it('uses opts.destName to override directory name', async () => {
        const backend = new FakeBackend({ skillPath: '' });
        const skill = await installSkill('my-skill', config, { backend, destName: 'renamed' });
        expect(skill.name).toBe('renamed');
        expect(skill.path).toBe(path.join(installRoot, 'renamed'));
    });

    it('cleans up the temp dir even when fetch throws', async () => {
        const backend = new FakeBackend({ skillPath: '' });
        backend.failOnFetch = true;
        // 抓 backend.fetch throw 时,installer 应该冒泡错误且不污染 installRoot
        await expect(installSkill('my-skill', config, { backend })).rejects.toThrow(/simulated/);
        const exists = await fs
            .stat(installRoot)
            .then(() => true)
            .catch(() => false);
        // installRoot 可能被 ensureDir 创建了,但里面没有 skill 目录
        if (exists) {
            const entries = await fs.readdir(installRoot);
            expect(entries.filter(e => e === 'my-skill')).toEqual([]);
        }
    });
});
