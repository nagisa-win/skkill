import type { BackendId } from './backend.js';

// 全局 lock 文件 schema: ~/.skkill/.skill-lock.json
// version 1: 初始版本,跟随 B3 引入
export interface SkillLockFile {
    version: 1;
    skills: Record<string, SkillLockEntry>;
}

// 单个 skill 的 lock entry,key 是 installRoot 下的目录名 (即 name)
export interface SkillLockEntry {
    name: string;
    source: string; // 原始 ref (e.g. "vercel-labs/agent-skills" 或 "git@...")
    sourceType: 'git' | 'registry' | 'local';
    sourceUrl: string; // gitUrl / downloadUrl / file://
    backend: BackendId; // 走哪个 backend (后续 B5 改用 provider id)
    ref?: string; // git branch/tag/subpath
    skillPath?: string; // git 仓库内的 subpath (e.g. "skills/frontend-design")
    installedAt: string; // ISO
    upgradedAt?: string; // ISO
    lastCommitSha?: string; // git HEAD sha,精准升级用
    skillFolderHash?: string; // GitHub Trees API SHA (B4 写入)
}