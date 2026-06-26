import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAIProvider } from './openai.js';
import { SkitError } from '../../utils/logger.js';

const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('OpenAIProvider — constructor', () => {
    afterEach(() => {
        if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
    });

    it('throws E_LLM_API_KEY_MISSING when no apiKey', () => {
        delete process.env.OPENAI_API_KEY;
        expect(() => new OpenAIProvider()).toThrow(SkitError);
        try {
            new OpenAIProvider();
        } catch (e) {
            expect((e as SkitError).code).toBe('E_LLM_API_KEY_MISSING');
        }
    });

    it('accepts apiKey from constructor', () => {
        const p = new OpenAIProvider({ apiKey: 'sk-test' });
        expect(p.id).toBe('openai');
    });
});

describe('OpenAIProvider.generateSkill — fetch wiring', () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        capturedUrl = undefined;
        capturedInit = undefined;
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
    });

    it('POSTs to <baseUrl>/chat/completions with JSON body and parses output', async () => {
        fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
            capturedUrl = url;
            capturedInit = init;
            return jsonResponse({
                choices: [{ message: { content: '{"skill_md":"# x","package_json":{"name":"x","version":"0.1.0"}}' } }],
            });
        });
        const p = new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://gw.example.com/v1' });
        const out = await p.generateSkill('hi', { type: 'mixed', lang: 'zh' });
        expect(out.skillMd).toBe('# x');
        expect(out.packageJson.name).toBe('x');
        expect(capturedUrl).toBe('https://gw.example.com/v1/chat/completions');
        const headers = capturedInit?.headers as Record<string, string>;
        expect(headers['Content-Type']).toBe('application/json');
        expect(headers['Authorization']).toBe('Bearer k');
        expect(headers['Accept']).toBe('application/json');
        const body = JSON.parse(capturedInit?.body as string);
        expect(body.model).toBeTruthy();
        expect(body.max_tokens).toBe(4096);
        expect(body.response_format).toBeUndefined();
        expect(body.messages).toHaveLength(2);
        expect(body.messages[0].role).toBe('system');
        expect(body.messages[1].role).toBe('user');
    });

    it('trims trailing slash on baseUrl', async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({
                choices: [{ message: { content: '{"skill_md":"# x","package_json":{"name":"x","version":"0.1.0"}}' } }],
            })
        );
        const p = new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://gw.example.com/v1/' });
        await p.generateSkill('hi', { type: 'mixed', lang: 'zh' });
        expect(fetchMock.mock.calls[0][0]).toBe('https://gw.example.com/v1/chat/completions');
    });

    it('throws E_LLM_INVALID_OUTPUT when fetch rejects (network)', async () => {
        fetchMock.mockRejectedValue(new TypeError('fetch failed'));
        const p = new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://gw.example.com/v1' });
        try {
            await p.generateSkill('hi', { type: 'mixed', lang: 'zh' });
            expect.fail('should throw');
        } catch (e) {
            expect((e as SkitError).code).toBe('E_LLM_INVALID_OUTPUT');
        }
    });

    it('throws E_LLM_INVALID_OUTPUT on HTTP 4xx', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'bad' } }, 401));
        const p = new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://gw.example.com/v1' });
        try {
            await p.generateSkill('hi', { type: 'mixed', lang: 'zh' });
            expect.fail('should throw');
        } catch (e) {
            expect((e as SkitError).code).toBe('E_LLM_INVALID_OUTPUT');
            expect((e as Error).message).toContain('401');
        }
    });

    it('throws E_LLM_INVALID_OUTPUT when choices missing', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ error: 'no choices here' }));
        const p = new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://gw.example.com/v1' });
        try {
            await p.generateSkill('hi', { type: 'mixed', lang: 'zh' });
            expect.fail('should throw');
        } catch (e) {
            expect((e as SkitError).code).toBe('E_LLM_INVALID_OUTPUT');
        }
    });

    it('throws E_LLM_INVALID_OUTPUT when content not a string', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: null } }] }));
        const p = new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://gw.example.com/v1' });
        try {
            await p.generateSkill('hi', { type: 'mixed', lang: 'zh' });
            expect.fail('should throw');
        } catch (e) {
            expect((e as SkitError).code).toBe('E_LLM_INVALID_OUTPUT');
        }
    });

    it('throws E_LLM_INVALID_OUTPUT when LLM output is not valid JSON', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'not json at all' } }] }));
        const p = new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://gw.example.com/v1' });
        try {
            await p.generateSkill('hi', { type: 'mixed', lang: 'zh' });
            expect.fail('should throw');
        } catch (e) {
            expect((e as SkitError).code).toBe('E_LLM_INVALID_OUTPUT');
        }
    });
});

describe('OpenAIProvider.generateBriefDetail — fetch wiring', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('makes two requests (briefDesc + detailDoc) and returns both', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '一句话简介' } }] }))
            .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '## 功能简介\n详细' } }] }));
        const p = new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://gw.example.com/v1' });
        const out = await p.generateBriefDetail('# skill', { lang: 'zh' });
        expect(out.briefDesc).toBe('一句话简介');
        expect(out.detailDoc).toContain('功能简介');
        expect(fetchMock.mock.calls).toHaveLength(2);
    });

    it('throws when fetch rejects', async () => {
        fetchMock.mockRejectedValue(new Error('boom'));
        const p = new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://gw.example.com/v1' });
        await expect(p.generateBriefDetail('# x', { lang: 'zh' })).rejects.toMatchObject({
            code: 'E_LLM_INVALID_OUTPUT',
        });
    });
});