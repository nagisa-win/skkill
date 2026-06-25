import path from 'node:path';
import { expandHome } from '../utils/paths.js';

// ref 解析结果: source-parser 只负责"这是什么形态的 ref",不绑 backend 语义
// - local: 本地路径 (~/... / /... / ./... / ../...)
// - git-url: git SSH / HTTPS / git:// / .git 结尾
// - owner-repo: GitHub 简写 owner/repo (可带 subpath, 如 'vercel-labs/skills/frontend-design')
// - registry-name: onetool / npx-skill 等注册表名 (kebab-case)
export type ParsedSource =
    | { kind: 'local'; raw: string; path: string }
    | { kind: 'git-url'; raw: string; url: string }
    | { kind: 'owner-repo'; raw: string; owner: string; repo: string; subpath?: string }
    | { kind: 'registry-name'; raw: string; name: string };

const OWNER_REPO_RE = /^([\w.-]+)\/([\w.-]+)(?:\/(.+))?$/;
const GIT_URL_RE = /^(git@|https:\/\/|git:\/\/|file:\/\/)/;
const LOCAL_PREFIX_RE = /^(~\/|~\\|\/|\.\.?\/)/;
const REGISTRY_NAME_RE = /^@?[\w][^/]*$/;

// 唯一入口: 按 local → git-url → owner-repo → registry-name 优先级判定
// 子路径支持仅 owner-repo 形态;git-url 不做 URL 解析(让 git 自己处理)
export function parseSource(ref: string): ParsedSource {
    const trimmed = ref.trim();
    if (trimmed.length === 0) {
        throw new Error('parseSource: empty ref');
    }

    if (LOCAL_PREFIX_RE.test(trimmed) || trimmed === '~') {
        return { kind: 'local', raw: ref, path: expandHome(trimmed) };
    }

    if (GIT_URL_RE.test(trimmed) || trimmed.endsWith('.git')) {
        return { kind: 'git-url', raw: ref, url: trimmed };
    }

    const m = OWNER_REPO_RE.exec(trimmed);
    if (m) {
        const owner = m[1];
        const repo = m[2];
        const subpath = m[3];
        if (!owner || !repo) {
            // 正则保证匹配到这俩,兜底防御
            throw new Error(`parseSource: regex captured empty owner/repo for "${ref}"`);
        }
        return {
            kind: 'owner-repo',
            raw: ref,
            owner,
            repo,
            ...(subpath ? { subpath } : {}),
        };
    }

    if (REGISTRY_NAME_RE.test(trimmed)) {
        return { kind: 'registry-name', raw: ref, name: trimmed };
    }

    // 兜底: 无法识别的形态按 registry 名处理,让 backend 自己决定能不能解析
    return { kind: 'registry-name', raw: ref, name: trimmed };
}

// 把 local ref 解析为绝对路径 (供 backend 拼 file:// URL 用)
export function resolveLocalPath(ref: string): string {
    return path.resolve(expandHome(ref));
}