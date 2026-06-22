// 配置解析: process.env > config.json > 默认值
// 每个 env key 显式列出 (避免 process.env 任意读)

import type { ConfigFile } from '../types/config.js';
import {
    ConfigKey,
    type ConfigKeyName,
    configKeyToEnv,
    DEFAULT_LLM_PROVIDER,
    DEFAULT_LLM_MODELS,
} from '../constants.js';

type Primitive = string | number | boolean | undefined;

// 各 key 的"硬编码默认" (非内网数据,公开常量)
const HARDCODED_DEFAULT: Partial<Record<ConfigKeyName, Primitive>> = {
    [ConfigKey.LLMProvider]: DEFAULT_LLM_PROVIDER,
    [ConfigKey.LLMModel]: '', // 由 provider 类自己挑默认
    [ConfigKey.PublisherMinVersion]: '1.0.1',
};

// LLM provider 单独查 model
function defaultModelFor(provider: string): string {
    if (provider === 'openai') return DEFAULT_LLM_MODELS.openai;
    return DEFAULT_LLM_MODELS.anthropic;
}

// 类型化取值
function lookupInConfig(config: ConfigFile, key: ConfigKeyName): Primitive {
    switch (key) {
        case ConfigKey.InstallRoot:
            return config.installRoot;
        case ConfigKey.BackendProvider:
            return config.backend?.provider;
        case ConfigKey.OnetoolApiBase:
            return config.backend?.onetool?.apiBase;
        case ConfigKey.GitHubToken:
            return config.backend?.github?.token;
        case ConfigKey.LLMProvider:
            return config.llm?.provider;
        case ConfigKey.LLMApiKey:
            return config.llm?.apiKey;
        case ConfigKey.LLMModel:
            return config.llm?.model;
        case ConfigKey.LLMBaseUrl:
            return config.llm?.baseUrl;
        case ConfigKey.PublisherBin:
            return config.publisher?.bin;
        case ConfigKey.PublisherMinVersion:
            return config.publisher?.minVersion;
    }
}

// 主入口: 取一个 string 类型的配置 (process.env > config.json > 默认)
export function getConfigValue(key: ConfigKeyName, config: ConfigFile): string | undefined {
    const envName = configKeyToEnv(key);
    // 1) 显式 env 优先 (除 SKKILL_LLM_API_KEY 这类,允许走 ANTHROPIC_API_KEY 这种"通用"env)
    const envVal = process.env[envName];
    if (envVal !== undefined && envVal !== '') return envVal;

    // 2) 兼容: 某些 key 也读行业通用 env (不强制)
    const aliased = aliasEnv(key);
    if (aliased) {
        const v = process.env[aliased];
        if (v !== undefined && v !== '') return v;
    }

    // 3) config.json
    const cfgVal = lookupInConfig(config, key);
    if (cfgVal !== undefined && cfgVal !== '') return String(cfgVal);

    // 4) 硬编码默认
    const hard = HARDCODED_DEFAULT[key];
    if (hard !== undefined && hard !== '') return String(hard);

    return undefined;
}

// 行业通用 env 变量名 (读 config.json 之前的兜底,优先级在 SKKILL_ 之后)
// 主人已明确"外部 process.env 覆盖 config.json",所以通用 env 也算 env
function aliasEnv(key: ConfigKeyName): string | undefined {
    if (key === ConfigKey.LLMApiKey) {
        const provider = process.env.SKKILL_LLM_PROVIDER ?? '';
        if (provider === 'openai') return 'OPENAI_API_KEY';
        if (provider === 'anthropic') return 'ANTHROPIC_API_KEY';
        return process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
    }
    return undefined;
}

// 取 LLM provider (并按 provider 自动选 model)
export function resolveLLMConfig(config: ConfigFile): {
    provider: 'anthropic' | 'openai';
    apiKey: string | undefined;
    model: string;
    baseUrl: string | undefined;
} {
    const provider =
        (getConfigValue(ConfigKey.LLMProvider, config) as 'anthropic' | 'openai' | undefined) ?? DEFAULT_LLM_PROVIDER;
    const apiKey = getConfigValue(ConfigKey.LLMApiKey, config);
    const model = getConfigValue(ConfigKey.LLMModel, config) || defaultModelFor(provider);
    const baseUrl = getConfigValue(ConfigKey.LLMBaseUrl, config);
    return { provider, apiKey, model, baseUrl };
}

// 列出当前所有 key 的"effective 值" + 来源 (用于 `skkill config show` / doctor)
export interface ConfigEntry {
    key: ConfigKeyName;
    value: string | undefined;
    source: 'env' | 'config' | 'default' | 'unset';
    envName: string;
}

export function listEffectiveConfig(config: ConfigFile): ConfigEntry[] {
    const keys = Object.values(ConfigKey);
    return keys.map(key => {
        const envName = configKeyToEnv(key);
        const envVal = process.env[envName];
        if (envVal !== undefined && envVal !== '') {
            return { key, value: envVal, source: 'env', envName };
        }
        const aliased = aliasEnv(key);
        if (aliased && process.env[aliased]) {
            return { key, value: process.env[aliased], source: 'env', envName: aliased };
        }
        const cfgVal = lookupInConfig(config, key);
        if (cfgVal !== undefined && cfgVal !== '') {
            return { key, value: String(cfgVal), source: 'config', envName };
        }
        const hard = HARDCODED_DEFAULT[key];
        if (hard !== undefined && hard !== '') {
            return { key, value: String(hard), source: 'default', envName };
        }
        return { key, value: undefined, source: 'unset', envName };
    });
}
