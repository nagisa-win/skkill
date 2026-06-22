// Skill 注册表后端抽象 — onetool 内网为主, npx-skill / git 兜底
export type BackendId = 'onetool' | 'npx-skill' | 'git' | 'github';

export interface SearchResult {
    name: string;
    description: string;
    url: string;
    stars?: number;
    updatedAt?: string;
    version?: string;
    tags?: string[];
    skillId?: string | number;
    namespace?: string;
    source?: 'onetool' | 'github' | 'npx-skill';
}

export interface ResolvedSource {
    ref: string;
    kind: 'registry' | 'git';
    package?: string;
    gitUrl?: string;
    version?: string;
    downloadUrl?: string;
    registryVersion?: string;
}

export interface FetchResult {
    skillPath: string;
    version?: string;
}

export interface SkillBackend {
    id: BackendId;
    displayName: string;
    available(): Promise<{ ok: boolean; reason?: string }>;
    search(query: string, opts?: { limit?: number }): Promise<SearchResult[]>;
    resolve(ref: string): Promise<ResolvedSource>;
    fetch(source: ResolvedSource, destDir: string): Promise<FetchResult>;
    upgrade(skillPath: string): Promise<{ from: string; to: string }>;
}
