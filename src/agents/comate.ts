import { BaseAdapter } from './base.js';
import type { AgentId } from '../types/agent.js';

export class ComateAdapter extends BaseAdapter {
    readonly id: AgentId = 'comate';
    readonly displayName = 'Baidu Comate';
    readonly homeEnvVar = 'COMATE_HOME';
}
