import path from 'node:path';
import YAML from 'yaml';
import { CONFIG_PATH, SKKILL_HOME, DEFAULT_INSTALL_ROOT, AGENT_HOME_ENV } from '../constants.js';
import { ensureDir } from '../utils/paths.js';
import { atomicWrite, readFileOrNull } from '../utils/fs.js';
import { SkitError, logger } from '../utils/logger.js';
import { buildConfigTemplate } from './config-template.js';
import type { ConfigFile } from '../types/config.js';
import type { AgentId, AgentConfigInput } from '../types/agent.js';

// 文件不存在时,自动生成模板并返回空配置 (不抛错)
// 这样"没填配置"的用户能继续用部分功能
export async function loadConfig(configPath: string = CONFIG_PATH): Promise<ConfigFile> {
    const raw = await readFileOrNull(configPath);
    if (raw === null) {
        // 首次运行:写入模板 + 提示用户
        await ensureDir(SKKILL_HOME);
        await atomicWrite(configPath, buildConfigTemplate());
        logger.info(`已生成配置模板: ${configPath} (请按需编辑后再用 onetool / create 等功能)`);
        return { version: 1 };
    }
    try {
        const parsed = YAML.parse(raw) as ConfigFile | null | undefined;
        if (!parsed || typeof parsed !== 'object') return { version: 1 };
        if (parsed.version === undefined) {
            // 兼容老文件 / 用户手写时漏了 version,自动补 1
            return { ...parsed, version: 1 };
        }
        if (parsed.version !== 1)
            throw new SkitError('E_CONFIG_INVALID', `Unsupported config version: ${parsed.version}`);
        return parsed;
    } catch (err) {
        if (err instanceof SkitError) throw err;
        throw new SkitError('E_CONFIG_INVALID', `Failed to parse config at ${configPath}: ${(err as Error).message}`);
    }
}

// 静默版: 文件不存在不自动生成,仅返回空配置 (用于 unit test / 内部读取)
export async function loadConfigSilent(configPath: string = CONFIG_PATH): Promise<ConfigFile> {
    const raw = await readFileOrNull(configPath);
    if (raw === null) return { version: 1 };
    try {
        const parsed = YAML.parse(raw) as ConfigFile | null | undefined;
        if (!parsed || typeof parsed !== 'object') return { version: 1 };
        if (parsed.version === undefined) {
            // 兼容老文件 / 用户手写时漏了 version,自动补 1
            return { ...parsed, version: 1 };
        }
        if (parsed.version !== 1)
            throw new SkitError('E_CONFIG_INVALID', `Unsupported config version: ${parsed.version}`);
        return parsed;
    } catch (err) {
        if (err instanceof SkitError) throw err;
        throw new SkitError('E_CONFIG_INVALID', `Failed to parse config at ${configPath}: ${(err as Error).message}`);
    }
}

// 显式 init: 强制生成模板 (已存在则覆盖)
export async function initConfig(configPath: string = CONFIG_PATH): Promise<boolean> {
    const { pathExists } = await import('../utils/paths.js');
    const existed = await pathExists(configPath);
    await ensureDir(path.dirname(configPath));
    await atomicWrite(configPath, buildConfigTemplate());
    return existed;
}

export async function saveConfig(config: ConfigFile, configPath: string = CONFIG_PATH): Promise<void> {
    await ensureDir(path.dirname(configPath));
    await atomicWrite(configPath, YAML.stringify(config, { indent: 2, lineWidth: 0 }));
}

export function getInstallRoot(config: ConfigFile): string {
    return config.installRoot ?? DEFAULT_INSTALL_ROOT;
}

// 解析指定 agent 的 effective skills 目录:override > 环境变量 > fallback
export function resolveAgentSkillsDir(agentId: AgentId, config: AgentConfigInput, fallback: string): string {
    const override = config.agents?.[agentId]?.skillsDirOverride;
    if (override) return override;
    const envVar = AGENT_HOME_ENV[agentId];
    const envHome = envVar ? process.env[envVar] : undefined;
    if (envHome) return path.join(envHome, 'skills');
    return fallback;
}
