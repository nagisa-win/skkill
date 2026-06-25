import { describe, it, expect } from 'vitest';
import { GitBackend } from './git.js';
import { SkitError } from '../utils/logger.js';

const backend = new GitBackend();

describe('GitBackend.resolve', () => {
    it('解析 https git URL', async () => {
        const r = await backend.resolve('https://github.com/owner/repo.git');
        expect(r.kind).toBe('git');
        expect(r.gitUrl).toBe('https://github.com/owner/repo.git');
    });

    it('解析 git@ SSH URL', async () => {
        const r = await backend.resolve('git@github.com:owner/repo.git');
        expect(r.kind).toBe('git');
        expect(r.gitUrl).toBe('git@github.com:owner/repo.git');
    });

    it('解析 owner/repo 简写为 GitHub HTTPS URL', async () => {
        const r = await backend.resolve('vercel-labs/skills');
        expect(r.kind).toBe('git');
        expect(r.gitUrl).toBe('https://github.com/vercel-labs/skills.git');
    });

    it('解析带子路径的 owner/repo/subpath', async () => {
        // 注意: 现版本 resolve() 只取 owner/repo,subpath 丢给后续 fetch 处理
        // 这里只验证它不抛错且生成合法 GitHub URL
        const r = await backend.resolve('vercel-labs/skills/docs/guide');
        expect(r.kind).toBe('git');
        expect(r.gitUrl).toMatch(/^https:\/\/github\.com\//);
    });

    it('解析本地相对路径 (./)', async () => {
        const r = await backend.resolve('./my-local-skill');
        expect(r.kind).toBe('git');
        expect(r.gitUrl).toMatch(/^file:\/\//);
    });

    it('解析本地绝对路径', async () => {
        const r = await backend.resolve('/tmp/some-skill');
        expect(r.kind).toBe('git');
        expect(r.gitUrl).toBe('file:///tmp/some-skill');
    });

    it('纯 registry 名字 (无斜杠) 抛 E_BACKEND_UNAVAILABLE', async () => {
        // git backend 不该被用作 registry,这种 ref 该走 onetool/npx-skill
        await expect(backend.resolve('some-skill-name')).rejects.toThrow(SkitError);
    });
});
