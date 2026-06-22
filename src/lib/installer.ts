import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SkitError } from '../utils/logger.js';
import { ensureDir, pathExists } from '../utils/paths.js';
import { safeRemove, copyDir } from '../utils/fs.js';
import { readSkillMd } from './manifest.js';
import { ensureManifest } from './package-json.js';
import { getBackend, pickDefaultBackend } from '../backends/index.js';
import type { SkillBackend, ResolvedSource } from '../types/backend.js';
import type { InstalledSkill, SkillPackageJson } from '../types/skill.js';
import type { ConfigFile } from '../types/config.js';
import { getInstallRoot } from './config.js';

// 把 ref 解析为 ResolvedSource,先尝试本地已安装,再用 backend.resolve
export async function resolveSource(ref: string, backend?: SkillBackend): Promise<ResolvedSource> {
    // 本地路径直接走 git backend(它支持 file://)
    if (isLocalPath(ref)) {
        const gitBackend = backend ?? (await import('../backends/index.js')).getBackend('git');
        return gitBackend.resolve(expandHome(ref));
    }
    // 已经是 git URL 或 owner/repo 简写,强制 git
    if (isLikelyGitUrl(ref)) {
        const gitBackend = backend ?? (await import('../backends/index.js')).getBackend('git');
        return gitBackend.resolve(ref);
    }
    const b = backend ?? (await pickDefaultBackend());
    // 尝试作为本地已安装 skill 解析
    const localMatch = await resolveLocalSource(ref);
    if (localMatch) return localMatch;
    // 否则交给 backend (onetool / npx-skill)
    return b.resolve(ref);
}

function isLocalPath(s: string): boolean {
    return s.startsWith('/') || s.startsWith('./') || s.startsWith('../') || s.startsWith('~/');
}

function expandHome(s: string): string {
    if (s === '~') return os.homedir();
    if (s.startsWith('~/')) return path.join(os.homedir(), s.slice(2));
    return s;
}

async function resolveLocalSource(ref: string): Promise<ResolvedSource | null> {
    // 仅尝试读取 installRoot/<ref>/package.json.skkill.source
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

function isLikelyGitUrl(s: string): boolean {
    return (
        s.startsWith('git@') ||
        s.startsWith('https://') ||
        s.startsWith('git://') ||
        s.endsWith('.git') ||
        /^[\w.-]+\/[\w.-]+$/.test(s) ||
        s.startsWith('/') ||
        s.startsWith('./') ||
        s.startsWith('../') ||
        s.startsWith('~/')
    );
}

// 安装 skill 到 installRoot
export async function installSkill(
    ref: string,
    config: ConfigFile,
    opts: { backend?: SkillBackend; destName?: string } = {}
): Promise<InstalledSkill> {
    const backend =
        opts.backend ?? (isLocalPath(ref) || isLikelyGitUrl(ref) ? getBackend('git') : await pickDefaultBackend());
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
        // 幂等: 已装就复用, 不重复 fetch (skip download + manifest + copy)
        // 调用方拿到的是同一个 InstalledSkill, 可直接走 applyToAgents 链接到新 agent
        if (await pathExists(destPath)) {
            const existingPkgRaw = await fs.readFile(path.join(destPath, 'package.json'), 'utf-8').catch(() => null);
            const existingPkg = existingPkgRaw ? (JSON.parse(existingPkgRaw) as SkillPackageJson) : pkg;
            const { frontmatter: existingFm } = await readSkillMd(destPath);
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
export async function upgradeSkill(name: string, config: ConfigFile): Promise<{ from: string; to: string }> {
    const installRoot = getInstallRoot(config);
    const skillPath = path.join(installRoot, name);
    if (!(await pathExists(skillPath))) {
        throw new SkitError('E_NOT_INSTALLED', `Skill "${name}" 未安装`);
    }
    const backend = await pickDefaultBackend();
    const { from, to } = await backend.upgrade(skillPath);
    // 回写 package.json 中的 skkill.upgradedAt
    const pkg = await fs.readFile(path.join(skillPath, 'package.json'), 'utf-8').catch(() => null);
    if (pkg) {
        const parsed = JSON.parse(pkg) as SkillPackageJson;
        parsed.skkill = { ...parsed.skkill, upgradedAt: new Date().toISOString() };
        await fs.writeFile(path.join(skillPath, 'package.json'), JSON.stringify(parsed, null, 2) + '\n');
    }
    return { from, to };
}

function sanitizeName(name: string): string {
    // npm 命名可能含 @scope/ 和 /,取最后一段作为目录名
    const last = name.split('/').pop() ?? name;
    return last.replace(/[^a-zA-Z0-9-_.]/g, '-').toLowerCase();
}
