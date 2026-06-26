import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, getInstallRoot } from '../lib/config.js';
import { readSkillMd } from '../lib/manifest.js';
import { ensureManifest, readPackageJson } from '../lib/package-json.js';
import { upsertSkill } from '../lib/skill-lock.js';
import { applyToAgents } from '../lib/symlinker.js';
import { listAvailable, getAgent } from '../agents/index.js';
import { logger, SkitError } from '../utils/logger.js';
import { assertPathSafe, isPathSafe, sanitizeName } from '../utils/sanitize.js';
import { expandHome, ensureDir } from '../utils/paths.js';
import { copyDir, safeRemove } from '../utils/fs.js';
import type { ConfigFile } from '../types/config.js';
import type { InstalledSkill } from '../types/skill.js';

const KEBAB_RE = /^[a-z0-9-]+$/;
const SKKILL_INTERNAL_FILES = ['.skill-lock.json', '.skill-meta.json'];

export async function importCommand(
    sourcePath: string,
    opts: { name?: string; agents?: string[]; config?: ConfigFile; lockPath?: string } = {}
): Promise<{ skillPath: string; name: string }> {
    const config = opts.config ?? (await loadConfig());
    const installRoot = getInstallRoot(config);

    const absSource = path.resolve(expandHome(sourcePath));
    const sourceStat = await fs.lstat(absSource).catch(() => null);
    if (!sourceStat) {
        throw new SkitError('E_INVALID_INPUT', `源路径不存在: ${absSource}`);
    }
    if (!sourceStat.isDirectory()) {
        throw new SkitError('E_INVALID_INPUT', `源路径不是目录: ${absSource}`);
    }

    // 源必须在 installRoot 外: 复用 sanitize.isPathSafe 反向判定, 不重复造轮子
    if (isPathSafe(installRoot, absSource)) {
        throw new SkitError(
            'E_INVALID_INPUT',
            `源 ${absSource} 在 ${installRoot} 内, 拒绝 import 自己管理的 skill`
        );
    }

    // 一次 readSkillMd 同时校验存在 + 解析 frontmatter (省一次 pathExists + 一次 readFile)
    let frontmatter;
    try {
        ({ frontmatter } = await readSkillMd(absSource));
    } catch (err) {
        if (err instanceof SkitError && err.code === 'E_INVALID_SKILL' && /缺少 SKILL\.md/.test(err.message)) {
            throw new SkitError(
                'E_INVALID_SKILL',
                `源目录缺少 SKILL.md: ${absSource} (skkill 要求所有 skill 必须有入口文件)`
            );
        }
        throw err;
    }

    const name = sanitizeName(opts.name ?? frontmatter.name ?? path.basename(absSource));
    if (!KEBAB_RE.test(name) || name.length === 0 || name.length > 64) {
        throw new SkitError('E_INVALID_INPUT', `解析后的 skill name 不合法: "${name}" (必须 kebab-case 且 ≤64)`);
    }

    const destPath = path.join(installRoot, name);
    assertPathSafe(installRoot, destPath);
    // fs.rename 要求目标父目录存在; installRoot 在全新环境下可能没建过
    await ensureDir(installRoot);
    const destLstat = await fs.lstat(destPath).catch(() => null);
    if (destLstat) {
        if (destLstat.isSymbolicLink()) {
            // link 命令创建的 symlink, 删了不影响原目录
            await fs.unlink(destPath);
            logger.info(`Removed existing symlink at ${destPath}`);
        } else {
            throw new SkitError(
                'E_ALREADY_INSTALLED',
                `${destPath} 是真实目录, 拒绝覆盖; 如要替换请先 'skkill uninstall ${name}'`
            );
        }
    }

    try {
        await fs.rename(absSource, destPath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
        await copyDir(absSource, destPath);
        await safeRemove(absSource);
        logger.warn(`跨设备 move, fallback 到 copy + rm`);
    }

    // 并行清理 skkill 内部文件 (.skill-lock.json 残留会让两个 skkill 实例状态混淆)
    await Promise.all(
        SKKILL_INTERNAL_FILES.map(f => fs.unlink(path.join(destPath, f)).catch(() => undefined))
    );

    const sourceUrl = `file://${absSource}`;
    await ensureManifest(destPath, {
        source: sourceUrl,
        fallbackName: name,
        fallbackDescription: frontmatter.description,
    });

    await upsertSkill(
        {
            name,
            source: absSource,
            sourceType: 'local',
            sourceUrl,
            backend: 'git',
            installedAt: new Date().toISOString(),
        },
        opts.lockPath
    );

    logger.success(`Imported ${name} from ${absSource} → ${destPath}`);
    logger.info(`下一步: 'skkill validate ${name}' 校验, 'skkill link <agent>' 链接到目标 agent`);

    const selectedIds = opts.agents ?? [];
    if (selectedIds.length > 0) {
        const adapters = selectedIds
            .map(id => getAgent(id as never))
            .filter((a): a is NonNullable<typeof a> => a !== undefined);
        const pkg = await readPackageJson(destPath);
        const skill: InstalledSkill = {
            name,
            path: destPath,
            packageJson: pkg!,
            frontmatter,
            appliedAgents: [],
        };
        const results = await applyToAgents(skill, adapters);
        for (const r of results) {
            if (r.error) logger.warn(`${r.agentId}: ${r.error}`);
            else logger.success(`Linked to ${r.agentId}`);
        }
    } else {
        const available = listAvailable();
        logger.info(`Not linked. Run: skkill link <${available.join('|')}|all>`);
    }

    return { skillPath: destPath, name };
}
