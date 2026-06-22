import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../lib/config.js';
import { installSkill } from '../lib/installer.js';
import { logger } from '../utils/logger.js';
import { listAvailable } from '../agents/index.js';
import { applyToAgents } from '../lib/symlinker.js';
import { getAgent } from '../agents/index.js';

export async function installCommand(ref: string, opts: { agents?: string[] } = {}): Promise<void> {
    const config = await loadConfig();
    const spinner = logger.spinner(`Installing ${ref}…`).start();
    const skill = await installSkill(ref, config);
    spinner.succeed(`Installed ${skill.name} (${skill.packageJson.version})`);

    // 展示 onetool 来源的元数据 (如有)
    const metaPath = path.join(skill.path, '.skill-meta.json');
    const metaRaw = await fs.readFile(metaPath, 'utf-8').catch(() => null);
    if (metaRaw) {
        try {
            const meta = JSON.parse(metaRaw) as Record<string, unknown>;
            const parts: string[] = [];
            if (meta.skill_id) parts.push(`id=${meta.skill_id}`);
            if (meta.namespace) parts.push(`namespace=${meta.namespace}`);
            if (meta.version && meta.version !== skill.packageJson.version) parts.push(`registry=${meta.version}`);
            if (parts.length > 0) logger.info(`  [${parts.join(', ')}]`);
        } catch {
            /* ignore parse err */
        }
    }

    // 应用目标: 缺省不应用任何 agent (用户后续用 skkill link <agent> 链接所有,或 skkill install --agents <ids...> 重链接)
    const available = listAvailable();
    const selectedIds = opts.agents ?? [];
    if (selectedIds.length === 0) {
        logger.info(`Not linked. Run: skkill link <${available.join('|')}|all>`);
        return;
    }

    const adapters = selectedIds
        .map(id => getAgent(id as never))
        .filter((a): a is NonNullable<typeof a> => a !== undefined);

    const results = await applyToAgents(skill, adapters);
    for (const r of results) {
        if (r.error) logger.warn(`${r.agentId}: ${r.error}`);
        else logger.success(`Linked to ${r.agentId}`);
    }
}
