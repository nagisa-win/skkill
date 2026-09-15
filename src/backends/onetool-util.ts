import { ONETOOL_BOS_HOST } from '../constants.js';
import type { SearchResult } from '../types/backend.js';

export const ONETOOL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const ONETOOL_SEARCH_TIMEOUT_MS = 8000;
/** metadata 单页上限;接口实测 pageSize=5000 可一次拉全量 */
export const ONETOOL_METADATA_PAGE_SIZE = 5000;

export interface OnetoolMetaRow {
    name?: string;
    fullName?: string;
    full_name?: string;
    skillName?: string;
    skill_name?: string;
    description?: string;
    version?: string;
    tags?: string[];
    skillId?: string | number;
    skill_id?: string | number;
    id?: string | number;
    namespace?: string;
    url?: string;
    updatedAt?: string;
    updated_at?: string;
}

/** 字段名在不同版本可能命名不同,优先 bosUrl, 兜底多种 */
export function pickBosUrl(row: Record<string, unknown>): string | undefined {
    const candidates = ['bosUrl', 'bos_url', 'newBosUrl', 'downloadUrl', 'download_url', 'url'];
    for (const k of candidates) {
        const v = row[k];
        if (typeof v === 'string' && v.length > 0) return v;
    }
    return undefined;
}

export function rowToSearchResult(row: OnetoolMetaRow): SearchResult | null {
    const name = row.skillName ?? row.skill_name ?? row.fullName ?? row.full_name ?? row.name;
    if (!name) return null;
    return {
        name: String(name),
        description: String(row.description ?? ''),
        url: String(row.url ?? `${ONETOOL_BOS_HOST}/${name}`),
        version: row.version ? String(row.version) : undefined,
        tags: Array.isArray(row.tags) ? row.tags.map(String) : undefined,
        skillId: row.skillId ?? row.skill_id ?? row.id,
        namespace: row.namespace ? String(row.namespace) : undefined,
        updatedAt: row.updatedAt ?? row.updated_at,
        source: 'onetool',
    };
}

/** package 命中 → SearchResult;无 bosUrl → null (交给 metadata 兜底) */
export function packageToSearchResult(skillName: string, data: Record<string, unknown>): SearchResult | null {
    const bosUrl = pickBosUrl(data);
    if (!bosUrl) return null;
    return {
        name: skillName,
        description: typeof data.description === 'string' ? data.description : '',
        url: bosUrl,
        version: data.version != null ? String(data.version) : undefined,
        skillId: (data.skillId as string | number | undefined) ?? (data.skill_id as string | number | undefined),
        source: 'onetool',
    };
}

export async function fetchJson(
    url: string,
    signal: AbortSignal
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const res = await fetch(url, { signal });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, json };
}
