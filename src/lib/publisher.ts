import fs from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import matter from 'gray-matter';
import { SkitError } from '../utils/logger.js';
import { ConfigKey, ONETOOL_BOS_HOST, ONESKILL_MIN_VERSION as MIN_VERSION } from '../constants.js';
import { getConfigValue } from './config-resolver.js';
import { loadConfigSilent } from './config.js';

const HINT_INSTALL_MAC_LINUX = `curl -fsSL ${ONETOOL_BOS_HOST}/oneskill-cli/install.sh | bash`;
const HINT_INSTALL_WINDOWS = `irm ${ONETOOL_BOS_HOST}/oneskill-cli/install.ps1 | iex`;
const HINT_LOGIN = 'oneskill login --token <ugate-token>  (请从内网 onetool 平台获取 token)';

function buildFallbackPaths(configuredBin: string | undefined): string[] {
    return [configuredBin, 'oneskill', path.join(process.env.HOME ?? '', '.oneskill-cli/bin/oneskill')].filter(
        (p): p is string => Boolean(p)
    );
}

export type PublishScope = 'workspace' | 'hub';
export type PublishStatus = 'published_workspace' | 'published_hub' | 'publishing' | string;

export interface PublishOptions {
    skillPath: string;
    identifier: string;
    displayName: string;
    briefDesc: string;
    detailDoc: string;
    tagIds?: number[];
    workspaceId?: number;
    publishScope: PublishScope;
    update: boolean;
    skillId?: number;
}

export interface PublishResult {
    skillId: number;
    skillName: string;
    newSkillIdentifier: string;
    url: string;
    status: PublishStatus;
}

export interface OnetoolInfo {
    skillId: number;
    skillName: string;
    newSkillIdentifier: string;
    briefDesc?: string;
    detailDoc?: string;
}

interface ExecResult {
    bin: string;
    args: string[];
    stdout: string;
    stderr: string;
}

// 每次调用都查 config,避免与启动时缓存不一致
async function resolveOneskillBin(): Promise<string | undefined> {
    const config = await loadConfigSilent();
    return getConfigValue(ConfigKey.PublisherBin, config);
}

async function runOneskill(args: string[]): Promise<ExecResult> {
    const configuredBin = await resolveOneskillBin();
    const paths = buildFallbackPaths(configuredBin);
    let res;
    for (const bin of paths) {
        try {
            res = await execa(bin, args, { reject: false, all: true });
        } catch {
            // execa v9: 找不到二进制也可能 throw (即使 reject: false)
            continue;
        }
        // execa 对不在 PATH 的相对名会返回 exitCode=undefined
        const isMissing =
            res.exitCode === undefined ||
            res.exitCode === 127 ||
            /ENOENT|No such file|not found/i.test(`${res.stderr}\n${res.stdout}`);
        if (res.exitCode === 0) {
            return { bin, args, stdout: res.stdout, stderr: res.stderr };
        }
        if (isMissing) {
            continue;
        }
        throw new SkitError(
            'E_BACKEND_UNAVAILABLE',
            `oneskill ${args[0]} 失败 (exit ${res.exitCode}): ${res.stderr || res.stdout}`
        );
    }
    throw new SkitError(
        'E_BACKEND_UNAVAILABLE',
        `oneskill 未安装或不可用。请安装: ${HINT_INSTALL_MAC_LINUX} (Windows: ${HINT_INSTALL_WINDOWS})`
    );
}

async function detectOneskillVersion(): Promise<{ bin: string; version: string }> {
    const config = await loadConfigSilent();
    const minVersion = getConfigValue(ConfigKey.PublisherMinVersion, config) ?? MIN_VERSION;
    const { bin, stdout } = await runOneskill(['--version']);
    const version = stdout.trim().split(/\s+/).pop() ?? '';
    if (!version) throw new SkitError('E_BACKEND_UNAVAILABLE', 'oneskill --version 输出为空');
    if (compareSemver(version, minVersion) < 0) {
        throw new SkitError(
            'E_BACKEND_UNAVAILABLE',
            `oneskill 版本 ${version} 低于最低要求 ${minVersion},请执行 oneskill upgrade`
        );
    }
    return { bin, version };
}

function compareSemver(a: string, b: string): number {
    const pa = a.split('.').map(n => Number(n) || 0);
    const pb = b.split('.').map(n => Number(n) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const da = pa[i] ?? 0;
        const db = pb[i] ?? 0;
        if (da !== db) return da - db;
    }
    return 0;
}

function parseOneskillJson<T>(stdout: string): T {
    const trimmed = stdout.trim();
    if (!trimmed) throw new SkitError('E_LLM_INVALID_OUTPUT', 'oneskill 输出为空');
    try {
        return JSON.parse(trimmed) as T;
    } catch {
        throw new SkitError('E_LLM_INVALID_OUTPUT', `oneskill 输出不是合法 JSON: ${trimmed.slice(0, 200)}`);
    }
}

// 探测 oneskill 可用 + 版本;失败抛 E_BACKEND_UNAVAILABLE
export async function ensureOneskillAvailable(): Promise<{ bin: string; version: string }> {
    return detectOneskillVersion();
}

export interface CreatePublishInput {
    skillPath: string;
    displayName: string;
    briefDesc: string;
    detailDoc: string;
    tagIds: number[];
    workspaceId?: number;
    publishScope: PublishScope;
}

export async function createPublish(input: CreatePublishInput): Promise<PublishResult> {
    await readIdentifier(input.skillPath);
    const args = [
        'create',
        '--skill-path',
        input.skillPath,
        '--skill-name',
        input.displayName,
        '--brief-desc',
        input.briefDesc,
        '--detail-doc',
        input.detailDoc,
        '--tag-ids',
        input.tagIds.join(','),
    ];
    if (input.workspaceId !== undefined) args.push('--workspace-id', String(input.workspaceId));
    args.push('--publish-scope', input.publishScope);

    const { stdout } = await runOneskill(args);
    const parsed = parseOneskillJson<PublishResult>(stdout);
    if (typeof parsed.skillId !== 'number') {
        throw new SkitError('E_LLM_INVALID_OUTPUT', `oneskill create 返回缺少 skillId: ${stdout}`);
    }
    return parsed;
}

export interface UpdatePublishInput {
    skillPath: string;
    skillId: number;
    briefDesc: string;
    detailDoc: string;
    publishScope: PublishScope;
}

export async function updatePublish(input: UpdatePublishInput): Promise<PublishResult> {
    const args = [
        'update',
        '--skill-path',
        input.skillPath,
        '--skill-id',
        String(input.skillId),
        '--brief-desc',
        input.briefDesc,
        '--detail-doc',
        input.detailDoc,
        '--publish-scope',
        input.publishScope,
    ];
    const { stdout } = await runOneskill(args);
    return parseOneskillJson<PublishResult>(stdout);
}

export async function fetchOneskillInfo(skillPath: string): Promise<OnetoolInfo[]> {
    const { stdout } = await runOneskill(['info', '--skill-path', skillPath]);
    const data = parseOneskillJson<unknown>(stdout);
    if (!Array.isArray(data)) {
        throw new SkitError('E_LLM_INVALID_OUTPUT', `oneskill info 返回不是数组: ${stdout.slice(0, 200)}`);
    }
    return data as OnetoolInfo[];
}

export async function readIdentifier(skillPath: string): Promise<string> {
    const skillMd = await fs.readFile(path.join(skillPath, 'SKILL.md'), 'utf-8').catch(() => null);
    if (!skillMd) throw new SkitError('E_INVALID_SKILL', `SKILL.md 不存在: ${skillPath}`);
    const { data } = matter(skillMd);
    const name = (data as Record<string, unknown>).name;
    if (typeof name !== 'string' || !name) {
        throw new SkitError('E_INVALID_SKILL', 'SKILL.md frontmatter 缺少 name,无法发布');
    }
    return name;
}

// 发布成功后回写 .skill-meta.json,供下次 update 取 skill_id
export async function writeSkillMeta(skillPath: string, result: PublishResult): Promise<void> {
    const metaPath = path.join(skillPath, '.skill-meta.json');
    const existing = await fs
        .readFile(metaPath, 'utf-8')
        .then(t => {
            try {
                return JSON.parse(t) as Record<string, unknown>;
            } catch {
                return {};
            }
        })
        .catch(() => ({}) as Record<string, unknown>);
    const merged = {
        ...existing,
        skill_id: result.skillId,
        skill_identifier: result.newSkillIdentifier,
        skill_name: result.skillName,
        url: result.url,
        status: result.status,
        published_at: new Date().toISOString(),
    };
    await fs.writeFile(metaPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}

export const HINTS = {
    INSTALL_MAC_LINUX: HINT_INSTALL_MAC_LINUX,
    INSTALL_WINDOWS: HINT_INSTALL_WINDOWS,
    LOGIN: HINT_LOGIN,
    HUB_SCAN_NOTICE: '安全扫描正在进行中,请稍后于平台查看发布结果。\n如扫描不通过,将通过如流 OneTool 机器人进行通知。',
};

export const __testing = { compareSemver, parseOneskillJson, buildFallbackPaths };
