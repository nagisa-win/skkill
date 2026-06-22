import { BaseAdapter } from './base.js';
import type { AgentId } from '../types/agent.js';

export class CodexAdapter extends BaseAdapter {
    readonly id: AgentId = 'codex';
    readonly displayName = 'OpenAI Codex';
    readonly homeEnvVar = 'CODEX_HOME';
}
