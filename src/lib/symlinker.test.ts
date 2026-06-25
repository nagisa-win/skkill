import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
    applySkillToAgent,
    unapplySkillFromAgent,
    isSkillApplied,
    applyToAgents,
    unapplyFromAgents,
} from './symlinker.js';
import { SkitError } from '../utils/logger.js';
import type { BaseAdapter } from '../agents/base.js';
import type { InstalledSkill } from '../types/skill.js';

let workDir: string;
let skillsDir: string;
let skillPath: string;
let skill: InstalledSkill;

class FakeAdapter implements BaseAdapter {
    readonly id = 'fake' as const;
    readonly displayName = 'Fake';
    defaultSkillsDir(): string {
        return skillsDir;
    }
    async detectSkillsDir(): Promise<string> {
        return skillsDir;
    }
}

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skkill-symtest-'));
    skillsDir = path.join(workDir, 'agent-skills');
    skillPath = path.join(workDir, 'installed', 'my-skill');
    await fs.mkdir(skillPath, { recursive: true });
    await fs.writeFile(path.join(skillPath, 'SKILL.md'), '# hello');
    skill = {
        name: 'my-skill',
        path: skillPath,
        packageJson: { name: 'my-skill', version: '1.0.0' } as InstalledSkill['packageJson'],
        frontmatter: { name: 'my-skill', description: 'd' } as InstalledSkill['frontmatter'],
        appliedAgents: [],
    };
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

describe('applySkillToAgent', () => {
    it('creates a symlink to the skill path', async () => {
        const adapter = new FakeAdapter();
        const result = await applySkillToAgent(adapter, skill);
        expect(result.linkedAt).toMatch(/^\d{4}-/);
        const linkPath = path.join(skillsDir, 'my-skill');
        const stats = await fs.lstat(linkPath);
        expect(stats.isSymbolicLink()).toBe(true);
        const target = await fs.readlink(linkPath);
        expect(target).toBe(skillPath);
    });

    it('skips when symlink already points to the same target', async () => {
        const adapter = new FakeAdapter();
        await applySkillToAgent(adapter, skill);
        // 再调一次,不应该报错
        const second = await applySkillToAgent(adapter, skill);
        expect(second.linkedAt).toBeDefined();
    });

    it('throws E_NOT_SYMLINK when target exists and is a real directory', async () => {
        const adapter = new FakeAdapter();
        await fs.mkdir(skillsDir, { recursive: true });
        // 在 agent skillsDir 放一个真目录
        const blocking = path.join(skillsDir, 'my-skill');
        await fs.mkdir(blocking, { recursive: true });
        await expect(applySkillToAgent(adapter, skill)).rejects.toThrow(SkitError);
    });
});

describe('unapplySkillFromAgent', () => {
    it('removes an existing symlink', async () => {
        const adapter = new FakeAdapter();
        await applySkillToAgent(adapter, skill);
        await unapplySkillFromAgent(adapter, 'my-skill');
        const stats = await fs.lstat(path.join(skillsDir, 'my-skill')).catch(() => null);
        expect(stats).toBeNull();
    });

    it('is a no-op when symlink does not exist', async () => {
        const adapter = new FakeAdapter();
        await expect(unapplySkillFromAgent(adapter, 'never-existed')).resolves.toBeUndefined();
    });

    it('refuses to remove a real directory', async () => {
        const adapter = new FakeAdapter();
        await fs.mkdir(skillsDir, { recursive: true });
        const blocking = path.join(skillsDir, 'my-skill');
        await fs.mkdir(blocking, { recursive: true });
        await expect(unapplySkillFromAgent(adapter, 'my-skill')).rejects.toThrow(SkitError);
    });
});

describe('isSkillApplied', () => {
    it('returns true for linked skill', async () => {
        const adapter = new FakeAdapter();
        await applySkillToAgent(adapter, skill);
        expect(await isSkillApplied(adapter, 'my-skill')).toBe(true);
    });

    it('returns false for unlinked skill', async () => {
        const adapter = new FakeAdapter();
        expect(await isSkillApplied(adapter, 'my-skill')).toBe(false);
    });
});

describe('applyToAgents', () => {
    it('applies to all adapters and reports per-agent result', async () => {
        const a = new FakeAdapter();
        const results = await applyToAgents(skill, [a]);
        expect(results).toHaveLength(1);
        expect(results[0]!.agentId).toBe('fake');
        expect(results[0]!.linkedAt).toBeDefined();
        expect(results[0]!.error).toBeUndefined();
    });
});

describe('unapplyFromAgents', () => {
    it('reports removed=true for linked skill', async () => {
        const a = new FakeAdapter();
        await applyToAgents(skill, [a]);
        const results = await unapplyFromAgents('my-skill', [a]);
        expect(results[0]!.removed).toBe(true);
        expect(results[0]!.error).toBeUndefined();
    });
});

// B1 路径穿越加固回归测试: 恶意 skillName 不应能逃出 skillsDir
describe('[B1] path traversal protection', () => {
    it('applySkillToAgent 拒绝 ../escape 名字', async () => {
        const adapter = new FakeAdapter();
        const malicious: InstalledSkill = { ...skill, name: '../escape' };
        await expect(applySkillToAgent(adapter, malicious)).rejects.toThrow(SkitError);
        // skillsDir 之外不应有任何文件被创建
        const escapePath = path.join(workDir, 'escape');
        const exists = await fs.stat(escapePath).catch(() => null);
        expect(exists).toBeNull();
    });

    it('unapplySkillFromAgent 拒绝 ../escape 名字', async () => {
        const adapter = new FakeAdapter();
        // 即便真有 ../escape 这个软链,函数也应先在 assertPathSafe 这步拒绝
        await expect(unapplySkillFromAgent(adapter, '../escape')).rejects.toThrow(SkitError);
    });

    it('applySkillToAgent 拒绝带斜杠的逃逸名字 (foo/../../../etc)', async () => {
        const adapter = new FakeAdapter();
        // path.join 会拼成 skillsDir/foo/../../../etc,resolve 后逃出 skillsDir
        const malicious: InstalledSkill = { ...skill, name: 'foo/../../../etc' };
        await expect(applySkillToAgent(adapter, malicious)).rejects.toThrow(SkitError);
    });
});
