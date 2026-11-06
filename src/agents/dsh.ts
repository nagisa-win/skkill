import { BaseAdapter } from './base.js';
import type { AgentId } from '../types/agent.js';

/**
 * DeepSeek Harness 的全局 skill 根目录是 $DSH_HOME/skills (默认 ~/.dsh/skills)。
 * 与 BaseAdapter 的 env home 规则一致,无需额外的子路径。
 */
export class DshAdapter extends BaseAdapter {
    readonly id: AgentId = 'dsh';
    readonly displayName = 'DeepSeek Harness';
    readonly homeEnvVar = 'DSH_HOME';
}
