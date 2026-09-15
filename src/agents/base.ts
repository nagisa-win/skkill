import { DEFAULT_SKILLS_DIRS } from '../constants.js';
import { resolveAgentSkillsDir } from '../lib/config.js';
import type { AgentAdapter, AgentId, AgentConfigInput } from '../types/agent.js';

// 抽象基类:仅声明元信息 + 路径检测,apply/unapply/isApplied 由 lib/symlinker.ts 单独提供
export abstract class BaseAdapter implements Omit<AgentAdapter, 'apply' | 'unapply' | 'isApplied'> {
    abstract readonly id: AgentId;
    abstract readonly displayName: string;
    abstract readonly homeEnvVar?: string;

    // env home 与 skills 目录之间的子路径,如 opencode 需要拼 'opencode' ($XDG_CONFIG_HOME/opencode/skills)
    envSkillsSubPath?: string;

    defaultSkillsDir(): string {
        return DEFAULT_SKILLS_DIRS[this.id];
    }

    async detectSkillsDir(config: AgentConfigInput): Promise<string> {
        return resolveAgentSkillsDir(this.id, config, this.defaultSkillsDir(), this.envSkillsSubPath);
    }
}
