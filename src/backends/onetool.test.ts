import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

// 最小 stored(不压缩) zip 构造器, 仅供测试生成 onetool 风格的 skill zip
function crc32(buf: Buffer): number {
    const table: number[] = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]!) & 0xff]!;
    return (crc ^ -1) >>> 0;
}

function makeZip(files: Record<string, string>): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        const nameBuf = Buffer.from(name);
        const data = Buffer.from(content);
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 8); // stored
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        locals.push(local, nameBuf, data);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, nameBuf);
        offset += 30 + nameBuf.length + data.length;
    }
    const cdSize = centrals.reduce((s, b) => s + b.length, 0);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(Object.keys(files).length, 8);
    eocd.writeUInt16LE(Object.keys(files).length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, ...centrals, eocd]);
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

describe('OnetoolBackend.fetch', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('zip 无 package.json 时,从 .skill-meta.json 生成含版本与元信息的 package.json', async () => {
        const zip = makeZip({
            'popo/SKILL.md': '---\nname: popo\ndescription: deploy pages\n---\nbody',
            'popo/.skill-meta.json': JSON.stringify({
                full_name: 'popo',
                skill_name: 'popo',
                namespace: 'demo-ns',
                skill_id: '1234',
                version: '1.0.16',
            }),
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(zip, { status: 200 })));

        const backend = new OnetoolBackend();
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skkill-test-'));
        try {
            const result = await backend.fetch(
                { ref: 'popo', kind: 'registry', package: 'popo', downloadUrl: 'https://cdn/popo.zip' },
                tmp
            );
            expect(result.version).toBe('1.0.16');
            const pkg = JSON.parse(await fs.readFile(path.join(result.skillPath, 'package.json'), 'utf-8'));
            expect(pkg).toMatchObject({
                name: 'popo',
                version: '1.0.16',
                description: 'deploy pages',
                skkill: { onetool: { namespace: 'demo-ns', skillId: '1234', fullName: 'popo' } },
            });
        } finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
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
