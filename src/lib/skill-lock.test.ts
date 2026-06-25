import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
    readSkillLock,
    writeSkillLock,
    getSkill,
    upsertSkill,
    removeSkill,
} from './skill-lock.js';
import type { SkillLockEntry, SkillLockFile } from '../types/lock.js';

const EMPTY: SkillLockFile = { version: 1, skills: {} };

let workDir: string;
let lockPath: string;

const sampleEntry = (overrides: Partial<SkillLockEntry> = {}): SkillLockEntry => ({
    name: 'my-skill',
    source: 'vercel-labs/skills',
    sourceType: 'git',
    sourceUrl: 'https://github.com/vercel-labs/skills.git',
    backend: 'git',
    installedAt: '2026-06-25T00:00:00.000Z',
    ...overrides,
});

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skkill-lock-'));
    lockPath = path.join(workDir, '.skill-lock.json');
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

describe('readSkillLock', () => {
    it('returns empty lock when file missing', async () => {
        const lock = await readSkillLock(lockPath);
        expect(lock).toEqual({ version: 1, skills: {} });
        expect(lock.skills).not.toBe(EMPTY.skills); // 必须是新对象,避免共享引用
    });

    it('returns empty lock when JSON corrupt', async () => {
        await fs.writeFile(lockPath, '{ not json', 'utf-8');
        const lock = await readSkillLock(lockPath);
        expect(lock.skills).toEqual({});
    });

    it('returns empty lock when version mismatch', async () => {
        await fs.writeFile(
            lockPath,
            JSON.stringify({ version: 99, skills: { foo: {} } }),
            'utf-8'
        );
        const lock = await readSkillLock(lockPath);
        expect(lock.skills).toEqual({});
    });

    it('reads valid lock with entries', async () => {
        const valid: SkillLockFile = {
            version: 1,
            skills: { 'my-skill': sampleEntry() },
        };
        await fs.writeFile(lockPath, JSON.stringify(valid), 'utf-8');
        const lock = await readSkillLock(lockPath);
        expect(lock.skills['my-skill']).toEqual(sampleEntry());
    });
});

describe('writeSkillLock + readSkillLock roundtrip', () => {
    it('persists and reloads entries', async () => {
        const lock: SkillLockFile = {
            version: 1,
            skills: { 'a': sampleEntry({ name: 'a' }), 'b': sampleEntry({ name: 'b' }) },
        };
        await writeSkillLock(lock, lockPath);
        const reloaded = await readSkillLock(lockPath);
        expect(reloaded.skills).toEqual(lock.skills);
    });

    it('creates parent dir if missing', async () => {
        const nestedPath = path.join(workDir, 'nested', 'deep', '.skill-lock.json');
        await writeSkillLock({ version: 1, skills: {} }, nestedPath);
        const stat = await fs.stat(nestedPath);
        expect(stat.isFile()).toBe(true);
    });
});

describe('upsertSkill', () => {
    it('adds new entry preserving existing ones', async () => {
        await upsertSkill(sampleEntry({ name: 'first' }), lockPath);
        await upsertSkill(sampleEntry({ name: 'second' }), lockPath);
        const lock = await readSkillLock(lockPath);
        expect(Object.keys(lock.skills).sort()).toEqual(['first', 'second']);
    });

    it('overwrites entry with same name', async () => {
        await upsertSkill(sampleEntry({ name: 'x', source: 'old' }), lockPath);
        await upsertSkill(sampleEntry({ name: 'x', source: 'new' }), lockPath);
        const lock = await readSkillLock(lockPath);
        expect(lock.skills.x?.source).toBe('new');
    });
});

describe('removeSkill', () => {
    it('removes existing entry', async () => {
        await upsertSkill(sampleEntry({ name: 'gone' }), lockPath);
        await removeSkill('gone', lockPath);
        const lock = await readSkillLock(lockPath);
        expect(lock.skills.gone).toBeUndefined();
    });

    it('silently ignores missing name', async () => {
        await upsertSkill(sampleEntry({ name: 'kept' }), lockPath);
        await removeSkill('never-existed', lockPath);
        const lock = await readSkillLock(lockPath);
        expect(lock.skills.kept).toBeDefined();
    });
});

describe('getSkill', () => {
    it('returns entry when present', async () => {
        await upsertSkill(sampleEntry({ name: 'foo' }), lockPath);
        const entry = await getSkill('foo', lockPath);
        expect(entry?.name).toBe('foo');
    });

    it('returns undefined when missing', async () => {
        const entry = await getSkill('nope', lockPath);
        expect(entry).toBeUndefined();
    });
});