import path from 'node:path';
import fs from 'node:fs/promises';
import unzipper from 'unzipper';
import { BaseBackend } from './base.js';
import { SkitError, logger } from '../utils/logger.js';
import { ConfigKey } from '../constants.js';
import { getConfigValue } from '../lib/config-resolver.js';
import { loadConfigSilent } from '../lib/config.js';
import { readPackageJson, syncVersionFromMeta } from '../lib/package-json.js';
import type { ResolvedSource, FetchResult, SearchResult } from '../types/backend.js';
import {
    ONETOOL_METADATA_PAGE_SIZE,
    ONETOOL_NAME_PATTERN,
    ONETOOL_SEARCH_TIMEOUT_MS,
    fetchJson,
    packageToSearchResult,
    pickBosUrl,
    rowToSearchResult,
    type OnetoolMetaRow,
} from './onetool-util.js';

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
            const timer = setTimeout(() => ctrl.abort(), ONETOOL_SEARCH_TIMEOUT_MS);
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
        const q = query.trim();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), ONETOOL_SEARCH_TIMEOUT_MS);
        try {
            // 1) kebab-case 精确名优先走 package (不受 metadata 分页截断影响)
            if (ONETOOL_NAME_PATTERN.test(q)) {
                const exact = await this.searchByPackage(base, q, ctrl.signal);
                if (exact) return [exact];
            }
            // 2) 未命中 / 非精确名 → metadata 模糊兜底
            return await this.searchByMetadata(base, q, limit, ctrl.signal);
        } catch (err) {
            if (err instanceof SkitError) throw err;
            throw new SkitError('E_BACKEND_UNAVAILABLE', `onetool search failed: ${(err as Error).message}`);
        } finally {
            clearTimeout(timer);
        }
    }

    /** GET /skills/package?skillIdentifier=<name>; 404 返回 null */
    private async searchByPackage(
        base: string,
        skillName: string,
        signal: AbortSignal
    ): Promise<SearchResult | null> {
        const url = `${base}/skills/package?skillIdentifier=${encodeURIComponent(skillName)}`;
        const { ok, status, json } = await fetchJson(url, signal);
        const code = json.code as number | undefined;
        // 仅 404 视为未命中;其它 HTTP/业务错误向上抛,交给 searcher 回退 github
        if (status === 404 || code === 404) return null;
        if (!ok) {
            throw new SkitError('E_BACKEND_UNAVAILABLE', `onetool package HTTP ${status}`);
        }
        if (code !== 200) {
            throw new SkitError(
                'E_BACKEND_UNAVAILABLE',
                `onetool package code ${code}: ${String(json.message ?? '')}`
            );
        }
        const data = json.data;
        if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
        return packageToSearchResult(skillName, data as Record<string, unknown>);
    }

    /** GET /skills/metadata?pageSize=… 本地 name/description 包含匹配 */
    private async searchByMetadata(
        base: string,
        query: string,
        limit: number,
        signal: AbortSignal
    ): Promise<SearchResult[]> {
        const url = `${base}/skills/metadata?pageSize=${ONETOOL_METADATA_PAGE_SIZE}`;
        const { ok, status, json } = await fetchJson(url, signal);
        if (!ok) throw new SkitError('E_BACKEND_UNAVAILABLE', `onetool search HTTP ${status}`);
        if (json.code !== 200) {
            throw new SkitError(
                'E_BACKEND_UNAVAILABLE',
                `onetool search code ${json.code}: ${String(json.message ?? '')}`
            );
        }
        const rows = Array.isArray(json.data) ? (json.data as OnetoolMetaRow[]) : [];
        const q = query.toLowerCase();
        return rows
            .map(rowToSearchResult)
            .filter((r): r is SearchResult => r !== null)
            .filter(r => !q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
            .slice(0, limit);
    }

    async resolve(ref: string): Promise<ResolvedSource> {
        if (!ONETOOL_NAME_PATTERN.test(ref)) {
            throw new SkitError('E_BACKEND_UNAVAILABLE', `onetool backend 仅支持 kebab-case 名称: ${ref}`);
        }
        const base = await this.apiBase();
        if (!base) throw new SkitError('E_BACKEND_UNAVAILABLE', 'onetool apiBase 未配置,无法 resolve');
        // package 端点取 BOS URL + 版本 (比 metadata 全量扫描更准,也避开分页截断)
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
        const data = pkgJson.data ?? {};
        const bosUrl = pickBosUrl(data);
        if (!bosUrl) {
            throw new SkitError('E_BACKEND_UNAVAILABLE', `onetool package 未返回 bosUrl for ${ref}`);
        }
        const version = data.version != null ? String(data.version) : undefined;
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
            // onetool 源: 用 .skill-meta.json 的真实版本覆盖 package.json, 避免 to 仍是旧占位版本
            const synced = await syncVersionFromMeta(skillPath);
            return { from: before, to: synced ?? after };
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
