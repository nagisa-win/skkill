import crypto from 'node:crypto';
import { SkitError } from '../utils/logger.js';
import { getConfigValue } from './config-resolver.js';
import { ConfigKey, GITHUB_API } from '../constants.js';
import type { ConfigFile } from '../types/config.js';
import type { SkillLockEntry } from '../types/lock.js';

// 从 GitHub gitUrl 提取 owner/repo,失败返回 null
// 接受: https://github.com/<owner>/<repo>(.git)? / git@github.com:<owner>/<repo>(.git)?
export function parseGitHubRepo(gitUrl: string): { owner: string; repo: string } | null {
    const m =
        /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:[?#].*)?$/.exec(gitUrl) ??
        /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(gitUrl);
    if (!m) return null;
    const [, owner, repo] = m;
    if (!owner || !repo) return null;
    return { owner, repo };
}

// GitHub Trees API 返回的 tree 条目 (只取需要的字段)
interface TreeEntry {
    path: string;
    sha: string;
    type: 'blob' | 'tree' | string;
    size?: number;
    mode: string;
}

// 调 GitHub Trees API 取整棵树,过滤到 skillPath 子树后 hash
// 非 GitHub 仓库 / 网络失败 / skillPath 不存在 → 返回 null (调用方降级到 git pull)
export async function fetchSkillFolderHash(args: {
    gitUrl: string;
    ref?: string; // branch / tag / sha,默认 HEAD
    skillPath?: string; // 仓库内子路径 (e.g. "skills/frontend-design"),默认整仓
    config: ConfigFile;
}): Promise<string | null> {
    const { gitUrl, ref = 'HEAD', skillPath, config } = args;
    const repo = parseGitHubRepo(gitUrl);
    if (!repo) return null;

    const token = getConfigValue(ConfigKey.GitHubToken, config);
    const url = `${GITHUB_API}/repos/${repo.owner}/${repo.repo}/git/trees/${ref}?recursive=1`;
    const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'skkill',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    let data: { tree?: TreeEntry[]; truncated?: boolean };
    try {
        const res = await fetch(url, { headers });
        if (!res.ok) {
            // 404 / 401 / 限速 429 等都视为"无法精准升级",降级到 git pull
            return null;
        }
        data = (await res.json()) as { tree?: TreeEntry[]; truncated?: boolean };
    } catch {
        return null;
    }

    const entries = data.tree ?? [];
    // 过滤到 skillPath 子树 (路径前缀匹配,加 '/' 防止 'foo' 误匹配 'foobar')
    const prefix = skillPath ? `${skillPath.replace(/^\/+|\/+$/g, '')}/` : '';
    const filtered = entries
        .filter(e => e.type === 'blob' && (prefix === '' || e.path.startsWith(prefix)))
        .map(e => ({
            path: e.path,
            sha: e.sha,
            mode: e.mode,
            ...(e.size !== undefined ? { size: e.size } : {}),
        }));
    // 按 path 排序保证 hash 稳定
    filtered.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return hashTree(filtered);
}

// 模仿 vercel-labs/skills 的 tree hash 算法:
// 把每条 entry 拼成 "<mode> <type> <size?> <sha> <path>" 一行,sha1 整体
export function hashTree(entries: Array<{ path: string; sha: string; mode: string; size?: number }>): string {
    const lines = entries.map(e => {
        const sizePart = e.size !== undefined ? ` ${e.size}` : '';
        return `${e.mode} blob${sizePart} ${e.sha} ${e.path}`;
    });
    return crypto.createHash('sha1').update(lines.join('\n')).digest('hex');
}

// 检查 lock entry 是否有更新 (仅 GitHub 源有效,其他返回 null)
export async function checkUpdate(
    entry: SkillLockEntry,
    config: ConfigFile
): Promise<{ updateAvailable: boolean; latestHash: string } | null> {
    if (entry.sourceType !== 'git') return null;
    const latest = await fetchSkillFolderHash({
        gitUrl: entry.sourceUrl,
        ...(entry.ref ? { ref: entry.ref } : {}),
        ...(entry.skillPath ? { skillPath: entry.skillPath } : {}),
        config,
    });
    if (!latest) return null;
    return {
        updateAvailable: entry.skillFolderHash !== latest,
        latestHash: latest,
    };
}

// 显式抛错便于调用方区分"无 lock entry" vs "其他失败"
export function requireLockEntry<T>(entry: T | undefined, name: string): T {
    if (!entry) {
        throw new SkitError('E_NOT_INSTALLED', `skill "${name}" 不在 lock 中,无法精准升级`);
    }
    return entry;
}