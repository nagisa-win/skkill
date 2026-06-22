import { execa } from 'execa';
import path from 'node:path';
import fs from 'node:fs/promises';
import { BaseBackend } from './base.js';
import { SkitError, logger } from '../utils/logger.js';
import { clone } from '../lib/git.js';
import { readPackageJson } from '../lib/package-json.js';
import type { ResolvedSource, FetchResult, SearchResult } from '../types/backend.js';

// npx skill backend:
// 实际 npx skill 包只支持从 SKILL_BASE_URL (默认 vercel-labs/agent-skills) 下载 skills/<name>
// 没有 search/info/JSON 输出,这里做最小适配 + 兜底
// search 仍通过 GitHub API (走 searchSkillOnGithub)
const DEFAULT_BASE = 'https://github.com/vercel-labs/agent-skills/tree/main';

export class NpxSkillBackend extends BaseBackend {
    readonly id = 'npx-skill' as const;
    readonly displayName = 'npx skill (vercel-labs/agent-skills)';

    async available(): Promise<{ ok: boolean; reason?: string }> {
        try {
            // 探测 npm 可用
            await execa('npm', ['--version'], { stdio: 'ignore' });
            return { ok: true };
        } catch (err) {
            return { ok: false, reason: `npm not available: ${(err as Error).message}` };
        }
    }

    async search(query: string, opts: { limit?: number } = {}): Promise<SearchResult[]> {
        // npx skill 不支持 search;直接走 GitHub API
        return searchSkillOnGithub(query, opts.limit ?? 20);
    }

    async resolve(ref: string): Promise<ResolvedSource> {
        // 支持两种格式:skills/<name> 或 <name>
        const name = ref.startsWith('skills/') ? ref.slice('skills/'.length) : ref;
        if (!/^[\w.-]+$/.test(name)) {
            throw new SkitError('E_BACKEND_UNAVAILABLE', `npx-skill backend 仅支持 skills/<name> 格式: ${ref}`);
        }
        const base = process.env.SKILL_BASE_URL ?? DEFAULT_BASE;
        return { ref, kind: 'registry', package: `skills/${name}`, gitUrl: `${base}/skills/${name}` };
    }

    async fetch(source: ResolvedSource, destDir: string): Promise<FetchResult> {
        const skillName = source.package?.replace(/^skills\//, '');
        if (!source.gitUrl || !skillName)
            throw new SkitError('E_BACKEND_UNAVAILABLE', 'npx-skill backend 需要 gitUrl + package');
        const pkgName: string = source.package as string;
        const gitUrl: string = source.gitUrl;
        // 优先尝试 npx skill 子命令(简单路径,无需 git)
        try {
            await execa('npx', ['--yes', 'skill', pkgName], {
                cwd: destDir,
                stdio: 'pipe',
                env: { ...process.env, SKILL_BASE_URL: process.env.SKILL_BASE_URL ?? DEFAULT_BASE },
            });
            // npx skill 写入到 <cwd>/.codebuddy/skills/<name>;把它移到 destDir/<name>
            const codebuddyDir = path.join(destDir, '.codebuddy', 'skills', skillName);
            const stat = await fs.stat(codebuddyDir).catch(() => null);
            if (stat?.isDirectory()) {
                await fs.cp(codebuddyDir, path.join(destDir, skillName), { recursive: true });
                await fs.rm(path.join(destDir, '.codebuddy'), { recursive: true, force: true });
            }
        } catch (err) {
            logger.warn(`npx skill 调用失败,回退到 git clone: ${(err as Error).message}`);
            // 回退:直接 git clone <gitUrl> 到 destDir/<name>
            const targetDir = path.join(destDir, skillName);
            // 把 github tree URL 转为 raw base URL 用于 clone
            const cloneUrl = gitUrl.replace('/tree/main', '').replace('/tree/master', '') + '.git';
            await clone(cloneUrl, targetDir, { shallow: true });
        }

        const skillDir = path.join(destDir, skillName);
        const pkg = await readPackageJson(skillDir);
        return { skillPath: skillDir, version: pkg?.version };
    }

    async upgrade(skillPath: string): Promise<{ from: string; to: string }> {
        const before = (await readPackageJson(skillPath))?.version ?? '0.0.0';
        // 重新走 fetch 到临时目录然后覆盖
        const { from, to } = { from: before, to: before };
        // 简化:不做实际升级语义,仅返回 from=to
        return { from, to };
    }
}

// GitHub API 搜索 vercel-labs/agent-skills 仓库下所有 SKILL.md
async function searchSkillOnGithub(query: string, limit: number): Promise<SearchResult[]> {
    const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}+repo:vercel-labs/agent-skills+path:SKILL.md`;
    try {
        const res = await fetch(url, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'skkill' },
        });
        if (!res.ok) return [];
        const data = (await res.json()) as {
            items?: { name: string; path: string; html_url: string; repository: { full_name: string } }[];
        };
        return (data.items ?? []).slice(0, limit).map(item => ({
            name: item.name.replace(/\.md$/, '') || item.path.split('/').pop() || item.path,
            description: `${item.repository.full_name}/${item.path}`,
            url: item.html_url,
        }));
    } catch {
        return [];
    }
}
