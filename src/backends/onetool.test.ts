import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OnetoolBackend } from './onetool.js';
import { packageToSearchResult, pickBosUrl, rowToSearchResult } from './onetool-util.js';

vi.mock('../lib/config.js', () => ({
    loadConfigSilent: vi.fn(async () => ({
        version: 1,
        backend: { onetool: { apiBase: 'http://onetool.test/api/v1' } },
    })),
}));

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('onetool-util helpers', () => {
    it('pickBosUrl prefers bosUrl then newBosUrl', () => {
        expect(pickBosUrl({ bosUrl: 'https://a/x.zip', newBosUrl: 'https://b/x.zip' })).toBe('https://a/x.zip');
        expect(pickBosUrl({ newBosUrl: 'https://b/x.zip' })).toBe('https://b/x.zip');
        expect(pickBosUrl({})).toBeUndefined();
    });

    it('packageToSearchResult maps package payload', () => {
        const r = packageToSearchResult('popo', {
            skillId: 8046,
            bosUrl: 'https://cdn/popo.zip',
            version: '1.0.9',
        });
        expect(r).toMatchObject({
            name: 'popo',
            url: 'https://cdn/popo.zip',
            version: '1.0.9',
            skillId: 8046,
            source: 'onetool',
        });
    });

    it('packageToSearchResult returns null without download url', () => {
        expect(packageToSearchResult('popo', { skillId: 1, version: '1.0.0' })).toBeNull();
    });

    it('rowToSearchResult maps metadata row', () => {
        const r = rowToSearchResult({ name: 'popo', description: 'deploy pages', version: '1.0.9' });
        expect(r?.name).toBe('popo');
        expect(r?.description).toBe('deploy pages');
        expect(r?.source).toBe('onetool');
    });
});

describe('OnetoolBackend.search', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    const backend = new OnetoolBackend();

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        // 清掉 apiBase 缓存,避免用例间互相污染
        (backend as unknown as { cachedApiBase?: string }).cachedApiBase = undefined;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('精确 kebab-case 名优先走 /skills/package', async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse({
                code: 200,
                data: {
                    skillId: 8046,
                    bosUrl: 'https://cdn/popo.zip',
                    version: '1.0.9',
                },
            })
        );

        const results = await backend.search('popo');
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({ name: 'popo', version: '1.0.9', source: 'onetool' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]![0])).toContain(
            '/skills/package?skillIdentifier=popo'
        );
    });

    it('package 404 时回退 metadata 模糊匹配', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ code: 404, message: 'Skill不存在', data: null }))
            .mockResolvedValueOnce(
                jsonResponse({
                    code: 200,
                    data: [
                        { name: 'alpha', description: 'nope' },
                        { name: 'demo-popo-kit', description: 'contains popo' },
                    ],
                })
            );

        const results = await backend.search('popo');
        expect(results.map(r => r.name)).toEqual(['demo-popo-kit']);
        expect(String(fetchMock.mock.calls[0]![0])).toContain('/skills/package?skillIdentifier=popo');
        expect(String(fetchMock.mock.calls[1]![0])).toContain('/skills/metadata?pageSize=');
    });

    it('非 kebab-case 查询跳过 package,直接 metadata', async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse({
                code: 200,
                data: [{ name: 'wechat-formatter', description: '如流知识库文章转 HTML' }],
            })
        );

        const results = await backend.search('如流');
        expect(results).toHaveLength(1);
        expect(results[0]!.name).toBe('wechat-formatter');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]![0])).toContain('/skills/metadata?pageSize=');
    });

    it('package 与 metadata 都未命中时返回空数组', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ code: 404, message: 'Skill不存在', data: null }))
            .mockResolvedValueOnce(jsonResponse({ code: 200, data: [{ name: 'alpha', description: 'x' }] }));

        const results = await backend.search('zzz-not-found');
        expect(results).toEqual([]);
    });

    it('package HTTP 5xx 时抛错,不静默回退 metadata', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ code: 500, message: 'boom' }, 500));
        await expect(backend.search('popo')).rejects.toThrow(/onetool package HTTP 500/);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
