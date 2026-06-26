import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { loadConfig, getInstallRoot } from '../lib/config.js';
import { logger } from '../utils/logger.js';
import { confirm, pickOne, pickMany } from '../utils/prompt.js';
import { createLLMProvider } from '../lib/llm/index.js';
import {
    ensureOneskillAvailable,
    createPublish,
    updatePublish,
    fetchOneskillInfo,
    fetchOneskillTags,
    readIdentifier,
    writeSkillMeta,
    HINTS,
    type PublishScope,
    type OnetoolInfo,
    type OnetoolTag,
} from '../lib/publisher.js';
import { SkitError } from '../utils/logger.js';
import type { SkillLang } from '../types/llm.js';

interface PublishFlags {
    update?: boolean;
    scope?: string;
    workspaceId?: number;
    tags?: string;
    briefDesc?: string;
    detailDoc?: string;
    yes?: boolean;
    displayName?: string;
}

export async function publishCommand(
    name: string,
    _legacyUrl: string | undefined,
    opts: PublishFlags = {}
): Promise<void> {
    const config = await loadConfig();
    const installRoot = getInstallRoot(config);
    const skillPath = path.join(installRoot, name);

    // pre-flight
    await ensureOneskillAvailable();

    // update 流程需要 skillId:从 .skill-meta.json 读,缺则走 oneskill info
    let skillId: number | undefined;
    let shouldUpdate = opts.update;

    if (opts.update) {
        skillId = await resolveSkillIdForUpdate(skillPath);
        if (!Number.isFinite(skillId)) {
            throw new SkitError('E_INVALID_SKILL', `无法确定 skillId,请手动通过 --skill-id 指定`);
        }
    } else {
        // 创建流程:检查是否已存在同名 skill
        const existing = await detectExistingSkills(skillPath);
        if (existing.length > 0) {
            const result = await promptForExistingSkill(existing);
            if (result.action === 'cancel') {
                return;
            }
            if (result.action === 'update') {
                skillId = result.skillId;
                shouldUpdate = true;
            }
        }
    }

    // 解析 SKILL.md frontmatter + 正文
    const identifier = await readIdentifier(skillPath);
    const skillMd = await fs.readFile(path.join(skillPath, 'SKILL.md'), 'utf-8');
    const { data } = matter(skillMd);
    const fmLang = (data as Record<string, unknown>).language as SkillLang | undefined;
    const fmDescription = ((data as Record<string, unknown>).description as string | undefined)?.trim() ?? '';

    // 描述:CLI flag 缺则 LLM 生成;LLM 失败则降级用 SKILL.md frontmatter 的 description
    const lang: SkillLang = fmLang ?? 'bilingual';
    let briefDesc = opts.briefDesc?.trim();
    let detailDoc = opts.detailDoc?.trim();
    if (!briefDesc || !detailDoc) {
        const provider = createLLMProvider(config);
        if (!briefDesc || !detailDoc) {
            logger.info('调用 LLM 生成 briefDesc / detailDoc…');
            try {
                const generated = await provider.generateBriefDetail(skillMd, { lang });
                briefDesc = briefDesc ?? generated.briefDesc;
                detailDoc = detailDoc ?? generated.detailDoc;
            } catch (err) {
                logger.warn(`LLM 生成失败,降级使用 SKILL.md description: ${(err as Error).message}`);
                if (!briefDesc && fmDescription) briefDesc = truncateForBrief(fmDescription);
                if (!detailDoc && fmDescription) detailDoc = detailDocFromDescription(fmDescription);
            }
        }
    }
    if (!briefDesc) throw new SkitError('E_INVALID_SKILL', 'briefDesc 缺失且 LLM 生成失败、SKILL.md 缺少 description');
    if (!detailDoc) throw new SkitError('E_INVALID_SKILL', 'detailDoc 缺失且 LLM 生成失败、SKILL.md 缺少 description');

    // 展示名称:CLI 缺则用 name 字段
    const displayName = (opts.displayName ?? identifier).trim();

    // 发布范围
    const publishScope = parseScope(opts.scope);

    // 标签 (create 必填,缺则从 oneskill 拉列表交互式选择)
    let tagIds: number[] = [];
    if (!shouldUpdate) {
        tagIds = parseTagIds(opts.tags);
        if (tagIds.length === 0) {
            tagIds = await pickTagIds();
            if (tagIds.length === 0) {
                throw new SkitError('E_INVALID_INPUT', '未选择任何标签,创建流程取消');
            }
        }
    }

    // 工作空间 (create 可选)
    const workspaceId: number | undefined = opts.workspaceId;

    // ===== 展示确认 =====
    console.log('');
    logger.info('发布确认:');
    console.log(`  路径:        ${skillPath}`);
    console.log(`  标识:        ${identifier}`);
    console.log(`  名称:        ${displayName}`);
    if (!shouldUpdate) {
        console.log(`  关联空间:    ${workspaceId !== undefined ? `#${workspaceId}` : '(隐藏空间)'}`);
        console.log(`  场景标签:    ${tagIds.join(', ')}`);
    } else {
        console.log(`  Skill ID:    ${skillId}`);
    }
    console.log(`  发布范围:    ${publishScope === 'hub' ? '广场 (hub)' : '空间 (workspace)'}`);
    console.log(`  简要描述:    ${briefDesc}`);
    console.log(
        `  详细描述:    ${(detailDoc.length > 200 ? detailDoc.slice(0, 200) + '…' : detailDoc).replace(/\n/g, '\n               ')}`
    );

    if (!opts.yes) {
        const ok = await confirm('确认发布?', false);
        if (!ok) {
            logger.warn('已取消');
            return;
        }
    }

    // ===== 执行 =====
    const spinner = logger.spinner('发布中…').start();
    let result;
    try {
        if (shouldUpdate) {
            result = await updatePublish({
                skillPath,
                skillId: skillId!,
                briefDesc,
                detailDoc,
                publishScope,
            });
        } else {
            result = await createPublish({
                skillPath,
                displayName,
                briefDesc,
                detailDoc,
                tagIds,
                workspaceId,
                publishScope,
            });
        }
    } catch (err) {
        spinner.fail('发布失败');
        throw err;
    }
    spinner.succeed(`发布成功: ${result.skillName} (#${result.skillId})`);

    // 回写 .skill-meta.json
    await writeSkillMeta(skillPath, result);
    logger.success(`已回写 ${path.join(skillPath, '.skill-meta.json')}`);

    // 平台链接
    if (result.url) console.log(`  链接:        ${result.url}`);

    // 广场发布安全扫描提示 (硬规则,不可省略)
    if (publishScope === 'hub' || result.status === 'publishing') {
        console.log('');
        console.log(HINTS.HUB_SCAN_NOTICE);
    }
}

function parseScope(value: string | undefined): PublishScope {
    if (!value) return 'workspace';
    if (value === 'workspace' || value === 'hub') return value;
    throw new SkitError('E_INVALID_INPUT', `--scope 取值必须为 workspace | hub,得到: ${value}`);
}

function parseTagIds(value: string | undefined): number[] {
    if (!value) return [];
    return value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => {
            const n = Number(s);
            if (!Number.isFinite(n) || n <= 0) {
                throw new SkitError('E_INVALID_INPUT', `--tags 取值必须为正整数列表,如 1,2,3,得到: ${value}`);
            }
            return n;
        });
}

async function pickTagIds(): Promise<number[]> {
    let tags: OnetoolTag[];
    try {
        tags = await fetchOneskillTags();
    } catch (err) {
        throw new SkitError(
            'E_INVALID_INPUT',
            `未传 --tags,且拉取可用标签失败: ${(err as Error).message}\n可手动 --tags 1,2,3 重试`
        );
    }
    // 默认预选名称含「开发 / 编程 / dev」的常见标签
    const defaultIds = tags.filter(t => /开发|编程|dev/i.test(t.tagName)).map(t => t.tagId);
    const labels = tags.map(t => `${t.tagName} (#${t.tagId})`);
    const idxList = await pickMany('选择场景标签 (空格切换,回车确认,Ctrl+C 取消):', labels, defaultIds.length > 0
        ? labels.filter((_, i) => defaultIds.includes(tags[i]!.tagId))
        : [labels[0]!]);
    if (idxList === null) return [];
    const labelToId = new Map(labels.map((l, i) => [l, tags[i]!.tagId] as const));
    return idxList.map(l => labelToId.get(l)!).filter((id): id is number => Number.isFinite(id));
}

function truncateForBrief(desc: string): string {
    const firstSentence = /^[^。！？.!?\n]+[。！？.!?]?/.exec(desc)?.[0] ?? desc;
    const trimmed = firstSentence.trim();
    return trimmed.length > 100 ? `${trimmed.slice(0, 97)}...` : trimmed;
}

function detailDocFromDescription(desc: string): string {
    const body = desc.trim();
    return `## 功能简介\n\n${body}\n\n## 适用场景\n\n请补充。\n\n## 不适用场景\n\n请补充。\n\n## 依赖要求\n\n| 项目 | 说明 |\n| --- | --- |\n| (无) | 由 LLM 失败降级,后续在平台手动补充 |\n\n## 使用方式\n\n请参考 SKILL.md 完整正文。`;
}

async function readMetaFile(skillPath: string): Promise<Record<string, unknown>> {
    const metaPath = path.join(skillPath, '.skill-meta.json');
    const text = await fs.readFile(metaPath, 'utf-8').catch(() => null);
    if (!text) return {};
    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        return {};
    }
}

async function pickOneskillInfo(infos: OnetoolInfo[]): Promise<OnetoolInfo> {
    if (infos.length === 0) {
        throw new SkitError('E_INVALID_SKILL', 'oneskill info 返回空列表,无法确定要更新的 skill');
    }
    if (infos.length === 1) return infos[0]!;
    const labels = infos.map(i => `${i.skillName} (#${i.skillId}) — ${i.newSkillIdentifier}`);
    const idxLabel = await pickOne('检测到多个同名 skill,请选择要更新的:', labels);
    const chosen = infos.find(i => {
        const label = `${i.skillName} (#${i.skillId}) — ${i.newSkillIdentifier}`;
        return label === idxLabel;
    });
    if (!chosen) throw new SkitError('E_INVALID_SKILL', 'pickOne 返回了未匹配项');
    return chosen;
}

interface ExistingSkill {
    skillId: number;
    skillName: string;
    identifier: string;
    source: 'local' | 'remote';
}

/** update 模式: 从本地 meta 或远程 info 解析 skillId */
async function resolveSkillIdForUpdate(skillPath: string): Promise<number> {
    const meta = await readMetaFile(skillPath);
    if (meta.skill_id) {
        const id = Number(meta.skill_id);
        if (Number.isFinite(id)) return id;
    }
    const infos = await fetchOneskillInfo(skillPath);
    const chosen = await pickOneskillInfo(infos);
    return chosen.skillId;
}

/** 检测已存在的同名 skill (本地 meta + 远程 info) */
async function detectExistingSkills(skillPath: string): Promise<ExistingSkill[]> {
    const existing: ExistingSkill[] = [];

    // 1. 检查本地 .skill-meta.json
    const meta = await readMetaFile(skillPath);
    if (meta.skill_id) {
        const id = Number(meta.skill_id);
        if (Number.isFinite(id)) {
            existing.push({
                skillId: id,
                skillName: (meta.skill_name as string) ?? (meta.name as string) ?? 'unknown',
                identifier: (meta.skill_identifier as string) ?? '',
                source: 'local',
            });
        }
    }

    // 2. 检查远程 (排除本地已有的)
    const remoteInfos = await fetchOneskillInfo(skillPath).catch(() => [] as OnetoolInfo[]);
    const localId = existing.find(e => e.source === 'local')?.skillId;
    for (const info of remoteInfos) {
        if (localId !== info.skillId) {
            existing.push({
                skillId: info.skillId,
                skillName: info.skillName,
                identifier: info.newSkillIdentifier,
                source: 'remote',
            });
        }
    }

    return existing;
}

/** 统一的交互提示: 更新/新建/取消 */
async function promptForExistingSkill(
    existing: ExistingSkill[]
): Promise<{ action: 'update' | 'create' | 'cancel'; skillId?: number }> {
    logger.warn(`检测到已存在 ${existing.length} 个同名 skill:`);
    for (const skill of existing) {
        const tag = skill.source === 'local' ? '[本地]' : '[远程]';
        console.log(`  ${tag} ${skill.skillName} (#${skill.skillId}) — ${skill.identifier}`);
    }
    console.log('');

    const options = existing.map(s => `更新 #${s.skillId} (${s.source === 'local' ? '本地记录' : '远程'})`);
    options.push('创建新的 skill (不推荐)', '取消');

    const choice = await pickOne('请选择操作:', options);

    if (!choice || choice === '取消') {
        logger.warn('已取消');
        return { action: 'cancel' };
    }
    if (choice === '创建新的 skill (不推荐)') {
        logger.warn('将创建新的同名 skill');
        return { action: 'create' };
    }

    // 解析选择的 skillId
    const match = /^更新 #(\d+)/.exec(choice);
    if (match) {
        const id = Number(match[1]);
        logger.info(`已切换到更新模式: skill_id=${id}`);
        return { action: 'update', skillId: id };
    }

    // 兜底: 默认取第一个
    const first = existing[0]!;
    logger.info(`已切换到更新模式: skill_id=${first.skillId}`);
    return { action: 'update', skillId: first.skillId };
}
