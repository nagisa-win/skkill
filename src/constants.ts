import path from 'node:path';
import os from 'node:os';

export const SKKILL_VERSION = '0.1.1';

// ====== 路径常量 (内部分用,与内网配置无关) ======
export const SKKILL_HOME = path.join(os.homedir(), '.skkill');
export const CONFIG_PATH = path.join(SKKILL_HOME, 'config.yaml');
export const DEFAULT_INSTALL_ROOT = path.join(SKKILL_HOME, 'skills');
export const DEFAULT_BRANCH = 'main';

// ====== Agent 默认 Skills 目录 ======
export const DEFAULT_SKILLS_DIRS = {
    claudecode: path.join(os.homedir(), '.claude', 'skills'),
    codex: path.join(os.homedir(), '.codex', 'skills'),
    opencode: path.join(os.homedir(), '.config', 'opencode', 'skills'),
    openclaw: path.join(os.homedir(), '.openclaw', 'skills'),
    cursor: path.join(os.homedir(), '.cursor', 'skills'),
    continue: path.join(os.homedir(), '.continue', 'skills'),
    aider: path.join(os.homedir(), '.aider', 'skills'),
} as const;

export const AGENT_HOME_ENV = {
    claudecode: 'CLAUDE_CONFIG_DIR',
    codex: 'CODEX_HOME',
    opencode: 'XDG_CONFIG_HOME',
    openclaw: 'OPENCLAW_HOME',
    cursor: 'CURSOR_HOME',
    continue: 'CONTINUE_GLOBAL_DIR',
    aider: 'AIDER_HOME',
} as const;

// ====== 后端默认 (无内网数据) ======
export const DEFAULT_BACKEND = 'onetool';
export const NPX_SKILL_BIN = ['npx', '--yes', 'skill'];

// ====== onetool 公开 BOS host (CDN 域名,不属于内网配置) ======
export const ONETOOL_BOS_HOST = 'https://bj.bcebos.com/onetool/skills-json';

// ====== LLM 默认 (公开模型名) ======
export const DEFAULT_LLM_PROVIDER = 'anthropic';
export const DEFAULT_LLM_MODELS = {
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4o',
} as const;

// ====== GitHub search 默认关键词 (公开,非内网配置) ======
export const GITHUB_SKILL_KEYWORD = 'skill';

// ====== Publisher 默认 (非内网值) ======
export const ONESKILL_MIN_VERSION = '1.0.1';

// ====== ConfigKey: process.env 与 config.json 的映射表 ======
// 命名规则: <领域>.<子项>,全部大写后转 SKKILL_<UPPER>_<UPPER> 即为 env 变量名
// 例: ConfigKey.OnetoolApiBase → SKKILL_ONETOOL_API_BASE
export const ConfigKey = {
    // backend
    BackendProvider: 'backend.provider',
    OnetoolApiBase: 'backend.onetool.apiBase',
    GitHubToken: 'backend.github.token',
    // llm
    LLMProvider: 'llm.provider',
    LLMApiKey: 'llm.apiKey',
    LLMModel: 'llm.model',
    LLMBaseUrl: 'llm.baseUrl',
    // publisher
    PublisherBin: 'publisher.bin',
    PublisherMinVersion: 'publisher.minVersion',
    // paths
    InstallRoot: 'installRoot',
} as const;

export type ConfigKeyName = (typeof ConfigKey)[keyof typeof ConfigKey];

// ConfigKey → 对应 env 变量名
// 规则: 点分转下划线 + 全部大写 + camelCase 边界拆出下划线
// 例: 'backend.onetool.apiBase' → SKKILL_BACKEND_ONETOOL_API_BASE
//     'llm.apiKey'              → SKKILL_LLM_API_KEY
//     'publisher.minVersion'    → SKKILL_PUBLISHER_MIN_VERSION
export function configKeyToEnv(key: ConfigKeyName): string {
    const withUnderscores = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
    return 'SKKILL_' + withUnderscores.toUpperCase().replace(/\./g, '_');
}
