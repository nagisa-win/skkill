import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SkitError } from '../utils/logger.js';
import { ensureDir, pathExists } from '../utils/paths.js';
import { safeRemove, copyDir } from '../utils/fs.js';
import { assertPathSafe, sanitizeName } from '../utils/sanitize.js';
import { parseSource } from './source-parser.js';
import { readSkillMd } from './manifest.js';
import { ensureManifest } from './package-json.js';
import { getBackend, pickDefaultBackend } from '../backends/index.js';
import { upsertSkill, getSkill } from './skill-lock.js';
import { checkUpdate, fetchSkillFolderHash, requireLockEntry } from './skill-upgrade.js';
import type { SkillBackend, ResolvedSource } from '../types/backend.js';
import type { InstalledSkill, SkillPackageJson } from '../types/skill.js';
import type { SkillLockEntry } from '../types/lock.js';
import type { ConfigFile } from '../types/config.js';
import { getInstallRoot } from './config.js';

// 判定 ref 是否应强制走 git backend (local / git-url / owner-repo)
function shouldUseGitBackend(ref: string): boolean {
    const parsed = parseSource(ref);
    return parsed.kind === 'local' || parsed.kind === 'git-url' || parsed.kind === 'owner-repo';
}

// 把 ref 解析为 ResolvedSource,先尝试本地已安装,再用 backend.resolve
export async function resolveSource(ref: string, backend?: SkillBackend): Promise<ResolvedSource> {
    // local / git-url / owner-repo 强制走 git backend (它支持 file:// 和 GitHub)
    if (shouldUseGitBackend(ref)) {
        const gitBackend = backend ?? getBackend('git');
        return gitBackend.resolve(ref);
    }
    const b = backend ?? (await pickDefaultBackend());
    // 尝试作为本地已安装 skill 解析
    const localMatch = await resolveLocalSource(ref);
    if (localMatch) return localMatch;
    // 否则交给 backend (onetool / npx-skill)
    return b.resolve(ref);
}

// 从 ref + ResolvedSource 构造 lock entry (installedAt 由调用方控制是否覆盖)
function buildLockEntry(
    ref: string,
    source: ResolvedSource,
    backendId: SkillLockEntry['backend'],
    name: string,
    installedAt: string,
    previous?: SkillLockEntry
): SkillLockEntry {
    const sourceUrl = source.gitUrl ?? source.downloadUrl ?? source.ref;
    const sourceType: SkillLockEntry['sourceType'] =
        source.kind === 'git' ? 'git' : source.kind === 'registry' ? 'registry' : 'local';
    return {
        name,
        source: ref,
        sourceType,
        sourceUrl,
        backend: backendId,
        installedAt,
        ...(previous?.ref ? { ref: previous.ref } : {}),
        ...(previous?.skillPath ? { skillPath: previous.skillPath } : {}),
        ...(previous?.lastCommitSha ? { lastCommitSha: previous.lastCommitSha } : {}),
        ...(previous?.skillFolderHash ? { skillFolderHash: previous.skillFolderHash } : {}),
        ...(previous?.upgradedAt ? { upgradedAt: previous.upgradedAt } : {}),
    };
}

// 幂等再装时,保留旧 entry 的 installedAt 不动 (避免被刷新成当前时间)
async function upsertLockPreservingInstalledAt(
    ref: string,
    source: ResolvedSource,
    backendId: SkillLockEntry['backend'],
    name: string,
    lockPath?: string
): Promise<void> {
    const previous = await getSkill(name, lockPath);
    const installedAt = previous?.installedAt ?? new Date().toISOString();
    await upsertSkill(buildLockEntry(ref, source, backendId, name, installedAt, previous), lockPath);
}

// 读取已安装 skill 的 package.json,从 skkill.source 恢复 ResolvedSource (供 upgrade 复用)
async function resolveLocalSource(ref: string): Promise<ResolvedSource | null> {
    const installRoot = path.join(os.homedir(), '.skkill', 'skills');
    if (!(await pathExists(installRoot))) return null;
    const localPkgPath = path.join(installRoot, ref, 'package.json');
    if (!(await pathExists(localPkgPath))) return null;
    try {
        const raw = await fs.readFile(localPkgPath, 'utf-8');
        const pkg = JSON.parse(raw) as SkillPackageJson;
        const source = pkg.skkill?.source;
        if (!source) return null;
        // BOS zip URL → 当作 onetool 注册源,设 downloadUrl 而非 gitUrl
        if (/\.bcebos\.com\/.+\.zip$/i.test(source) || /^https?:\/\/.+\/.+\.zip$/i.test(source)) {
            return { ref, kind: 'registry', package: ref, downloadUrl: source, version: pkg.version };
        }
        return { ref, kind: 'git', gitUrl: source, version: pkg.version };
    } catch {
        return null;
    }
}

// 安装 skill 到 installRoot
export async function installSkill(
    ref: string,
    config: ConfigFile,
    opts: { backend?: SkillBackend; destName?: string; lockPath?: string } = {}
): Promise<InstalledSkill> {
    const backend = opts.backend ?? (shouldUseGitBackend(ref) ? getBackend('git') : await pickDefaultBackend());
    const source = await resolveSource(ref, backend);
    const installRoot = getInstallRoot(config);
    await ensureDir(installRoot);

    // 临时下载到 /tmp/skkill-<pid>-<rand>
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skkill-'));
    let skillPath: string;
    try {
        const fetched = await backend.fetch(source, tmpDir);
        skillPath = fetched.skillPath;
        const { frontmatter } = await readSkillMd(skillPath);
        const { pkg } = await ensureManifest(skillPath, {
            source: source.gitUrl ?? source.downloadUrl ?? source.ref,
            fallbackName: opts.destName ?? path.basename(skillPath),
            fallbackDescription: frontmatter.description,
        });

        // 移动到 installRoot/<name>
        const destName = opts.destName ?? sanitizeName(pkg.name);
        const destPath = path.join(installRoot, destName);
        assertPathSafe(installRoot, destPath);
        // 幂等: 已装就复用, 不重复 fetch (skip download + manifest + copy)
        // 调用方拿到的是同一个 InstalledSkill, 可直接走 applyToAgents 链接到新 agent
        if (await pathExists(destPath)) {
            const existingPkgRaw = await fs.readFile(path.join(destPath, 'package.json'), 'utf-8').catch(() => null);
            const existingPkg = existingPkgRaw ? (JSON.parse(existingPkgRaw) as SkillPackageJson) : pkg;
            const { frontmatter: existingFm } = await readSkillMd(destPath);
            // 写 lock,保留旧 entry 的 installedAt (复用旧 install 时间,语义上不算重装)
            await upsertLockPreservingInstalledAt(ref, source, backend.id, destName, opts.lockPath);
            return {
                name: destName,
                path: destPath,
                packageJson: existingPkg,
                frontmatter: existingFm,
                appliedAgents: [],
            };
        }
        await copyDir(skillPath, destPath);
        // 若临时目录里包含 .skill-meta.json (onetool 来源),一并复制过来
        const metaSrc = path.join(skillPath, '.skill-meta.json');
        const metaStat = await fs.stat(metaSrc).catch(() => null);
        if (metaStat?.isFile()) {
            await fs.copyFile(metaSrc, path.join(destPath, '.skill-meta.json'));
        }
        // 新装: 写 lock,installedAt 用当前时间
        // 若是 GitHub 源,顺手算 skillFolderHash 作为 upgrade baseline (失败不阻断安装)
        const baselineHash = await fetchSkillFolderHash({
            gitUrl: source.gitUrl ?? '',
            config,
        }).catch(() => null);
        const newEntry = buildLockEntry(ref, source, backend.id, destName, new Date().toISOString());
        if (baselineHash && source.gitUrl) {
            newEntry.skillFolderHash = baselineHash;
        }
        await upsertSkill(newEntry, opts.lockPath);
        return {
            name: destName,
            path: destPath,
            packageJson: pkg,
            frontmatter,
            appliedAgents: [],
        };
    } finally {
        await safeRemove(tmpDir);
    }
}

// 升级 skill
// 优先走 tree hash diff 精准升级 (GitHub 源 + lock entry 有 skillFolderHash 时)
// 降级路径: backend.upgrade() (git pull),老 entries / 非 GitHub 源 / API 失败时走此路
export async function upgradeSkill(
    name: string,
    config: ConfigFile,
    opts: { lockPath?: string } = {}
): Promise<{ from: string; to: string }> {
    const installRoot = getInstallRoot(config);
    const skillPath = path.join(installRoot, name);
    if (!(await pathExists(skillPath))) {
        throw new SkitError('E_NOT_INSTALLED', `Skill "${name}" 未安装`);
    }
    const previous = requireLockEntry(await getSkill(name, opts.lockPath), name);
    // 1) 尝试 tree hash diff 精准升级路径
    const updateInfo = await checkUpdate(previous, config);
    if (updateInfo) {
        if (!updateInfo.updateAvailable) {
            // 已是最新,不调 backend,但更新 lock 的 upgradedAt 表明"检查过"
            await touchUpgradeTimestamp(previous, skillPath, opts.lockPath);
            return { from: previous.skillFolderHash ?? 'unknown', to: updateInfo.latestHash };
        }
        // 有更新: 走 backend.upgrade 拉新代码,然后重算 hash 写回 lock
        const backend = await pickDefaultBackend();
        const { from, to } = await backend.upgrade(skillPath);
        const nowIso = new Date().toISOString();
        await writeUpgradedAt(skillPath, nowIso);
        const newHash = await fetchSkillFolderHash({
            gitUrl: previous.sourceUrl,
            ...(previous.ref ? { ref: previous.ref } : {}),
            ...(previous.skillPath ? { skillPath: previous.skillPath } : {}),
            config,
        });
        await upsertSkill(
            {
                ...previous,
                upgradedAt: nowIso,
                ...(newHash ? { skillFolderHash: newHash } : {}),
            },
            opts.lockPath
        );
        return { from, to };
    }
    // 2) 降级: 走 backend.upgrade (git pull),只更新 upgradedAt
    const backend = await pickDefaultBackend();
    const { from, to } = await backend.upgrade(skillPath);
    const nowIso = new Date().toISOString();
    await writeUpgradedAt(skillPath, nowIso);
    await upsertSkill({ ...previous, upgradedAt: nowIso }, opts.lockPath);
    return { from, to };
}

// 写 package.json 的 skkill.upgradedAt (失败静默,不阻断升级)
async function writeUpgradedAt(skillPath: string, iso: string): Promise<void> {
    const pkgRaw = await fs.readFile(path.join(skillPath, 'package.json'), 'utf-8').catch(() => null);
    if (!pkgRaw) return;
    const parsed = JSON.parse(pkgRaw) as SkillPackageJson;
    parsed.skkill = { ...parsed.skkill, upgradedAt: iso };
    await fs.writeFile(path.join(skillPath, 'package.json'), JSON.stringify(parsed, null, 2) + '\n');
}

// 已是最新时,仅刷新 upgradedAt 时间戳 (跳过 backend.upgrade,但留痕证明查过)
async function touchUpgradeTimestamp(
    previous: SkillLockEntry,
    skillPath: string,
    lockPath?: string
): Promise<void> {
    const iso = new Date().toISOString();
    await writeUpgradedAt(skillPath, iso);
    await upsertSkill({ ...previous, upgradedAt: iso }, lockPath);
}

// sanitizeName 现已迁到 src/utils/sanitize.ts(行为更严:去首尾 . 和 -,255 截断,空串兜底)
