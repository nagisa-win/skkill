import type { AgentId } from './agent.js';

export interface AgentConfig {
    skillsDirOverride?: string;
    enabled?: boolean;
}

export interface LLMConfig {
    provider: 'anthropic' | 'openai';
    apiKey?: string;
    model?: string;
    // 自定义端点: 用于内网代理 / 国产 LLM 网关 / 第三方兼容 OpenAI 协议的 endpoint
    // anthropic 默认 https://api.anthropic.com; openai 默认 https://api.openai.com/v1
    // 例: openai 兼容网关 → https://your-gateway.example.com/v1
    //     anthropic 代理 → https://your-proxy.example.com
    baseUrl?: string;
}

export interface OnetoolBackendConfig {
    apiBase?: string;
}

export interface GitHubBackendConfig {
    token?: string;
}

export interface NpxSkillBackendConfig {
    bin?: string;
    baseUrl?: string;
}

export interface BackendConfig {
    provider: 'onetool' | 'npx-skill' | 'git' | 'github';
    npxSkill?: NpxSkillBackendConfig;
    onetool?: OnetoolBackendConfig;
    github?: GitHubBackendConfig;
}

export interface PublisherConfig {
    // oneskill 可执行文件路径;留空时探测 PATH / ~/.oneskill-cli/bin/oneskill
    bin?: string;
    // 平台要求最低版本,默认 1.0.1
    minVersion?: string;
}

export interface ConfigFile {
    version: 1;
    installRoot?: string;
    agents?: Partial<Record<AgentId, AgentConfig>>;
    backend?: BackendConfig;
    llm?: LLMConfig;
    publisher?: PublisherConfig;
}
