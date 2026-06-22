import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, isSymlinkTo } from '../utils/paths.js';
import { logger, SkitError } from '../utils/logger.js';
import type { BaseAdapter } from '../agents/base.js';
import type { InstalledSkill } from '../types/skill.js';
import type { AgentId } from '../types/agent.js';

// 创建软链接: <skillsDir>/<name> -> <skill.path>
export async function applySkillToAgent(adapter: BaseAdapter, skill: InstalledSkill): Promise<{ linkedAt: string }> {
    const skillsDir = adapter.defaultSkillsDir();
    const linkPath = path.join(skillsDir, skill.name);
    await ensureDir(skillsDir);

    // 已存在软链接且指向目标,跳过
    if (await isSymlinkTo(linkPath, skill.path)) {
        logger.info(`Already linked: ${linkPath}`);
        return { linkedAt: new Date().toISOString() };
    }

    // 已存在但不是软链接,拒绝覆盖
    const stats = await fs.lstat(linkPath).catch(() => null);
    if (stats && !stats.isSymbolicLink()) {
        throw new SkitError('E_NOT_SYMLINK', `${linkPath} 已存在且不是软链接,拒绝覆盖`);
    }

    // 移除旧的死链 / 重新创建
    if (stats?.isSymbolicLink()) await fs.unlink(linkPath);
    await fs.symlink(skill.path, linkPath);
    logger.success(`Linked: ${linkPath} -> ${skill.path}`);
    return { linkedAt: new Date().toISOString() };
}

// 移除软链接 (拒绝删除真实目录)
export async function unapplySkillFromAgent(adapter: BaseAdapter, skillName: string): Promise<void> {
    const linkPath = path.join(adapter.defaultSkillsDir(), skillName);
    const stats = await fs.lstat(linkPath).catch(() => null);
    if (!stats) return; // 不存在,静默忽略
    if (!stats.isSymbolicLink()) {
        throw new SkitError('E_NOT_SYMLINK', `${linkPath} 不是软链接,拒绝删除 (可能指向真实目录)`);
    }
    await fs.unlink(linkPath);
    logger.info(`Unlinked: ${linkPath}`);
}

// 判断 skill 是否已软链接到该 agent
export async function isSkillApplied(adapter: BaseAdapter, skillName: string): Promise<boolean> {
    const linkPath = path.join(adapter.defaultSkillsDir(), skillName);
    try {
        const stats = await fs.lstat(linkPath);
        return stats.isSymbolicLink();
    } catch {
        return false;
    }
}

// 批量应用到多个 agents (跳过不可用的)
export async function applyToAgents(
    skill: InstalledSkill,
    adapters: BaseAdapter[]
): Promise<{ agentId: AgentId; linkedAt?: string; error?: string }[]> {
    const results: { agentId: AgentId; linkedAt?: string; error?: string }[] = [];
    for (const adapter of adapters) {
        try {
            const { linkedAt } = await applySkillToAgent(adapter, skill);
            results.push({ agentId: adapter.id, linkedAt });
        } catch (err) {
            results.push({ agentId: adapter.id, error: (err as Error).message });
        }
    }
    return results;
}

// 从多个 agents 移除软链接
export async function unapplyFromAgents(
    skillName: string,
    adapters: BaseAdapter[]
): Promise<{ agentId: AgentId; removed: boolean; error?: string }[]> {
    const results: { agentId: AgentId; removed: boolean; error?: string }[] = [];
    for (const adapter of adapters) {
        try {
            await unapplySkillFromAgent(adapter, skillName);
            results.push({ agentId: adapter.id, removed: true });
        } catch (err) {
            const e = err as NodeJS.ErrnoException & { code?: string };
            const code = e.code;
            // 静默忽略:不存在 (ENOENT) 或目标不是软链接
            if (code === 'ENOENT' || code === 'E_NOT_SYMLINK') {
                results.push({ agentId: adapter.id, removed: false });
                continue;
            }
            results.push({ agentId: adapter.id, removed: false, error: (err as Error).message });
        }
    }
    return results;
}
