import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, getInstallRoot } from '../lib/config.js';
import { validateSkill, formatReport } from '../lib/skill-rules.js';
import { logger } from '../utils/logger.js';
import { SkitError } from '../utils/logger.js';

export async function validateCommand(target: string, opts: { strict?: boolean } = {}): Promise<void> {
    // target 可以是路径或已安装的 skill 名称
    let resolvedPath = target;
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) {
        // 视为 installRoot 下的 skill 名
        const config = await loadConfig();
        const installRoot = getInstallRoot(config);
        const candidate = path.join(installRoot, target);
        const cStat = await fs.stat(candidate).catch(() => null);
        if (!cStat) throw new SkitError('E_INVALID_SKILL', `Skill 路径或名称不存在: ${target}`);
        resolvedPath = candidate;
    }
    const report = await validateSkill(resolvedPath);
    const out = formatReport(report, { color: true });
    console.log(out);

    const exitOnError = report.errors.length > 0;
    const exitOnWarn = opts.strict && report.warnings.length > 0;
    if (exitOnError) {
        logger.error(`Validation failed: ${report.errors.length} error(s)`);
        process.exitCode = 1;
    } else if (exitOnWarn) {
        logger.error(`--strict: ${report.warnings.length} warning(s) treated as errors`);
        process.exitCode = 1;
    } else {
        logger.success('Validation passed');
    }
}
