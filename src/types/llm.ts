import type { SkillPackageJson } from './skill.js';

export type LLMProviderId = 'anthropic' | 'openai';
export type SkillType = 'workflow' | 'api' | 'mixed' | 'reference';
export type SkillLang = 'zh' | 'en' | 'bilingual';

export interface GenerateSkillOptions {
    type: SkillType;
    lang: SkillLang;
}

export interface GenerateSkillOutput {
    skillMd: string;
    packageJson: SkillPackageJson;
    scripts?: Record<string, string>;
    type?: SkillType;
    lang?: SkillLang;
}

export interface GenerateBriefDetailOutput {
    briefDesc: string;
    detailDoc: string;
}

export interface LLMProvider {
    id: LLMProviderId;
    generateSkill(prompt: string, opts: GenerateSkillOptions): Promise<GenerateSkillOutput>;
    generateBriefDetail(skillMd: string, opts: { lang: SkillLang }): Promise<GenerateBriefDetailOutput>;
}
