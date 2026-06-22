import { BaseAdapter } from './base.js';
import type { AgentId } from '../types/agent.js';

// v1:仅声明元信息 + 路径检测,apply/unapply 由 Phase 1 的 lib/symlinker.ts 通过 mixin 提供
export class ClaudeCodeAdapter extends BaseAdapter {
    readonly id: AgentId = 'claudecode';
    readonly displayName = 'Claude Code';
    readonly homeEnvVar = 'CLAUDE_CONFIG_DIR';
}
