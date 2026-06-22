import type { SkillBackend, ResolvedSource, FetchResult, SearchResult } from '../types/backend.js';

// 抽象基类,Phase 1 不实现完整接口,只保留结构
export abstract class BaseBackend implements SkillBackend {
    abstract readonly id: SkillBackend['id'];
    abstract readonly displayName: string;
    abstract available(): Promise<{ ok: boolean; reason?: string }>;
    abstract search(query: string, opts?: { limit?: number }): Promise<SearchResult[]>;
    abstract resolve(ref: string): Promise<ResolvedSource>;
    abstract fetch(source: ResolvedSource, destDir: string): Promise<FetchResult>;
    abstract upgrade(skillPath: string): Promise<{ from: string; to: string }>;
}
