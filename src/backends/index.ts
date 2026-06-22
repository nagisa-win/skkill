import type { SkillBackend, BackendId } from '../types/backend.js';
import { GitBackend } from './git.js';
import { NpxSkillBackend } from './npx-skill.js';
import { OnetoolBackend } from './onetool.js';
import { GitHubBackend } from './github.js';
import { SkitError } from '../utils/logger.js';

export const BACKENDS: Record<BackendId, SkillBackend> = {
    git: new GitBackend(),
    'npx-skill': new NpxSkillBackend(),
    onetool: new OnetoolBackend(),
    github: new GitHubBackend(),
};

export function getBackend(id: BackendId): SkillBackend {
    const b = BACKENDS[id];
    if (!b) throw new SkitError('E_BACKEND_UNAVAILABLE', `Unknown backend: ${id}`);
    return b;
}

// 默认:onetool 不可达 → git 兜底
// npx-skill / github 仍可显式选用 (config.backend.provider 或 search --backend)
export async function pickDefaultBackend(): Promise<SkillBackend> {
    const onetool = BACKENDS.onetool;
    const git = BACKENDS.git;
    const status = await onetool.available();
    if (status.ok) return onetool;
    return git;
}
