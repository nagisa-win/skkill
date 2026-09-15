import { BaseAdapter } from './base.js';
import type { AgentId } from '../types/agent.js';

export class OpenCodeAdapter extends BaseAdapter {
    readonly id: AgentId = 'opencode';
    readonly displayName = 'OpenCode';
    readonly homeEnvVar = 'XDG_CONFIG_HOME';

    // opencode 遵循 XDG 规范: skills 目录是 $XDG_CONFIG_HOME/opencode/skills,需要额外拼 'opencode' 段
    override envSkillsSubPath = 'opencode';
}
