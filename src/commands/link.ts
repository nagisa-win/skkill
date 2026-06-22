import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, getInstallRoot } from '../lib/config.js';
import { readPackageJson } from '../lib/package-json.js';
import { readSkillMd } from '../lib/manifest.js';
import { applyToAgents } from '../lib/symlinker.js';
import { listAvailable, getAgent } from '../agents/index.js';
import { logger } from '../utils/logger.js';
import type { InstalledSkill } from '../types/skill.js';
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

export async function linkCommand(target: string): Promise<void> {
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
            logger.warn(`installRoot 不存在: ${installRoot},请先 skkill install`);
            return;
        }
        throw err;
    }

    let linked = 0;
    let skipped = 0;
    let broken = 0;
    for (const name of entries) {
        const skillPath = path.join(installRoot, name);
        const stat = await fs.stat(skillPath).catch(() => null);
        if (!stat?.isDirectory()) continue;

        try {
            const pkg = await readPackageJson(skillPath);
            const { frontmatter } = await readSkillMd(skillPath);
            if (!pkg) continue;
            const skill: InstalledSkill = {
                name,
                path: skillPath,
                packageJson: pkg,
                frontmatter,
                appliedAgents: [],
            };
            const results = await applyToAgents(skill, adapters);
            linked += results.filter(r => r.linkedAt).length;
            skipped += results.filter(r => !r.linkedAt && !r.error).length;
            broken += results.filter(r => r.error).length;
        } catch (err) {
            logger.warn(`Skip ${name}: ${(err as Error).message}`);
            broken++;
        }
    }

    logger.success(`Link done: ${linked} linked, ${skipped} skipped, ${broken} broken`);
}
