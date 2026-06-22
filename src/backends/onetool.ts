import path from 'node:path';
import fs from 'node:fs/promises';
import unzipper from 'unzipper';
import { BaseBackend } from './base.js';
import { SkitError, logger } from '../utils/logger.js';
import { ONETOOL_BOS_HOST, ConfigKey } from '../constants.js';
import { getConfigValue } from '../lib/config-resolver.js';
import { loadConfigSilent } from '../lib/config.js';
import { readPackageJson } from '../lib/package-json.js';
import type { ResolvedSource, FetchResult, SearchResult } from '../types/backend.js';

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SEARCH_TIMEOUT_MS = 8000;

// 字段名在不同版本可能命名不同,优先 bosUrl, 兜底多种
function pickBosUrl(row: Record<string, unknown>): string | undefined {
    const candidates = ['bosUrl', 'bos_url', 'downloadUrl', 'download_url', 'url'];
    for (const k of candidates) {
        const v = row[k];
        if (typeof v === 'string' && v.length > 0) return v;
    }
    return undefined;
}

interface OnetoolMetaRow {
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

function rowToSearchResult(row: OnetoolMetaRow): SearchResult | null {
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

export class OnetoolBackend extends BaseBackend {
    readonly id = 'onetool' as const;
    readonly displayName = 'OneTool (内网)';

    // 缓存 apiBase (避免每次请求都读 config)
    private cachedApiBase: string | undefined;
    private cachedApiBaseAt = 0;
    private static CACHE_TTL_MS = 0; // 0 = 进程内不刷新

    // 走 config-resolver: env > config.yaml > 默认;未配置时调用方应回退
    private async apiBase(): Promise<string | undefined> {
        const now = Date.now();
        if (this.cachedApiBase && now - this.cachedApiBaseAt < OnetoolBackend.CACHE_TTL_MS) {
            return this.cachedApiBase;
        }
        const config = await loadConfigSilent();
        const v = getConfigValue(ConfigKey.OnetoolApiBase, config);
        if (v) {
            this.cachedApiBase = v;
            this.cachedApiBaseAt = now;
        }
        return v;
    }

    async available(): Promise<{ ok: boolean; reason?: string }> {
        const base = await this.apiBase();
        if (!base)
            return {
                ok: false,
                reason: 'onetool apiBase 未配置 (config.yaml 中 backend.onetool.apiBase 或 env SKKILL_BACKEND_ONETOOL_API_BASE)',
            };
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
            const res = await fetch(`${base}/skills/metadata`, { signal: ctrl.signal });
            clearTimeout(timer);
            if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
            const json = (await res.json()) as { code?: number; data?: unknown };
            if (json.code !== 200) return { ok: false, reason: `API code ${json.code}` };
            return { ok: true };
        } catch (err) {
            return { ok: false, reason: (err as Error).message };
        }
    }

    async search(query: string, opts: { limit?: number } = {}): Promise<SearchResult[]> {
        const base = await this.apiBase();
        if (!base) throw new SkitError('E_BACKEND_UNAVAILABLE', 'onetool apiBase 未配置,无法 search');
        const limit = opts.limit ?? 20;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
        let json: { code?: number; data?: OnetoolMetaRow[]; message?: string };
        try {
            const res = await fetch(`${base}/skills/metadata`, { signal: ctrl.signal });
            if (!res.ok) throw new SkitError('E_BACKEND_UNAVAILABLE', `onetool search HTTP ${res.status}`);
            json = (await res.json()) as { code?: number; data?: OnetoolMetaRow[]; message?: string };
        } catch (err) {
            if (err instanceof SkitError) throw err;
            throw new SkitError('E_BACKEND_UNAVAILABLE', `onetool search failed: ${(err as Error).message}`);
        } finally {
            clearTimeout(timer);
        }
        if (json.code !== 200)
            throw new SkitError('E_BACKEND_UNAVAILABLE', `onetool search code ${json.code}: ${json.message ?? ''}`);
        const rows = Array.isArray(json.data) ? json.data : [];
        const q = query.toLowerCase();
        const matched = rows
            .map(rowToSearchResult)
            .filter((r): r is SearchResult => r !== null)
            .filter(r => {
                if (!q) return true;
                return r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
            });
        return matched.slice(0, limit);
    }

    async resolve(ref: string): Promise<ResolvedSource> {
        if (!NAME_PATTERN.test(ref)) {
            throw new SkitError('E_BACKEND_UNAVAILABLE', `onetool backend 仅支持 kebab-case 名称: ${ref}`);
        }
        const base = await this.apiBase();
        if (!base) throw new SkitError('E_BACKEND_UNAVAILABLE', 'onetool apiBase 未配置,无法 resolve');
        // 1) metadata 查最新 version
        let version: string | undefined;
        try {
            const metaRes = await fetch(`${base}/skills/metadata`);
            if (metaRes.ok) {
                const metaJson = (await metaRes.json()) as { code?: number; data?: OnetoolMetaRow[] };
                if (metaJson.code === 200 && Array.isArray(metaJson.data)) {
                    const hit = metaJson.data.find(r => (r.skillName ?? r.skill_name ?? r.name) === ref);
                    version = hit?.version ? String(hit.version) : undefined;
                }
            }
        } catch {
            // metadata 失败不阻断,继续走 package 端点
        }
        // 2) package 端点取 BOS URL
        const pkgRes = await fetch(`${base}/skills/package?skillIdentifier=${encodeURIComponent(ref)}`);
        if (!pkgRes.ok) {
            throw new SkitError('E_BACKEND_UNAVAILABLE', `onetool package HTTP ${pkgRes.status} for ${ref}`);
        }
        const pkgJson = (await pkgRes.json()) as {
            code?: number;
            data?: Record<string, unknown>;
            message?: string;
        };
        if (pkgJson.code !== 200) {
            throw new SkitError(
                'E_BACKEND_UNAVAILABLE',
                `onetool package code ${pkgJson.code} for ${ref}: ${pkgJson.message ?? ''}`
            );
        }
        const bosUrl = pickBosUrl(pkgJson.data ?? {});
        if (!bosUrl) {
            throw new SkitError('E_BACKEND_UNAVAILABLE', `onetool package 未返回 bosUrl for ${ref}`);
        }
        return {
            ref,
            kind: 'registry',
            package: ref,
            downloadUrl: bosUrl,
            registryVersion: version,
            version,
        };
    }

    async fetch(source: ResolvedSource, destDir: string): Promise<FetchResult> {
        if (!source.downloadUrl) {
            throw new SkitError('E_BACKEND_UNAVAILABLE', 'onetool backend 需要 downloadUrl');
        }
        const skillName = source.package ?? source.ref;
        // 下载 zip
        const res = await fetch(source.downloadUrl);
        if (!res.ok || !res.body) {
            throw new SkitError('E_BACKEND_UNAVAILABLE', `download HTTP ${res.status} for ${source.downloadUrl}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const zipPath = path.join(destDir, `${skillName}.zip`);
        await fs.writeFile(zipPath, buf);
        try {
            // 解压到 destDir/<skillName>
            const targetDir = path.join(destDir, skillName);
            await fs.mkdir(targetDir, { recursive: true });
            const dir = await unzipper.Open.file(zipPath);
            await dir.extract({ path: targetDir });
            // zip 通常含 <name>/ 子目录;若有 SKILL.md 在子目录,把它上提到 targetDir
            const flatSkillDir = await flattenSkillDir(targetDir, skillName);
            const pkg = await readPackageJson(flatSkillDir);
            return { skillPath: flatSkillDir, version: pkg?.version ?? source.registryVersion };
        } finally {
            // 清理 zip 临时文件
            await fs.unlink(zipPath).catch(() => {});
        }
    }

    async upgrade(skillPath: string): Promise<{ from: string; to: string }> {
        const before = (await readPackageJson(skillPath))?.version ?? '0.0.0';
        // 复用 resolve + fetch 重新拉取,然后覆盖
        const source = await this.resolve(path.basename(skillPath));
        const fs2 = await import('node:fs/promises');
        const os = await import('node:os');
        const tmpDir = await fs2.mkdtemp(path.join(os.tmpdir(), 'skkill-up-'));
        try {
            const fetched = await this.fetch(source, tmpDir);
            const after = fetched.version ?? before;
            // 覆盖到原路径:删除再 copy
            const stat = await fs2.stat(skillPath).catch(() => null);
            if (stat?.isDirectory()) await fs2.rm(skillPath, { recursive: true, force: true });
            await fs2.cp(fetched.skillPath, skillPath, { recursive: true });
            return { from: before, to: after };
        } finally {
            await fs2.rm(tmpDir, { recursive: true, force: true });
        }
    }
}

// 检测 unzip 后的目录布局:
//   情况 A: 顶层就是 SKILL.md (扁平 zip) → 直接返回 targetDir
//   情况 B: 只有单个子目录 <inner>/, SKILL.md 在里面 → 返回 <targetDir>/<inner>
//   情况 C: 顶层多个条目 → 返回 targetDir (有 SKILL.md 即合法)
async function flattenSkillDir(targetDir: string, expectedName: string): Promise<string> {
    const entries = await fs.readdir(targetDir);
    if (entries.includes('SKILL.md')) {
        // 顶层就是 SKILL.md,但可能混了 zip 文件,清理
        await cleanJunkFiles(targetDir);
        return targetDir;
    }
    // 单子目录情形
    if (entries.length === 1) {
        const only = entries[0]!;
        const inner = path.join(targetDir, only);
        const stat = await fs.stat(inner).catch(() => null);
        if (stat?.isDirectory() && (await fs.readdir(inner)).includes('SKILL.md')) {
            // 把 inner 内容上提到 targetDir,然后删 inner
            const tempRename = `${targetDir}__${only}`;
            await fs.rename(inner, tempRename);
            await fs.rm(targetDir, { recursive: true, force: true });
            await fs.rename(tempRename, targetDir);
            await cleanJunkFiles(targetDir);
            logger.info(`Flattened nested ${expectedName}/${only} → ${expectedName}/`);
            return targetDir;
        }
    }
    // 兜底:还有 .skill-meta.json 之类,SKILL.md 必须在,否则报错
    if (!entries.some(e => e.toLowerCase() === 'skill.md')) {
        throw new SkitError('E_INVALID_SKILL', `下载的 zip 中找不到 SKILL.md: ${targetDir}`);
    }
    return targetDir;
}

// 清理 zip 内附带的无用文件 (.DS_Store / 同名 .zip)
async function cleanJunkFiles(dir: string): Promise<void> {
    for (const name of await fs.readdir(dir)) {
        if (name === '.DS_Store' || name.endsWith('.zip') || name.endsWith('.zip.zip')) {
            await fs.rm(path.join(dir, name), { recursive: true, force: true });
        }
    }
}
