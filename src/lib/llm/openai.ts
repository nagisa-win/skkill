import OpenAI from 'openai';
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
    buildBriefDetailSystemPrompt,
    buildBriefDetailUserPrompt,
    parseGenerateOutput,
    parseBriefDetail,
} from './prompt.js';
import { SkitError } from '../../utils/logger.js';
import { DEFAULT_LLM_MODELS } from '../../constants.js';

export class OpenAIProvider implements LLMProvider {
    readonly id = 'openai' as const;
    private client: OpenAI;
    private model: string;

    constructor(opts: { apiKey?: string; model?: string; baseUrl?: string } = {}) {
        const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
        if (!apiKey) throw new SkitError('E_LLM_API_KEY_MISSING', 'OPENAI_API_KEY 未设置 (env 或 config.json)');
        this.client = new OpenAI({ apiKey, baseURL: opts.baseUrl });
        this.model = opts.model ?? DEFAULT_LLM_MODELS.openai;
    }

    async generateSkill(prompt: string, opts: GenerateSkillOptions): Promise<GenerateSkillOutput> {
        let text = '';
        try {
            const resp = await this.client.chat.completions.create({
                model: this.model,
                max_tokens: 4096,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: buildCreateSkillSystemPrompt(opts) },
                    { role: 'user', content: buildCreateSkillUserPrompt(prompt, opts) },
                ],
            });
            text = resp.choices[0]?.message?.content ?? '';
        } catch (err) {
            throw new SkitError('E_LLM_INVALID_OUTPUT', `OpenAI API 调用失败: ${(err as Error).message}`);
        }
        try {
            return parseGenerateOutput(text);
        } catch (err) {
            throw new SkitError('E_LLM_INVALID_OUTPUT', `LLM 输出解析失败: ${(err as Error).message}`);
        }
    }

    async generateBriefDetail(skillMd: string, opts: { lang: SkillLang }): Promise<GenerateBriefDetailOutput> {
        let text = '';
        try {
            const resp = await this.client.chat.completions.create({
                model: this.model,
                max_tokens: 2048,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: buildBriefDetailSystemPrompt(opts) },
                    { role: 'user', content: buildBriefDetailUserPrompt(skillMd) },
                ],
            });
            text = resp.choices[0]?.message?.content ?? '';
        } catch (err) {
            throw new SkitError('E_LLM_INVALID_OUTPUT', `OpenAI API 调用失败: ${(err as Error).message}`);
        }
        try {
            return parseBriefDetail(text);
        } catch (err) {
            throw new SkitError('E_LLM_INVALID_OUTPUT', `LLM 输出解析失败: ${(err as Error).message}`);
        }
    }
}
