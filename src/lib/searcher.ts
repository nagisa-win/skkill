import { SkitError } from '../utils/logger.js';
import type { SearchResult, BackendId } from '../types/backend.js';
import { BACKENDS } from '../backends/index.js';

export interface SearchOptions {
    limit?: number;
    backend?: BackendId; // 指定单 backend
    noFallback?: boolean; // 指定单 backend 时,不再回退
}

// 默认: onetool 优先, 空结果 / 未配置 时回退到 GitHub topic 搜索
// 指定 backend=onetool|github 时只走单一源 (未配置时直接报)
export async function searchSkill(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const limit = opts.limit ?? 20;

    if (opts.backend) {
        const b = BACKENDS[opts.backend];
        if (!b) return [];
        return b.search(query, { limit });
    }

    // 链: onetool → github
    // onetool 未配置或不可达时静默回退 (不抛错)
    let onetoolResults: SearchResult[] = [];
    try {
        onetoolResults = await BACKENDS.onetool.search(query, { limit });
    } catch (err) {
        if (!(err instanceof SkitError) || err.code !== 'E_BACKEND_UNAVAILABLE') {
            // 真正的网络/解析错误也回退 (避免空结果被误认为"无匹配")
            onetoolResults = [];
        }
    }
    if (onetoolResults.length > 0) {
        return onetoolResults.map(r => ({ ...r, source: r.source ?? ('onetool' as const) }));
    }
    try {
        const github = await BACKENDS.github.search(query, { limit });
        return github.map(r => ({ ...r, source: r.source ?? ('github' as const) }));
    } catch {
        return [];
    }
}
