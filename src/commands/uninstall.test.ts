import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { uninstallCommand } from './uninstall.js';
import { upsertSkill, readSkillLock } from '../lib/skill-lock.js';
import type { ConfigFile } from '../types/config.js';
import type { SkillLockEntry } from '../types/lock.js';

// 测试注入的 config,each test 设置 installRoot
let fakeConfig: ConfigFile;

vi.mock('../lib/config.js', () => ({
    loadConfig: vi.fn(async () => fakeConfig),
    getInstallRoot: (config: ConfigFile) => config.installRoot,
}));

vi.mock('../agents/index.js', () => ({
    listAvailable: () => [],
    getAgent: () => undefined,
}));

let workDir: string;
let installRoot: string;
let lockPath: string;

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skkill-uninstall-'));
    installRoot = path.join(workDir, 'skills');
    lockPath = path.join(workDir, '.skill-lock.json');
    fakeConfig = { version: 1, installRoot };
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
    vi.clearAllMocks();
});

const sampleEntry = (name: string): SkillLockEntry => ({
    name,
    source: name,
    sourceType: 'local',
    sourceUrl: `file:///tmp/${name}`,
    backend: 'git',
    installedAt: '2026-06-25T00:00:00.000Z',
});

describe('uninstallCommand', () => {
    it('删除 skill 目录 + 同步删 lock entry', async () => {
        // 准备已装 skill + lock
        const skillDir = path.join(installRoot, 'doomed');
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# bye');
        await upsertSkill(sampleEntry('doomed'), lockPath);
        // 旁边再装一个,验证它不会被误删
        await upsertSkill(sampleEntry('keep-me'), lockPath);

        await uninstallCommand('doomed', { lockPath });

        // skill 目录被删
        const stat = await fs.stat(skillDir).catch(() => null);
        expect(stat).toBeNull();
        // lock entry 删
        const lock = await readSkillLock(lockPath);
        expect(lock.skills['doomed']).toBeUndefined();
        // 邻居还在
        expect(lock.skills['keep-me']).toBeDefined();
    });

    it('skill 目录不存在时也不抛错 (lock entry 仍尝试删)', async () => {
        // 只写 lock,不建目录
        await upsertSkill(sampleEntry('ghost'), lockPath);

        await expect(uninstallCommand('ghost', { lockPath })).resolves.toBeUndefined();

        const lock = await readSkillLock(lockPath);
        expect(lock.skills['ghost']).toBeUndefined();
    });
});
