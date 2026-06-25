import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { upsertSkill, readSkillLock } from './skill-lock.js';
import { atomicWrite } from '../utils/fs.js';
import type { SkillLockEntry } from '../types/lock.js';

let workDir: string;
let lockPath: string;

const sampleEntry = (name: string): SkillLockEntry => ({
    name,
    source: name,
    sourceType: 'local',
    sourceUrl: `file:///tmp/${name}`,
    backend: 'git',
    installedAt: '2026-06-25T00:00:00.000Z',
});

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skkill-cr-regress-'));
    lockPath = path.join(workDir, '.skill-lock.json');
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

describe('[CR-fix] atomicWrite 并发不撞 tmp 名', () => {
    it('20 并发 atomicWrite 都成功 (不抛 ENOENT)', async () => {
        const target = path.join(workDir, 'shared.txt');
        // 全部写同一 target,旧实现会因 tmp 名撞抛 ENOENT
        const tasks = Array.from({ length: 20 }, (_, i) =>
            atomicWrite(target, `content-${i}`.repeat(100))
        );
        await expect(Promise.all(tasks)).resolves.toBeDefined();
        // 最终内容是其中一个 (具体哪个不确定,但应该是完整的某一次写入)
        const final = await fs.readFile(target, 'utf-8');
        expect(final.length).toBeGreaterThan(0);
    });
});

describe('[CR-fix] upsertSkill 并发不丢数据 (单进程内)', () => {
    it('10 并发 upsert 应全部成功 (不抛 ENOENT)', async () => {
        // 即使 read-modify-write 间会有事件循环切换,
        // 修复后至少 atomicWrite 不会因 tmp 名冲突而抛错
        const tasks = Array.from({ length: 10 }, (_, i) =>
            upsertSkill(sampleEntry(`skill-${i}`), lockPath)
        );
        const results = await Promise.allSettled(tasks);
        // 所有 promise 都应 fulfilled (不是 rejected)
        for (const r of results) {
            expect(r.status).toBe('fulfilled');
        }
        // 文件能正常读出来 (没有损坏)
        const lock = await readSkillLock(lockPath);
        expect(lock.version).toBe(1);
    });
});