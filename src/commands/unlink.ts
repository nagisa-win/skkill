import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, getInstallRoot } from '../lib/config.js';
import { unapplyFromAgents } from '../lib/symlinker.js';
import { listAvailable, getAgent } from '../agents/index.js';
import { logger } from '../utils/logger.js';
import { SkitError } from '../utils/logger.js';

function parseTargets(target: string): string[] {
    const available = listAvailable();
    if (target === 'all') return available as string[];
    const ids = target.split(',').map(s => s.trim());
    for (const id of ids) {
        if (!available.includes(id as never)) {
            throw new SkitError('E_AGENT_UNKNOWN', `Unknown agent: ${id}`);
        }
    }
    return ids;
}

export async function unlinkCommand(target: string): Promise<void> {
    const config = await loadConfig();
    const installRoot = getInstallRoot(config);
    const targetIds = parseTargets(target);
    const adapters = targetIds
        .map(id => getAgent(id as never))
        .filter((a): a is NonNullable<typeof a> => a !== undefined);

    let entries: string[];
    try {
        entries = await fs.readdir(installRoot);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            logger.warn(`installRoot 不存在: ${installRoot}`);
            return;
        }
        throw err;
    }

    let removed = 0;
    let notLinked = 0;
    let broken = 0;
    for (const name of entries) {
        const skillPath = path.join(installRoot, name);
        const stat = await fs.stat(skillPath).catch(() => null);
        if (!stat?.isDirectory()) continue;

        const results = await unapplyFromAgents(name, adapters);
        removed += results.filter(r => r.removed).length;
        notLinked += results.filter(r => !r.removed && !r.error).length;
        broken += results.filter(r => r.error).length;
    }

    logger.success(`Unlink done: ${removed} removed, ${notLinked} not linked, ${broken} broken`);
}
