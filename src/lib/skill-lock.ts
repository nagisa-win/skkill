import path from 'node:path';
import { SKILL_LOCK_PATH } from '../constants.js';
import { atomicWrite, readFileOrNull } from '../utils/fs.js';
import { ensureDir } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import type { SkillLockEntry, SkillLockFile } from '../types/lock.js';

// 不存在 / 损坏 / 版本不匹配 → 视为空 lock
const EMPTY_LOCK: SkillLockFile = { version: 1, skills: {} };

// 读取 lock,文件缺失或 JSON 损坏时返回空结构 (vercel 策略,不做迁移)
export async function readSkillLock(lockPath: string = SKILL_LOCK_PATH): Promise<SkillLockFile> {
    const raw = await readFileOrNull(lockPath);
    if (!raw) return { ...EMPTY_LOCK, skills: {} };
    try {
        const parsed = JSON.parse(raw) as SkillLockFile;
        if (parsed.version !== 1 || !parsed.skills || typeof parsed.skills !== 'object') {
            logger.warn(`skill-lock 版本或结构不兼容,视为空 lock: ${lockPath}`);
            return { ...EMPTY_LOCK, skills: {} };
        }
        return parsed;
    } catch (err) {
        logger.warn(`skill-lock JSON 解析失败,视为空 lock: ${(err as Error).message}`);
        return { ...EMPTY_LOCK, skills: {} };
    }
}

// 原子写入 lock (确保父目录存在)
export async function writeSkillLock(
    lock: SkillLockFile,
    lockPath: string = SKILL_LOCK_PATH
): Promise<void> {
    await ensureDir(path.dirname(lockPath));
    await atomicWrite(lockPath, JSON.stringify(lock, null, 2) + '\n');
}

// 取单个 entry,不存在返回 undefined
export async function getSkill(
    name: string,
    lockPath: string = SKILL_LOCK_PATH
): Promise<SkillLockEntry | undefined> {
    const lock = await readSkillLock(lockPath);
    return lock.skills[name];
}

// 插入或更新 entry,保留其他 entries
export async function upsertSkill(
    entry: SkillLockEntry,
    lockPath: string = SKILL_LOCK_PATH
): Promise<void> {
    const lock = await readSkillLock(lockPath);
    lock.skills[entry.name] = entry;
    await writeSkillLock(lock, lockPath);
}

// 删除 entry,不存在静默忽略
export async function removeSkill(
    name: string,
    lockPath: string = SKILL_LOCK_PATH
): Promise<void> {
    const lock = await readSkillLock(lockPath);
    if (!(name in lock.skills)) return;
    delete lock.skills[name];
    await writeSkillLock(lock, lockPath);
}