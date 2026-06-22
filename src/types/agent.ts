// Agent 标识符联合类型
export type AgentId = 'claudecode' | 'codex' | 'opencode' | 'openclaw' | 'cursor' | 'continue' | 'aider';

// detectSkillsDir 接受的配置子集(避免循环依赖)
export interface AgentConfigInput {
    agents?: Partial<Record<AgentId, { skillsDirOverride?: string }>>;
}

export interface AgentAdapter {
    id: AgentId;
    displayName: string;
    homeEnvVar?: string;
    defaultSkillsDir(): string;
    detectSkillsDir(config: AgentConfigInput): Promise<string>;
    apply(skill: import('./skill.js').InstalledSkill): Promise<{ linkedAt: string }>;
    unapply(skillName: string): Promise<void>;
    isApplied(skillName: string): Promise<boolean>;
}
