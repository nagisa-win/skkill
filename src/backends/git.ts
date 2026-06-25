import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { BaseBackend } from './base.js';
import { clone, pull } from '../lib/git.js';
import { parseSource, resolveLocalPath } from '../lib/source-parser.js';
import { SkitError } from '../utils/logger.js';
import { readPackageJson } from '../lib/package-json.js';
import type { ResolvedSource, FetchResult, SearchResult } from '../types/backend.js';

// git backend:兜底 backend,不依赖 npx skill
// 主要支持 git URL (git@, https://, .git 后缀) / owner/repo 简写 / 本地路径
export class GitBackend extends BaseBackend {
    readonly id = 'git' as const;
    readonly displayName = 'Git (GitHub)';

    async available(): Promise<{ ok: boolean; reason?: string }> {
        try {
            execSync('git --version', { stdio: 'ignore' });
            return { ok: true };
        } catch {
            return { ok: false, reason: 'git binary not found in PATH' };
        }
    }

    async search(_query: string, _opts?: { limit?: number }): Promise<SearchResult[]> {
        // v1 git backend 不实现搜索,搜索由 npx-skill backend 提供
        // 这里返回空数组,searcher 会回退到 npx-skill
        return [];
    }

    async resolve(ref: string): Promise<ResolvedSource> {
        const parsed = parseSource(ref);
        switch (parsed.kind) {
            case 'git-url':
                return { ref, kind: 'git', gitUrl: parsed.url };
            case 'local':
                return { ref, kind: 'git', gitUrl: `file://${resolveLocalPath(parsed.path)}` };
            case 'owner-repo':
                return { ref, kind: 'git', gitUrl: `https://github.com/${parsed.owner}/${parsed.repo}.git` };
            default:
                throw new SkitError('E_BACKEND_UNAVAILABLE', `git backend 无法解析 ref: ${ref}`);
        }
    }

    async fetch(source: ResolvedSource, destDir: string): Promise<FetchResult> {
        if (!source.gitUrl) throw new SkitError('E_BACKEND_UNAVAILABLE', 'git backend 需要 gitUrl');
        await clone(source.gitUrl, destDir, { shallow: true });
        // BFS 找含 SKILL.md 的最近目录 (排除 .git 内部)
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

// isGitUrl / isLocalPath 已迁到 src/lib/source-parser.ts (统一 parseSource 入口)

// BFS 找含 SKILL.md 的最近目录 (排除 .git 内部)
// 顶层就有 SKILL.md → 直接返回 destDir
// 顶层无但子目录有 → 返回子目录
// 都没有 → 抛 E_INVALID_SKILL
async function findSkillDir(root: string): Promise<string> {
    const queue: string[] = [root];
    while (queue.length > 0) {
        const dir = queue.shift()!;
        const entries = await fs.readdir(dir).catch(() => [] as string[]);
        if (entries.includes('SKILL.md')) return dir;
        for (const e of entries) {
            if (e === '.git' || e.startsWith('.')) continue;
            const full = path.join(dir, e);
            const stat = await fs.stat(full).catch(() => null);
            if (stat?.isDirectory()) queue.push(full);
        }
    }
    throw new SkitError('E_INVALID_SKILL', `仓库中找不到 SKILL.md: ${root}`);
}
