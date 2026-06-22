import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { loadConfig, getInstallRoot } from '../lib/config.js';
import { createLLMProvider } from '../lib/llm/index.js';
import { logger } from '../utils/logger.js';
import { listAvailable, getAgent } from '../agents/index.js';
import { applyToAgents } from '../lib/symlinker.js';
import { pickMany } from '../utils/prompt.js';
import { validateSkill, formatReport } from '../lib/skill-rules.js';
import type { InstalledSkill, SkillPackageJson, SkillFrontmatter } from '../types/skill.js';
import type { SkillType, SkillLang } from '../types/llm.js';
import { SkitError } from '../utils/logger.js';

const SKILL_TYPES: SkillType[] = ['workflow', 'api', 'mixed', 'reference'];
const SKILL_LANGS: SkillLang[] = ['zh', 'en', 'bilingual'];

export async function createCommand(
    prompt: string,
    opts: { agents?: string[]; type?: string; lang?: string } = {}
): Promise<void> {
    const type = normalizeOption(opts.type, SKILL_TYPES, 'workflow', '--type');
    const lang = normalizeOption(opts.lang, SKILL_LANGS, 'bilingual', '--lang');

    const config = await loadConfig();
    const spinner = logger.spinner('Generating skill…').start();

    const provider = createLLMProvider(config);
    const out = await provider.generateSkill(prompt, { type, lang });

    // 解析 SKILL.md frontmatter 提取 name
    const parsed = matter(out.skillMd);
    const fm = parsed.data as Partial<SkillFrontmatter>;
    if (!fm.name) throw new SkitError('E_LLM_INVALID_OUTPUT', '生成的 SKILL.md 缺少 frontmatter.name');

    const installRoot = getInstallRoot(config);
    const skillPath = path.join(installRoot, fm.name);
    await fs.mkdir(skillPath, { recursive: true });
    await fs.writeFile(path.join(skillPath, 'SKILL.md'), out.skillMd, 'utf-8');
    const pkg: SkillPackageJson = { ...out.packageJson, name: out.packageJson.name ?? fm.name };
    pkg.skkill = { ...pkg.skkill, installedAt: new Date().toISOString() };
    await fs.writeFile(path.join(skillPath, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

    // 写 scripts/ 资源
    if (out.scripts) {
        for (const [rel, content] of Object.entries(out.scripts)) {
            const filePath = path.join(skillPath, rel);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, content, 'utf-8');
        }
    }

    spinner.succeed(`Created ${fm.name} at ${skillPath}`);

    // 后置校验:违规可阻断
    const report = await validateSkill(skillPath);
    if (report.hits.length > 0) {
        console.log(formatReport(report, { color: true }));
        if (report.errors.length > 0) {
            throw new SkitError(
                'E_INVALID_SKILL',
                `生成结果未通过校验 (${report.errors.length} error, ${report.warnings.length} warn),请修正 prompt 或手动编辑后再 validate`
            );
        }
        logger.warn(`生成结果含 ${report.warnings.length} warning`);
    }

    // 询问应用目标
    const available = listAvailable();
    const selectedIds = opts.agents?.length ? opts.agents : await pickMany('应用到哪些 agent?', available as string[]);
    if (selectedIds.length === 0) return;

    const adapters = selectedIds
        .map(id => getAgent(id as never))
        .filter((a): a is NonNullable<typeof a> => a !== undefined);

    const skill: InstalledSkill = {
        name: fm.name,
        path: skillPath,
        packageJson: pkg,
        frontmatter: fm as SkillFrontmatter,
        appliedAgents: [],
    };
    const results = await applyToAgents(skill, adapters);
    for (const r of results) {
        if (r.error) logger.warn(`${r.agentId}: ${r.error}`);
        else logger.success(`Linked to ${r.agentId}`);
    }
}

function normalizeOption<T extends string>(value: string | undefined, allowed: T[], fallback: T, flag: string): T {
    if (!value) return fallback;
    if (!allowed.includes(value as T)) {
        throw new SkitError('E_LLM_INVALID_OUTPUT', `${flag} 取值必须为 ${allowed.join(' | ')},得到: ${value}`);
    }
    return value as T;
}
