import type { GenerateSkillOptions, GenerateBriefDetailOutput, SkillType, SkillLang } from '../../types/llm.js';

const NAME_RULE = 'name 必须是 kebab-case (仅小写字母数字单横线),与目录名一致,长度 ≤ 64';
const DESC_RULE = 'description ≤ 1024 字符,不含 < 或 >,不含 TODO,先写能力边界再补触发场景';
const CMD_RULE = '命令示例禁止 &&, ;, |, cd, export, 行内 VAR=value 赋值';

function sectionRequirements(type: SkillType): string {
    switch (type) {
        case 'workflow':
            return `## 使用场景 → ## 工作流(编号步骤,每步「做什么 / 输入 / 输出」) → ## 错误处理`;
        case 'api':
            return `## 使用场景 → ## 核心能力(列表 + 调用命令) → ## 调用方式(各命令详解) → ## 错误处理`;
        case 'mixed':
            return `## 使用场景 → ## 核心能力 → ## 典型工作流(场景 1/2/3) → ## 资源说明 → ## 错误处理`;
        case 'reference':
            return `## 使用场景 → ## 核心原则 → ## 操作步骤 → ## 参考资料 → ## 自检清单`;
    }
}

function langRules(lang: SkillLang): string {
    switch (lang) {
        case 'zh':
            return '所有 description、正文、章节标题使用简体中文';
        case 'en':
            return '所有 description、正文、章节标题使用英文';
        case 'bilingual':
            return 'description 走中文,正文章节标题双语(## 使用场景 / Use Cases),正文句子中文';
    }
}

export function buildCreateSkillSystemPrompt(opts: GenerateSkillOptions): string {
    return `你是 skkill 的 Skill 生成器,目标:为 onetool / OpenClaw 平台生成符合规范的 Skill。

输出一个 JSON 对象(无 prose,无 markdown code fence),包含:
- "skill_md": string, 完整 SKILL.md 含 YAML frontmatter 与正文
- "package_json": object, 合法 package.json
- "scripts": object (可选), { "scripts/<name>.py": "内容", ... }

SKILL.md frontmatter 硬规则:
- ${NAME_RULE}
- ${DESC_RULE}
- "metadata.type": "${opts.type}" (必填,值: workflow | api | mixed | reference)
- "metadata.author", "metadata.version" 可选

正文硬规则(类型=${opts.type}):
- 必须按以下顺序包含章节: ${sectionRequirements(opts.type)}
- ${CMD_RULE}
- 资源目录(scripts/, references/, assets/)仅在确有必要时创建;创建后必须在 SKILL.md 中显式引用
- 涉及 API/脚本调用必须包含「错误处理」章节;纯参考规范类可省略
- 「使用场景」是 description 的展开,描述详细的执行边界,不要简单重复 description
- 正文字数 ≤ 5000 词

package.json 硬规则:
- "name": kebab-case,最后一段 = skill name
- "version": "0.1.0"
- "description": 一句话中文摘要
- "author": { "name": "<git user.name 或 'skkill'>" }
- "keywords": 3-6 个
- "protocols": { "claudecode": true, "codex": true }
- "metadata": { "type": "${opts.type}", "version": "0.1.0" }

语言: ${langRules(opts.lang)}

只返回 JSON 对象。不要解释,不要 code fence。`;
}

export function buildCreateSkillUserPrompt(userPrompt: string, opts: GenerateSkillOptions): string {
    return `为以下用户需求生成 Skill:\n\n${userPrompt}\n\n要求类型: ${opts.type}。语言: ${opts.lang}。\n\n只返回一个 JSON 对象,字段: skill_md, package_json, (可选) scripts。`;
}

export function buildBriefDetailSystemPrompt(opts: { lang: SkillLang }): string {
    return `你是 onetool 平台的发布助手。需要根据 skill 内容生成:
- "briefDesc": 中文 ≤ 100 字符,一句话概括核心能力
- "detailDoc": 中文 markdown 详细描述,必须包含以下章节:## 功能简介 (150字左右) / ## 适用场景 (2-5 个,带示例) / ## 不适用场景 (1-3 个) / ## 依赖要求 (表格) / ## 使用方式 (输入格式 / 输出示例)

语言: ${opts.lang === 'en' ? 'English' : '简体中文'}。

只返回 JSON 对象: { "briefDesc": "...", "detailDoc": "..." }。`;
}

export function buildBriefDetailUserPrompt(skillMd: string): string {
    return `以下是 skill 的 SKILL.md 内容:\n\n${skillMd}\n\n请生成 briefDesc 和 detailDoc。`;
}

export function extractJsonObject<T = unknown>(text: string): T {
    const trimmed = text.trim();
    try {
        return JSON.parse(trimmed) as T;
    } catch {
        const fence = /```(?:json)?\s*([\s\S]+?)\s*```/.exec(trimmed);
        if (fence && fence[1]) return JSON.parse(fence[1]) as T;
        const first = trimmed.indexOf('{');
        const last = trimmed.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last > first) {
            return JSON.parse(trimmed.slice(first, last + 1)) as T;
        }
        throw new Error('No valid JSON object found in LLM output');
    }
}

export function parseGenerateOutput(text: string): import('../../types/llm.js').GenerateSkillOutput {
    const obj = extractJsonObject<Record<string, unknown>>(text);
    if (typeof obj.skill_md !== 'string' || typeof obj.package_json !== 'object' || obj.package_json === null) {
        throw new Error('LLM 输出缺少 skill_md 或 package_json');
    }
    return {
        skillMd: obj.skill_md,
        packageJson: obj.package_json as import('../../types/llm.js').GenerateSkillOutput['packageJson'],
        scripts: (obj.scripts && typeof obj.scripts === 'object' ? obj.scripts : undefined) as
            | Record<string, string>
            | undefined,
        type: obj.type as SkillType | undefined,
        lang: obj.lang as SkillLang | undefined,
    };
}

export function parseBriefDetail(text: string): GenerateBriefDetailOutput {
    return extractJsonObject<GenerateBriefDetailOutput>(text);
}
