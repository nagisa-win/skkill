import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { loadConfig, getInstallRoot } from '../lib/config.js';
import { logger } from '../utils/logger.js';
import { confirm, pickOne } from '../utils/prompt.js';
import { createLLMProvider } from '../lib/llm/index.js';
import {
    ensureOneskillAvailable,
    createPublish,
    updatePublish,
    fetchOneskillInfo,
    readIdentifier,
    writeSkillMeta,
    HINTS,
    type PublishScope,
    type OnetoolInfo,
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
    if (opts.update) {
        const meta = await readMetaFile(skillPath);
        if (meta.skill_id) {
            skillId = Number(meta.skill_id);
        } else {
            const infos = await fetchOneskillInfo(skillPath);
            const chosen = await pickOneskillInfo(infos);
            skillId = chosen.skillId;
        }
        if (!Number.isFinite(skillId)) {
            throw new SkitError('E_INVALID_SKILL', `无法确定 skillId,请手动通过 --skill-id 指定`);
        }
    }

    // 解析 SKILL.md frontmatter + 正文
    const identifier = await readIdentifier(skillPath);
    const skillMd = await fs.readFile(path.join(skillPath, 'SKILL.md'), 'utf-8');
    const { data } = matter(skillMd);
    const fmLang = (data as Record<string, unknown>).language as SkillLang | undefined;

    // 描述:CLI flag 缺则 LLM 生成
    const lang: SkillLang = fmLang ?? 'bilingual';
    let briefDesc = opts.briefDesc?.trim();
    let detailDoc = opts.detailDoc?.trim();
    if (!briefDesc || !detailDoc) {
        const provider = createLLMProvider(config);
        if (!briefDesc || !detailDoc) {
            logger.info('调用 LLM 生成 briefDesc / detailDoc…');
            const generated = await provider.generateBriefDetail(skillMd, { lang });
            briefDesc = briefDesc ?? generated.briefDesc;
            detailDoc = detailDoc ?? generated.detailDoc;
        }
    }
    if (!briefDesc) throw new SkitError('E_INVALID_SKILL', 'briefDesc 缺失且 LLM 生成失败');
    if (!detailDoc) throw new SkitError('E_INVALID_SKILL', 'detailDoc 缺失且 LLM 生成失败');

    // 展示名称:CLI 缺则用 name 字段
    const displayName = (opts.displayName ?? identifier).trim();

    // 发布范围
    const publishScope = parseScope(opts.scope);

    // 标签 (create 必填)
    let tagIds: number[] = [];
    if (!opts.update) {
        tagIds = parseTagIds(opts.tags);
        if (tagIds.length === 0) {
            throw new SkitError('E_INVALID_INPUT', '创建流程必须通过 --tags 1,2,3 指定至少一个标签');
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
    if (!opts.update) {
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
        if (opts.update) {
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
