import { BaseBackend } from './base.js';
import { clone, pull } from '../lib/git.js';
import { readPackageJson } from '../lib/package-json.js';
import { SkitError } from '../utils/logger.js';
import type { ResolvedSource, FetchResult, SearchResult } from '../types/backend.js';

// GitHub search backend: 直接搜 "skill" 关键字,不再用 topic 过滤
// search 通过 GitHub REST API (search/repositories)
// resolve / fetch / upgrade 走 git clone (与 GitBackend 一致)
const GITHUB_API = 'https://api.github.com';
const SEARCH_KEYWORD = 'skill';

export class GitHubBackend extends BaseBackend {
    readonly id = 'github' as const;
    readonly displayName = 'GitHub (search)';

    async available(): Promise<{ ok: boolean; reason?: string }> {
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 5000);
            const res = await fetch(`${GITHUB_API}/search/repositories?q=${SEARCH_KEYWORD}&per_page=1`, {
                signal: ctrl.signal,
                headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'skkill' },
            });
            clearTimeout(timer);
            if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
            return { ok: true };
        } catch (err) {
            return { ok: false, reason: (err as Error).message };
        }
    }

    async search(query: string, opts: { limit?: number } = {}): Promise<SearchResult[]> {
        const limit = opts.limit ?? 20;
        // 主关键词 (用户输入) 必带,辅关键词 "skill" 兜底,确保 ai-agent-skill 之类也能命中
        const q = encodeURIComponent(`${query} ${SEARCH_KEYWORD}`);
        const url = `${GITHUB_API}/search/repositories?q=${q}&per_page=${Math.min(limit, 100)}`;
        try {
            const res = await fetch(url, {
                headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'skkill' },
            });
            if (!res.ok) return [];
            const data = (await res.json()) as {
                items?: {
                    full_name: string;
                    description: string | null;
                    html_url: string;
                    stargazers_count: number;
                    updated_at: string;
                }[];
            };
            return (data.items ?? []).slice(0, limit).map(it => ({
                name: it.full_name,
                description: it.description ?? '',
                url: it.html_url,
                stars: it.stargazers_count,
                updatedAt: it.updated_at,
                source: 'github',
            }));
        } catch {
            return [];
        }
    }

    async resolve(ref: string): Promise<ResolvedSource> {
        if (/^[\w.-]+\/[\w.-]+$/.test(ref)) {
            return { ref, kind: 'git', gitUrl: `https://github.com/${ref}.git` };
        }
        if (ref.startsWith('git@') || ref.startsWith('https://') || ref.startsWith('git://') || ref.endsWith('.git')) {
            return { ref, kind: 'git', gitUrl: ref };
        }
        throw new SkitError('E_BACKEND_UNAVAILABLE', `github backend 无法解析 ref: ${ref}`);
    }

    async fetch(source: ResolvedSource, destDir: string): Promise<FetchResult> {
        if (!source.gitUrl) throw new SkitError('E_BACKEND_UNAVAILABLE', 'github backend 需要 gitUrl');
        await clone(source.gitUrl, destDir, { shallow: true });
        // 在 destDir 子树里找 SKILL.md (排除 .git)
        const skillDir = await findSkillDir(destDir);
        const pkg = await readPackageJson(skillDir);
        return { skillPath: skillDir, version: pkg?.version };
    }

    async upgrade(skillPath: string): Promise<{ from: string; to: string }> {
        const before = (await readPackageJson(skillPath))?.version ?? '0.0.0';
        await pull(skillPath);
        const after = (await readPackageJson(skillPath))?.version ?? before;
        return { from: before, to: after };
    }
}

// BFS 找含 SKILL.md 的最近目录 (排除 .git 内部)
async function findSkillDir(root: string): Promise<string> {
    const fs2 = await import('node:fs/promises');
    const path2 = await import('node:path');
    const queue: string[] = [root];
    let fallback: string | undefined;
    while (queue.length > 0) {
        const dir = queue.shift()!;
        const entries = await fs2.readdir(dir).catch(() => [] as string[]);
        if (entries.includes('SKILL.md')) return dir;
        for (const e of entries) {
            if (e === '.git' || e.startsWith('.')) continue;
            const full = path2.join(dir, e);
            const stat = await fs2.stat(full).catch(() => null);
            if (stat?.isDirectory()) queue.push(full);
        }
        if (!fallback && entries.length > 0) fallback = dir;
    }
    throw new SkitError('E_INVALID_SKILL', `仓库中找不到 SKILL.md: ${root}`);
}
