import type {
    LLMProvider,
    GenerateSkillOptions,
    GenerateSkillOutput,
    GenerateBriefDetailOutput,
    SkillLang,
} from '../../types/llm.js';
import {
    buildCreateSkillSystemPrompt,
    buildCreateSkillUserPrompt,
    buildBriefDescSystemPrompt,
    buildBriefDescUserPrompt,
    buildDetailDocSystemPrompt,
    buildDetailDocUserPrompt,
    parseGenerateOutput,
} from './prompt.js';
import { SkitError } from '../../utils/logger.js';
import { DEFAULT_LLM_MODELS } from '../../constants.js';

const REQUEST_TIMEOUT_MS = 120_000;

export class OpenAIProvider implements LLMProvider {
    readonly id = 'openai' as const;
    private apiKey: string;
    private model: string;
    private baseUrl: string;

    constructor(opts: { apiKey?: string; model?: string; baseUrl?: string } = {}) {
        const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
        if (!apiKey) throw new SkitError('E_LLM_API_KEY_MISSING', 'OPENAI_API_KEY 未设置 (env 或 config.json)');
        this.apiKey = apiKey;
        this.model = opts.model ?? DEFAULT_LLM_MODELS.openai;
        this.baseUrl = normalizeBaseUrl(opts.baseUrl ?? 'https://api.openai.com/v1');
    }

    async generateSkill(prompt: string, opts: GenerateSkillOptions): Promise<GenerateSkillOutput> {
        const text = await this.chat({
            max_tokens: 4096,
            messages: [
                { role: 'system', content: buildCreateSkillSystemPrompt(opts) },
                { role: 'user', content: buildCreateSkillUserPrompt(prompt, opts) },
            ],
        });
        try {
            return parseGenerateOutput(text);
        } catch (err) {
            throw new SkitError('E_LLM_INVALID_OUTPUT', `LLM 输出解析失败: ${(err as Error).message}`);
        }
    }

    async generateBriefDetail(skillMd: string, opts: { lang: SkillLang }): Promise<GenerateBriefDetailOutput> {
        const [briefDesc, detailDoc] = await Promise.all([
            this.chat({
                max_tokens: 256,
                messages: [
                    { role: 'system', content: buildBriefDescSystemPrompt(opts) },
                    { role: 'user', content: buildBriefDescUserPrompt(skillMd) },
                ],
            }),
            this.chat({
                max_tokens: 2048,
                messages: [
                    { role: 'system', content: buildDetailDocSystemPrompt(opts) },
                    { role: 'user', content: buildDetailDocUserPrompt(skillMd) },
                ],
            }),
        ]);
        return { briefDesc: briefDesc.trim(), detailDoc: detailDoc.trim() };
    }

    private async chat(req: { max_tokens: number; messages: Array<{ role: string; content: string }> }): Promise<string> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let resp: Response;
        try {
            resp = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                    Accept: 'application/json',
                },
                body: JSON.stringify({
                    model: this.model,
                    max_tokens: req.max_tokens,
                    thinking: { type: 'disabled' },
                    messages: req.messages,
                }),
                signal: controller.signal,
            });
        } catch (err) {
            throw new SkitError('E_LLM_INVALID_OUTPUT', `OpenAI API 调用失败: ${(err as Error).message}`);
        } finally {
            clearTimeout(timer);
        }

        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            throw new SkitError('E_LLM_INVALID_OUTPUT', `OpenAI API 返回 ${resp.status}: ${body.slice(0, 300)}`);
        }

        let payload: unknown;
        try {
            payload = await resp.json();
        } catch (err) {
            throw new SkitError('E_LLM_INVALID_OUTPUT', `OpenAI 响应 JSON 解析失败: ${(err as Error).message}`);
        }

        const content = extractContent(payload);
        if (content === undefined) {
            throw new SkitError('E_LLM_INVALID_OUTPUT', 'OpenAI 响应缺少 choices[0].message.content');
        }
        return content;
    }
}

function normalizeBaseUrl(url: string): string {
    return url.replace(/\/+$/, '');
}

function extractContent(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    const choices = (payload as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) return undefined;
    const msg = (choices[0] as { message?: unknown }).message;
    if (!msg || typeof msg !== 'object') return undefined;
    const content = (msg as { content?: unknown }).content;
    return typeof content === 'string' ? content : undefined;
}