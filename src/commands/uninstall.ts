import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, getInstallRoot } from '../lib/config.js';
import { unapplyFromAgents } from '../lib/symlinker.js';
import { removeSkill } from '../lib/skill-lock.js';
import { listAvailable, getAgent } from '../agents/index.js';
import { logger } from '../utils/logger.js';

export async function uninstallCommand(
    name: string,
    opts: { agents?: string[]; lockPath?: string } = {}
): Promise<void> {
    const config = await loadConfig();
    const installRoot = getInstallRoot(config);

    // 默认从所有可用 agent 卸载
    const selectedIds = opts.agents?.length ? opts.agents : (listAvailable() as string[]);
    const adapters = selectedIds
        .map(id => getAgent(id as never))
        .filter((a): a is NonNullable<typeof a> => a !== undefined);

    const results = await unapplyFromAgents(name, adapters);
    const removedCount = results.filter(r => r.removed).length;
    logger.info(`Removed ${removedCount} symlink(s) from agents`);

    // 删除 skill 目录
    const skillDir = path.join(installRoot, name);
    await fs.rm(skillDir, { recursive: true, force: true });
    // 同步删 lock entry (不存在静默忽略)
    await removeSkill(name, opts.lockPath);
    logger.success(`Uninstalled ${name}`);
}
