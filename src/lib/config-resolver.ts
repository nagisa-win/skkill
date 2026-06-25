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
    const envVal = process.env[envName];
    if (envVal !== undefined && envVal !== '') return envVal;

    const cfgVal = lookupInConfig(config, key);
    if (cfgVal !== undefined && cfgVal !== '') return String(cfgVal);

    const hard = HARDCODED_DEFAULT[key];
    if (hard !== undefined && hard !== '') return String(hard);

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
