import type { AgentId } from '../types/agent.js';
import type { BaseAdapter } from './base.js';
import { ClaudeCodeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';

// v1 已实现的 adapter
const implemented: Partial<Record<AgentId, BaseAdapter>> = {
    claudecode: new ClaudeCodeAdapter(),
    codex: new CodexAdapter(),
};

// v1 可用列表(实际可用的 agent)
export const AVAILABLE_AGENTS: readonly BaseAdapter[] = Object.freeze(
    Object.values(implemented).filter((a): a is BaseAdapter => a !== undefined)
);

// 全部 agent id(包含 Phase 4 即将实现的 stub,目前查不到会返回 undefined)
export function getAgent(id: AgentId): BaseAdapter | undefined {
    return implemented[id];
}

export function listAvailable(): AgentId[] {
    return AVAILABLE_AGENTS.map(a => a.id);
}
