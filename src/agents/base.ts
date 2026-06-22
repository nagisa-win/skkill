import { DEFAULT_SKILLS_DIRS } from '../constants.js';
import { resolveAgentSkillsDir } from '../lib/config.js';
import type { AgentAdapter, AgentId, AgentConfigInput } from '../types/agent.js';

// 抽象基类:仅声明元信息 + 路径检测,apply/unapply/isApplied 由 lib/symlinker.ts 单独提供
export abstract class BaseAdapter implements Omit<AgentAdapter, 'apply' | 'unapply' | 'isApplied'> {
    abstract readonly id: AgentId;
    abstract readonly displayName: string;
    abstract readonly homeEnvVar?: string;

    defaultSkillsDir(): string {
        return DEFAULT_SKILLS_DIRS[this.id];
    }

    async detectSkillsDir(config: AgentConfigInput): Promise<string> {
        return resolveAgentSkillsDir(this.id, config, this.defaultSkillsDir());
    }
}
