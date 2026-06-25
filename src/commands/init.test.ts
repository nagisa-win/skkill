import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import matter from 'gray-matter';
import { initCommand } from './init.js';
import { readSkillLock } from '../lib/skill-lock.js';
import { validateSkill } from '../lib/skill-rules.js';
import { SkitError } from '../utils/logger.js';
import type { ConfigFile } from '../types/config.js';

let workDir: string;
let installRoot: string;
let lockPath: string;
let config: ConfigFile;

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skkill-init-'));
    installRoot = path.join(workDir, 'skills');
    lockPath = path.join(workDir, '.skill-lock.json');
    config = { version: 1, installRoot };
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

describe('initCommand', () => {
    it('generates SKILL.md + package.json + resource dirs with --description', async () => {
        const { skillPath, name } = await initCommand('my-skill', {
            description: 'demo skill',
            config,
            lockPath,
        });
        expect(name).toBe('my-skill');

        // SKILL.md 解析后 frontmatter 含 name/description
        const raw = await fs.readFile(path.join(skillPath, 'SKILL.md'), 'utf-8');
        const parsed = matter(raw);
        expect(parsed.data.name).toBe('my-skill');
        expect(parsed.data.description).toBe('demo skill');

        // package.json 字段
        const pkg = JSON.parse(await fs.readFile(path.join(skillPath, 'package.json'), 'utf-8'));
        expect(pkg.name).toBe('my-skill');
        expect(pkg.version).toBe('0.1.0');
        expect(pkg.skkill?.installedAt).toMatch(/^\d{4}-/);

        // 三个资源目录都有 .gitkeep
        for (const dir of ['references', 'scripts', 'assets']) {
            const stat = await fs.stat(path.join(skillPath, dir, '.gitkeep'));
            expect(stat.isFile()).toBe(true);
        }
    });

    it('uses TODO placeholder when --description omitted', async () => {
        const { skillPath } = await initCommand('another-skill', { config, lockPath });
        const parsed = matter(await fs.readFile(path.join(skillPath, 'SKILL.md'), 'utf-8'));
        expect(parsed.data.description).toMatch(/TODO/);
    });

    it('writes lock entry on init', async () => {
        await initCommand('locked-skill', { config, lockPath });
        const lock = await readSkillLock(lockPath);
        expect(lock.skills['locked-skill']).toBeDefined();
        expect(lock.skills['locked-skill']?.sourceType).toBe('local');
        expect(lock.skills['locked-skill']?.sourceUrl).toMatch(/^file:\/\//);
    });

    it('generated skill passes validate (no errors)', async () => {
        const { skillPath } = await initCommand('valid-skill', {
            description: 'a fully valid skill',
            config,
            lockPath,
        });
        const report = await validateSkill(skillPath);
        expect(report.errors).toEqual([]);
    });

    it('rejects non-kebab-case names', async () => {
        await expect(initCommand('My_Skill', { config, lockPath })).rejects.toThrow(SkitError);
        await expect(initCommand('UPPER', { config, lockPath })).rejects.toThrow(SkitError);
        await expect(initCommand('under_score', { config, lockPath })).rejects.toThrow(SkitError);
        await expect(initCommand('dot.dot', { config, lockPath })).rejects.toThrow(SkitError);
    });

    it('rejects name longer than 64 chars', async () => {
        const long = 'a'.repeat(65);
        await expect(initCommand(long, { config, lockPath })).rejects.toThrow(SkitError);
    });

    it('refuses to overwrite existing directory', async () => {
        await initCommand('taken', { config, lockPath });
        await expect(initCommand('taken', { config, lockPath })).rejects.toThrow(SkitError);
    });

    it('writes PROMPT.md with skill path and validate command', async () => {
        const { skillPath, name } = await initCommand('prompted-skill', {
            description: 'demo',
            config,
            lockPath,
        });
        const promptBody = await fs.readFile(path.join(skillPath, 'PROMPT.md'), 'utf-8');
        // 路径必须硬编码进 prompt, 让 coding agent 知道往哪写
        expect(promptBody).toContain(skillPath);
        // 必须引导跑 validate
        expect(promptBody).toContain(`skkill validate ${name}`);
        // 必须列出三个固定子目录
        expect(promptBody).toContain('references/');
        expect(promptBody).toContain('scripts/');
        expect(promptBody).toContain('assets/');
    });
});