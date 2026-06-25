import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigKey, DEFAULT_LLM_MODELS, DEFAULT_LLM_PROVIDER } from '../constants.js';
import { getConfigValue, listEffectiveConfig, resolveLLMConfig } from './config-resolver.js';
import type { ConfigFile } from '../types/config.js';

const ENV_KEYS = [
    'SKKILL_INSTALL_ROOT',
    'SKKILL_BACKEND_PROVIDER',
    'SKKILL_BACKEND_ONETOOL_API_BASE',
    'SKKILL_BACKEND_GITHUB_TOKEN',
    'SKKILL_LLM_PROVIDER',
    'SKKILL_LLM_API_KEY',
    'SKKILL_LLM_MODEL',
    'SKKILL_LLM_BASE_URL',
    'SKKILL_PUBLISHER_BIN',
    'SKKILL_PUBLISHER_MIN_VERSION',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
];

function clearEnv() {
    for (const k of ENV_KEYS) delete process.env[k];
}

describe('getConfigValue — env > config > default', () => {
    beforeEach(clearEnv);
    afterEach(clearEnv);

    it('returns hardcoded default when env and config are empty', () => {
        const config: ConfigFile = { version: 1 };
        expect(getConfigValue(ConfigKey.LLMProvider, config)).toBe(DEFAULT_LLM_PROVIDER);
        expect(getConfigValue(ConfigKey.PublisherMinVersion, config)).toBe('1.0.1');
    });

    it('returns config value when env is unset and no hardcoded default', () => {
        const config: ConfigFile = {
            version: 1,
            installRoot: '/tmp/skills',
            backend: { onetool: { apiBase: 'http://x/api/v1' } },
        };
        expect(getConfigValue(ConfigKey.InstallRoot, config)).toBe('/tmp/skills');
        expect(getConfigValue(ConfigKey.OnetoolApiBase, config)).toBe('http://x/api/v1');
    });

    it('env beats config', () => {
        process.env.SKKILL_BACKEND_ONETOOL_API_BASE = 'http://env/api/v1';
        const config: ConfigFile = {
            version: 1,
            backend: { onetool: { apiBase: 'http://cfg/api/v1' } },
        };
        expect(getConfigValue(ConfigKey.OnetoolApiBase, config)).toBe('http://env/api/v1');
    });

    it('config beats hardcoded default', () => {
        const config: ConfigFile = { version: 1, llm: { provider: 'openai' } };
        expect(getConfigValue(ConfigKey.LLMProvider, config)).toBe('openai');
    });

    it('empty env string is treated as unset (falls through to config/default)', () => {
        process.env.SKKILL_BACKEND_ONETOOL_API_BASE = '';
        const config: ConfigFile = {
            version: 1,
            backend: { onetool: { apiBase: 'http://cfg/api/v1' } },
        };
        expect(getConfigValue(ConfigKey.OnetoolApiBase, config)).toBe('http://cfg/api/v1');
    });

    it('LLMApiKey: ONLY SKKILL_LLM_API_KEY env is honored (no alias)', () => {
        process.env.ANTHROPIC_API_KEY = 'anthropic-key';
        process.env.OPENAI_API_KEY = 'openai-key';
        const config: ConfigFile = { version: 1, llm: { provider: 'anthropic' } };
        expect(getConfigValue(ConfigKey.LLMApiKey, config)).toBeUndefined();
    });

    it('LLMApiKey: SKKILL_LLM_API_KEY env wins over config', () => {
        process.env.SKKILL_LLM_API_KEY = 'skkill-key';
        const config: ConfigFile = { version: 1, llm: { apiKey: 'cfg-key' } };
        expect(getConfigValue(ConfigKey.LLMApiKey, config)).toBe('skkill-key');
    });
});

describe('resolveLLMConfig', () => {
    beforeEach(clearEnv);
    afterEach(clearEnv);

    it('returns default model when none specified', () => {
        const config: ConfigFile = { version: 1 };
        const r = resolveLLMConfig(config);
        expect(r.provider).toBe(DEFAULT_LLM_PROVIDER);
        expect(r.model).toBe(DEFAULT_LLM_MODELS.anthropic);
    });

    it('picks model default for openai when none specified', () => {
        const config: ConfigFile = { version: 1, llm: { provider: 'openai' } };
        const r = resolveLLMConfig(config);
        expect(r.provider).toBe('openai');
        expect(r.model).toBe(DEFAULT_LLM_MODELS.openai);
    });

    it('uses explicit model from config', () => {
        const config: ConfigFile = { version: 1, llm: { model: 'gpt-4o-mini' } };
        const r = resolveLLMConfig(config);
        expect(r.model).toBe('gpt-4o-mini');
    });

    it('uses baseUrl from config', () => {
        const config: ConfigFile = { version: 1, llm: { baseUrl: 'https://gw.example.com/v1' } };
        const r = resolveLLMConfig(config);
        expect(r.baseUrl).toBe('https://gw.example.com/v1');
    });

    it('apiKey undefined when nothing set', () => {
        const config: ConfigFile = { version: 1 };
        expect(resolveLLMConfig(config).apiKey).toBeUndefined();
    });
});

describe('listEffectiveConfig', () => {
    beforeEach(clearEnv);
    afterEach(clearEnv);

    it('returns one entry per ConfigKey', () => {
        const config: ConfigFile = { version: 1 };
        const entries = listEffectiveConfig(config);
        expect(entries.length).toBe(Object.values(ConfigKey).length);
        for (const key of Object.values(ConfigKey)) {
            expect(entries.find(e => e.key === key)).toBeDefined();
        }
    });

    it('marks env source for env-set value', () => {
        process.env.SKKILL_PUBLISHER_BIN = '/custom/bin';
        const entries = listEffectiveConfig({ version: 1 });
        const entry = entries.find(e => e.key === ConfigKey.PublisherBin)!;
        expect(entry.source).toBe('env');
        expect(entry.value).toBe('/custom/bin');
        expect(entry.envName).toBe('SKKILL_PUBLISHER_BIN');
    });

    it('marks config source for config-set value', () => {
        const entries = listEffectiveConfig({
            version: 1,
            installRoot: '/cfg/skills',
        });
        const entry = entries.find(e => e.key === ConfigKey.InstallRoot)!;
        expect(entry.source).toBe('config');
        expect(entry.value).toBe('/cfg/skills');
    });

    it('marks default source for hardcoded default', () => {
        const entries = listEffectiveConfig({ version: 1 });
        const entry = entries.find(e => e.key === ConfigKey.PublisherMinVersion)!;
        expect(entry.source).toBe('default');
        expect(entry.value).toBe('1.0.1');
    });

    it('marks unset for no value anywhere', () => {
        const entries = listEffectiveConfig({ version: 1 });
        const entry = entries.find(e => e.key === ConfigKey.InstallRoot)!;
        expect(entry.source).toBe('unset');
        expect(entry.value).toBeUndefined();
    });
});

// 防止并行跑 test 时 process.env 互相影响
vi.useRealTimers();
