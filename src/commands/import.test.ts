import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import matter from 'gray-matter';
import { importCommand } from './import.js';
import { readSkillLock } from '../lib/skill-lock.js';
import { SkitError } from '../utils/logger.js';
import type { ConfigFile } from '../types/config.js';

let workDir: string;
let sourceDir: string;
let installRoot: string;
let lockPath: string;
let config: ConfigFile;

const SKILL_MD = (name: string, desc: string) =>
    `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\n`;

async function writeSourceSkill(name: string, desc = 'demo skill'): Promise<string> {
    const dir = path.join(sourceDir, name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'), SKILL_MD(name, desc), 'utf-8');
    return dir;
}

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skkill-import-'));
    sourceDir = path.join(workDir, 'src');
    installRoot = path.join(workDir, 'skills');
    lockPath = path.join(workDir, '.skill-lock.json');
    config = { version: 1, installRoot };
    await fs.mkdir(sourceDir, { recursive: true });
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

describe('importCommand', () => {
    it('moves source dir into installRoot, generates package.json, writes lock', async () => {
        const src = await writeSourceSkill('my-skill', 'demo');
        const { skillPath, name } = await importCommand(src, { config, lockPath });

        expect(name).toBe('my-skill');
        expect(skillPath).toBe(path.join(installRoot, 'my-skill'));

        // 源已被 mv 走
        await expect(fs.access(src)).rejects.toThrow();

        // 目标有 SKILL.md
        const raw = await fs.readFile(path.join(skillPath, 'SKILL.md'), 'utf-8');
        expect(matter(raw).data.name).toBe('my-skill');

        // package.json 自动生成
        const pkg = JSON.parse(await fs.readFile(path.join(skillPath, 'package.json'), 'utf-8'));
        expect(pkg.name).toBe('my-skill');
        expect(pkg.version).toBe('0.1.0');
        expect(pkg.skkill?.installedAt).toMatch(/^\d{4}-/);
        expect(pkg.skkill?.source).toBe(`file://${src}`);

        // lock 写入
        const lock = await readSkillLock(lockPath);
        expect(lock.skills['my-skill']).toBeDefined();
        expect(lock.skills['my-skill']?.sourceType).toBe('local');
        expect(lock.skills['my-skill']?.backend).toBe('git');
    });

    it('rejects source without SKILL.md', async () => {
        const badDir = path.join(sourceDir, 'no-skill-md');
        await fs.mkdir(badDir, { recursive: true });
        await expect(importCommand(badDir, { config, lockPath })).rejects.toThrow(SkitError);
        await expect(importCommand(badDir, { config, lockPath })).rejects.toThrow(/SKILL\.md/);
        // 源应未被改动
        await expect(fs.access(badDir)).resolves.toBeUndefined();
    });

    it('rejects when destination is a real directory', async () => {
        const src = await writeSourceSkill('taken');
        // 预创建目标真目录
        await fs.mkdir(path.join(installRoot, 'taken'), { recursive: true });
        await expect(importCommand(src, { config, lockPath })).rejects.toMatchObject({
            code: 'E_ALREADY_INSTALLED',
        });
        // 源应未动
        await expect(fs.access(src)).resolves.toBeUndefined();
    });

    it('replaces destination when it is a symlink', async () => {
        const src = await writeSourceSkill('linked-skill');
        // 预创建 installRoot 和 symlink (link 命令创建的软链接)
        await fs.mkdir(installRoot, { recursive: true });
        const realTarget = path.join(workDir, 'some-other-skill');
        await fs.mkdir(realTarget, { recursive: true });
        await fs.symlink(realTarget, path.join(installRoot, 'linked-skill'));
        const { skillPath } = await importCommand(src, { config, lockPath });
        expect(skillPath).toBe(path.join(installRoot, 'linked-skill'));
        // 目标现在是真目录, 不再是 symlink
        const stat = await fs.lstat(skillPath);
        expect(stat.isSymbolicLink()).toBe(false);
        expect(stat.isDirectory()).toBe(true);
        // 原 symlink target 应未动
        await expect(fs.access(realTarget)).resolves.toBeUndefined();
    });

    it('rejects source inside installRoot (no nesting)', async () => {
        const nested = path.join(installRoot, 'already-managed');
        await fs.mkdir(nested, { recursive: true });
        await fs.writeFile(path.join(nested, 'SKILL.md'), SKILL_MD('already-managed'), 'utf-8');
        await expect(importCommand(nested, { config, lockPath })).rejects.toThrow(/拒绝 import/);
    });

    it('forces --name to override frontmatter.name', async () => {
        const src = await writeSourceSkill('original-name');
        const { name, skillPath } = await importCommand(src, {
            name: 'renamed-skill',
            config,
            lockPath,
        });
        expect(name).toBe('renamed-skill');
        expect(skillPath).toBe(path.join(installRoot, 'renamed-skill'));
    });

    it('falls back to directory name when frontmatter.name missing', async () => {
        const dir = path.join(sourceDir, 'fallback-name');
        await fs.mkdir(dir, { recursive: true });
        // 没有 frontmatter.name, 用目录名
        await fs.writeFile(
            path.join(dir, 'SKILL.md'),
            `---\ndescription: just a description\n---\nbody`,
            'utf-8'
        );
        await expect(importCommand(dir, { config, lockPath })).rejects.toThrow(/frontmatter/);
    });

    it('strips .skill-lock.json from imported skill', async () => {
        const src = await writeSourceSkill('stale-lock');
        // 模拟源里残留另一份 lock
        await fs.writeFile(path.join(src, '.skill-lock.json'), '{"version":1,"skills":{}}', 'utf-8');
        await fs.writeFile(path.join(src, '.skill-meta.json'), '{"skill_id":"x"}', 'utf-8');
        const { skillPath } = await importCommand(src, { config, lockPath });
        // 内部文件应被清掉
        await expect(fs.access(path.join(skillPath, '.skill-lock.json'))).rejects.toThrow();
        await expect(fs.access(path.join(skillPath, '.skill-meta.json'))).rejects.toThrow();
    });

    it('rejects non-existent source path', async () => {
        await expect(
            importCommand('/tmp/does-not-exist-skkill-test-xxx', { config, lockPath })
        ).rejects.toThrow(/不存在/);
    });

    it('rejects source that is a file (not a directory)', async () => {
        const filePath = path.join(sourceDir, 'not-a-dir.txt');
        await fs.writeFile(filePath, 'just a file', 'utf-8');
        await expect(importCommand(filePath, { config, lockPath })).rejects.toMatchObject({
            code: 'E_INVALID_INPUT',
        });
    });

    it('preserves SKILL.md body content from source', async () => {
        const dir = await writeSourceSkill('preserved-body', 'with body');
        await fs.writeFile(
            path.join(dir, 'SKILL.md'),
            `---\nname: preserved-body\ndescription: with body\n---\n# 重要步骤\n1. 第一步\n2. 第二步\n`,
            'utf-8'
        );
        const { skillPath } = await importCommand(dir, { config, lockPath });
        const raw = await fs.readFile(path.join(skillPath, 'SKILL.md'), 'utf-8');
        const parsed = matter(raw);
        expect(parsed.content).toContain('重要步骤');
        expect(parsed.content).toContain('第一步');
    });

    it('expands ~ in source path', async () => {
        const realHome = os.homedir();
        const homeSrcDir = path.join(realHome, '.skkill-import-test-src');
        const skillDir = path.join(homeSrcDir, 'home-skill');
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, 'SKILL.md'), SKILL_MD('home-skill'), 'utf-8');
        try {
            const { name } = await importCommand('~/.skkill-import-test-src/home-skill', {
                config,
                lockPath,
            });
            expect(name).toBe('home-skill');
            // 源已被移走
            await expect(fs.access(skillDir)).rejects.toThrow();
        } finally {
            await fs.rm(homeSrcDir, { recursive: true, force: true });
        }
    });
});
