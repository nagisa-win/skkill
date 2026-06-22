import type { LLMProvider, LLMProviderId } from '../../types/llm.js';
import type { ConfigFile } from '../../types/config.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { DEFAULT_LLM_PROVIDER } from '../../constants.js';
import { resolveLLMConfig } from '../config-resolver.js';

// 按 config 创建 LLMProvider;优先级: env > config.json > 默认
export function createLLMProvider(config: ConfigFile, override?: LLMProviderId): LLMProvider {
    const resolved = resolveLLMConfig(config);
    const id = override ?? resolved.provider ?? DEFAULT_LLM_PROVIDER;
    const opts = { apiKey: resolved.apiKey, model: resolved.model, baseUrl: resolved.baseUrl };
    if (id === 'anthropic') return new AnthropicProvider(opts);
    if (id === 'openai') return new OpenAIProvider(opts);
    throw new Error(`Unknown LLM provider: ${id}`);
}
