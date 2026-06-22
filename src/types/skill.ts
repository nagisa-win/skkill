// SKILL.md 的 YAML frontmatter (沿用 Claude Code 规范)
export interface SkillFrontmatter {
    name: string;
    description: string;
    when_to_use?: string;
    'allowed-tools'?: string[];
    'disable-model-invocation'?: boolean;
    'user-invocable'?: boolean;
    model?: string;
    context?: string;
    agent?: string;
    hooks?: Record<string, unknown>;
    paths?: string[];
    arguments?: string | string[];
    'argument-hint'?: string;
}

// package.json (扩展 npm schema, 加入 skkill 私有字段)
export interface SkillPackageJson {
    name: string;
    version: string;
    description: string;
    author?: string | { name: string; email?: string; url?: string };
    license?: string;
    repository?: { type: 'git'; url: string } | string;
    keywords?: string[];
    protocols?: Partial<Record<AgentId, boolean>>;
    skkill?: {
        source?: string;
        installedAt?: string;
        upgradedAt?: string;
        checksum?: string;
    };
}

import type { AgentId } from './agent.js';

// 运行时安装后的 skill 表示
export interface InstalledSkill {
    name: string;
    path: string;
    packageJson: SkillPackageJson;
    frontmatter: SkillFrontmatter;
    appliedAgents: AgentId[];
}
