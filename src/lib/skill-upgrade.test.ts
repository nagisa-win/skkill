import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    parseGitHubRepo,
    fetchSkillFolderHash,
    hashTree,
    checkUpdate,
} from './skill-upgrade.js';
import type { SkillLockEntry } from '../types/lock.js';
import type { ConfigFile } from '../types/config.js';

const config: ConfigFile = { version: 1 };

describe('parseGitHubRepo', () => {
    it('parses https URL with .git suffix', () => {
        expect(parseGitHubRepo('https://github.com/vercel-labs/skills.git')).toEqual({
            owner: 'vercel-labs',
            repo: 'skills',
        });
    });
    it('parses https URL without .git', () => {
        expect(parseGitHubRepo('https://github.com/foo/bar')).toEqual({ owner: 'foo', repo: 'bar' });
    });
    it('parses SSH form', () => {
        expect(parseGitHubRepo('git@github.com:foo/bar.git')).toEqual({ owner: 'foo', repo: 'bar' });
    });
    it('returns null for non-GitHub URL', () => {
        expect(parseGitHubRepo('https://gitlab.com/foo/bar.git')).toBeNull();
        expect(parseGitHubRepo('https://example.com/x.zip')).toBeNull();
        expect(parseGitHubRepo('file:///tmp/x')).toBeNull();
    });
});

describe('hashTree', () => {
    it('changes when content changes', () => {
        const a = [{ path: 'a', sha: '1', mode: '100644', size: 1 }];
        const b = [{ path: 'a', sha: '2', mode: '100644', size: 1 }];
        expect(hashTree(a)).not.toBe(hashTree(b));
    });
    it('produces stable 40-char hex sha1', () => {
        const entries = [
            { path: 'a.txt', sha: 'sha-a', mode: '100644', size: 10 },
            { path: 'b.txt', sha: 'sha-b', mode: '100644', size: 20 },
        ];
        const h = hashTree(entries);
        expect(h).toMatch(/^[0-9a-f]{40}$/);
        // 同样输入应该出同样 hash
        expect(hashTree([...entries])).toBe(h);
    });
});

describe('fetchSkillFolderHash', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns null for non-GitHub URL (no API call)', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const result = await fetchSkillFolderHash({ gitUrl: 'file:///tmp/x', config });
        expect(result).toBeNull();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('filters to skillPath subtree', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                json: async () => ({
                    tree: [
                        { path: 'README.md', sha: 'sha-1', type: 'blob', mode: '100644', size: 10 },
                        { path: 'skills/frontend-design/SKILL.md', sha: 'sha-2', type: 'blob', mode: '100644', size: 5 },
                        { path: 'skills/frontend-design/references/x.md', sha: 'sha-3', type: 'blob', mode: '100644', size: 8 },
                        { path: 'skills/other/SKILL.md', sha: 'sha-4', type: 'blob', mode: '100644', size: 3 },
                        { path: 'skills', sha: 'sha-tree', type: 'tree', mode: '040000' },
                    ],
                }),
            }) as unknown as Response)
        );
        // 先用整仓算 hash,再用 skillPath 子树算 hash,二者必须不同 (证明过滤生效)
        const wholeRepo = await fetchSkillFolderHash({
            gitUrl: 'https://github.com/foo/bar.git',
            config,
        });
        const subTree = await fetchSkillFolderHash({
            gitUrl: 'https://github.com/foo/bar.git',
            skillPath: 'skills/frontend-design',
            config,
        });
        expect(wholeRepo).not.toBeNull();
        expect(subTree).not.toBeNull();
        expect(subTree).not.toBe(wholeRepo);
        // 子树 hash 应该跟"只有 sha-2/sha-3 两条 entry"算出的 hash 一致
        const expected = hashTree([
            { path: 'skills/frontend-design/SKILL.md', sha: 'sha-2', mode: '100644', size: 5 },
            { path: 'skills/frontend-design/references/x.md', sha: 'sha-3', mode: '100644', size: 8 },
        ]);
        expect(subTree).toBe(expected);
    });

    it('returns null on HTTP error', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response)
        );
        const result = await fetchSkillFolderHash({
            gitUrl: 'https://github.com/foo/bar.git',
            config,
        });
        expect(result).toBeNull();
    });

    it('returns null on network throw', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('network'))));
        const result = await fetchSkillFolderHash({
            gitUrl: 'https://github.com/foo/bar.git',
            config,
        });
        expect(result).toBeNull();
    });

    it('sends Authorization header when token configured', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => ({ tree: [] }),
        }) as unknown as Response);
        vi.stubGlobal('fetch', fetchMock);
        const configWithToken: ConfigFile = {
            version: 1,
            backend: { github: { token: 'ghp_secret' } },
        };
        await fetchSkillFolderHash({
            gitUrl: 'https://github.com/foo/bar.git',
            config: configWithToken,
        });
        const [, init] = fetchMock.mock.calls[0];
        expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer ghp_secret' });
    });
});

describe('checkUpdate', () => {
    const baseEntry: SkillLockEntry = {
        name: 'foo',
        source: 'foo/bar',
        sourceType: 'git',
        sourceUrl: 'https://github.com/foo/bar.git',
        backend: 'git',
        installedAt: '2026-01-01T00:00:00.000Z',
        skillFolderHash: 'old-hash',
    };

    it('returns updateAvailable=true when hashes differ', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                json: async () => ({ tree: [{ path: 'SKILL.md', sha: 'new', type: 'blob', mode: '100644', size: 1 }] }),
            }) as unknown as Response)
        );
        const r = await checkUpdate(baseEntry, config);
        expect(r).not.toBeNull();
        expect(r?.updateAvailable).toBe(true);
    });

    it('returns updateAvailable=false when hashes match', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                json: async () => ({ tree: [{ path: 'SKILL.md', sha: 'new', type: 'blob', mode: '100644', size: 1 }] }),
            }) as unknown as Response)
        );
        // 先算出当前 hash,再设到 entry 上,模拟无更新
        const latest = await fetchSkillFolderHash({ gitUrl: baseEntry.sourceUrl, config });
        const r = await checkUpdate({ ...baseEntry, skillFolderHash: latest! }, config);
        expect(r?.updateAvailable).toBe(false);
    });

    it('returns null for non-git source', async () => {
        const r = await checkUpdate({ ...baseEntry, sourceType: 'local' }, config);
        expect(r).toBeNull();
    });
});