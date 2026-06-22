import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { SkitError } from '../utils/logger.js';
import type { SkillFrontmatter } from '../types/skill.js';

const SKILL_MD = 'SKILL.md';

// 校验 frontmatter 必填字段
function validate(fm: Record<string, unknown>): SkillFrontmatter {
    const name = fm.name;
    const description = fm.description;
    if (typeof name !== 'string' || name.length === 0) {
        throw new SkitError('E_INVALID_SKILL', 'SKILL.md frontmatter 缺少 `name`');
    }
    if (name.length > 64 || !/^[a-z0-9-]+$/.test(name)) {
        throw new SkitError('E_INVALID_SKILL', `SKILL.md frontmatter \`name\` 必须为 kebab-case 且 ≤64: ${name}`);
    }
    if (typeof description !== 'string' || description.length === 0) {
        throw new SkitError('E_INVALID_SKILL', 'SKILL.md frontmatter 缺少 `description`');
    }
    if (description.length > 1024) {
        throw new SkitError('E_INVALID_SKILL', `SKILL.md frontmatter \`description\` 超过 1024 字符`);
    }
    return fm as unknown as SkillFrontmatter;
}

// 读取并解析 SKILL.md (返回 {frontmatter, body})
export async function readSkillMd(skillPath: string): Promise<{ frontmatter: SkillFrontmatter; body: string }> {
    const file = path.join(skillPath, SKILL_MD);
    let raw: string;
    try {
        raw = await fs.readFile(file, 'utf-8');
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new SkitError('E_INVALID_SKILL', `缺少 SKILL.md: ${skillPath}`);
        }
        throw err;
    }
    const parsed = matter(raw);
    return { frontmatter: validate(parsed.data), body: parsed.content };
}

// 写入 SKILL.md
export async function writeSkillMd(skillPath: string, frontmatter: SkillFrontmatter, body: string): Promise<void> {
    const content = matter.stringify(body, frontmatter);
    await fs.writeFile(path.join(skillPath, SKILL_MD), content, 'utf-8');
}
