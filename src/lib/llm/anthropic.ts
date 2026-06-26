import Anthropic from '@anthropic-ai/sdk';
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

export class AnthropicProvider implements LLMProvider {
    readonly id = 'anthropic' as const;
    private client: Anthropic;
    private model: string;

    constructor(opts: { apiKey?: string; model?: string; baseUrl?: string } = {}) {
        const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new SkitError('E_LLM_API_KEY_MISSING', 'ANTHROPIC_API_KEY 未设置 (env 或 config.json)');
        this.client = new Anthropic({ apiKey, baseURL: opts.baseUrl });
        this.model = opts.model ?? DEFAULT_LLM_MODELS.anthropic;
    }

    async generateSkill(prompt: string, opts: GenerateSkillOptions): Promise<GenerateSkillOutput> {
        let text = '';
        try {
            const msg = await this.client.messages.create({
                model: this.model,
                max_tokens: 4096,
                system: buildCreateSkillSystemPrompt(opts),
                messages: [{ role: 'user', content: buildCreateSkillUserPrompt(prompt, opts) }],
            });
            const block = msg.content[0];
            text = block && block.type === 'text' ? block.text : '';
        } catch (err) {
            throw new SkitError('E_LLM_INVALID_OUTPUT', `Anthropic API 调用失败: ${(err as Error).message}`);
        }
        try {
            return parseGenerateOutput(text);
        } catch (err) {
            throw new SkitError('E_LLM_INVALID_OUTPUT', `LLM 输出解析失败: ${(err as Error).message}`);
        }
    }

    async generateBriefDetail(skillMd: string, opts: { lang: SkillLang }): Promise<GenerateBriefDetailOutput> {
        const call = async (system: string, user: string, maxTokens: number): Promise<string> => {
            try {
                const msg = await this.client.messages.create({
                    model: this.model,
                    max_tokens: maxTokens,
                    system,
                    messages: [{ role: 'user', content: user }],
                });
                const block = msg.content[0];
                return (block && block.type === 'text' ? block.text : '').trim();
            } catch (err) {
                throw new SkitError('E_LLM_INVALID_OUTPUT', `Anthropic API 调用失败: ${(err as Error).message}`);
            }
        };
        const [briefDesc, detailDoc] = await Promise.all([
            call(buildBriefDescSystemPrompt(opts), buildBriefDescUserPrompt(skillMd), 256),
            call(buildDetailDocSystemPrompt(opts), buildDetailDocUserPrompt(skillMd), 2048),
        ]);
        return { briefDesc, detailDoc };
    }
}
