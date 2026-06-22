import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { SkitError } from '../utils/logger.js';

export type RuleLevel = 'error' | 'warn';
export interface RuleHit {
    level: RuleLevel;
    code: string;
    message: string;
}
export interface ValidationReport {
    skillDir: string;
    hits: RuleHit[];
    get errors(): RuleHit[];
    get warnings(): RuleHit[];
    get passed(): boolean;
}

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CODE_BLOCK_PATTERN = /```(?:bash|sh|shell)\n([\s\S]*?)```/gi;
// onetool 描述的 trigger 词表 (baidu-skill-checker 1.5 + 3.x 子集)
const TRIGGER_KEYWORDS = [
    '使用',
    '用于',
    '创建',
    '查询',
    '管理',
    '解析',
    '生成',
    '转换',
    '帮助',
    '处理',
    'use',
    'when',
    'generate',
    'create',
    'manage',
    'parse',
    'convert',
    'search',
];

// 章节标题:中英文都接受
const SECTION_HEADERS: Record<string, string[]> = {
    workflow: ['## 工作流', '## Workflow', '## Steps', '## 工作流程'],
    api: ['## 核心能力', '## Core Capabilities', '## 调用方式', '## Usage'],
    mixed: ['## 典型工作流', '## 核心能力', '## Core Workflow'],
    reference: ['## 自检清单', '## Checklist', '## Self-Check'],
};

function makeReport(skillDir: string, hits: RuleHit[]): ValidationReport {
    return {
        skillDir,
        hits,
        get errors() {
            return hits.filter(h => h.level === 'error');
        },
        get warnings() {
            return hits.filter(h => h.level === 'warn');
        },
        get passed() {
            return this.errors.length === 0;
        },
    };
}

// 命令安全:从 code block 里抽 bash/sh 命令行,逐行检测
function checkCommandSafety(body: string, hits: RuleHit[]): void {
    for (const block of body.matchAll(CODE_BLOCK_PATTERN)) {
        const lines = block[1]!.split('\n');
        for (const raw of lines) {
            const line = raw.trim();
            if (!line || line.startsWith('#')) continue;
            if (line.includes('&&')) {
                hits.push({ level: 'error', code: 'E_CMD_AND', message: `命令使用禁用操作符 &&: ${line}` });
            }
            if (line.includes(';') && !line.startsWith('//')) {
                hits.push({ level: 'error', code: 'E_CMD_SEMI', message: `命令使用禁用操作符 ;: ${line}` });
            }
            // 排除 <...> 占位后看 | (排除 ||)
            const noAngles = line.replace(/<[^>]*>/g, '');
            if (/(?<!\|)\|(?!\|)/.test(noAngles)) {
                hits.push({ level: 'error', code: 'E_CMD_PIPE', message: `命令使用禁用操作符 |: ${line}` });
            }
            if (/(^|\s)cd\s+/.test(line)) {
                hits.push({ level: 'error', code: 'E_CMD_CD', message: `命令不应使用 cd: ${line}` });
            }
            if (/(^|\s)export\s+/.test(line)) {
                hits.push({ level: 'error', code: 'E_CMD_EXPORT', message: `命令不应使用 export: ${line}` });
            }
            if (/^[A-Za-z_]\w*=\S+\s+\w+/.test(line)) {
                hits.push({ level: 'error', code: 'E_CMD_INLINE_ENV', message: `命令使用行内环境变量赋值: ${line}` });
            }
        }
    }
}

// 资源可发现性:scripts/references/assets 里的每个文件,在 SKILL.md body 中至少提到一次
async function checkResourceDiscoverability(skillDir: string, body: string, hits: RuleHit[]): Promise<void> {
    for (const res of ['scripts', 'references', 'assets']) {
        const dir = path.join(skillDir, res);
        const stat = await fs.stat(dir).catch(() => null);
        if (!stat?.isDirectory()) continue;
        const files = await fs.readdir(dir);
        if (files.length === 0) {
            hits.push({ level: 'error', code: 'E_EMPTY_RESOURCE', message: `空资源目录应删除或填充: ${res}/` });
            continue;
        }
        for (const f of files) {
            const baseName = path.parse(f).name;
            if (!body.includes(`${res}/${f}`) && !body.includes(`${res}/`) && !body.includes(baseName)) {
                hits.push({
                    level: 'warn',
                    code: 'W_RESOURCE_NOT_REFERENCED',
                    message: `资源 ${res}/${f} 在 SKILL.md 中未被引用`,
                });
            }
        }
    }
}

export async function validateSkill(skillPath: string): Promise<ValidationReport> {
    const skillDir = path.resolve(skillPath);
    const hits: RuleHit[] = [];

    if (!(await fs.stat(skillDir).catch(() => null))) {
        throw new SkitError('E_INVALID_SKILL', `Skill 路径不存在: ${skillDir}`);
    }
    if (
        !(await fs
            .stat(skillDir)
            .then(s => s.isDirectory())
            .catch(() => false))
    ) {
        throw new SkitError('E_INVALID_SKILL', `Skill 路径不是目录: ${skillDir}`);
    }

    // SKILL.md 必须存在 (大小写敏感)
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    const exists = await fs.stat(skillMdPath).catch(() => null);
    if (!exists) {
        // 提示大小写问题
        const entries = await fs.readdir(skillDir).catch(() => []);
        const lowerMatch = entries.find(e => e.toLowerCase() === 'skill.md');
        if (lowerMatch) {
            hits.push({
                level: 'error',
                code: 'E_SKILLMD_CASE',
                message: `SKILL.md 大小写错误,实为 ${lowerMatch}`,
            });
        } else {
            hits.push({ level: 'error', code: 'E_NO_SKILLMD', message: '缺少 SKILL.md' });
            return makeReport(skillDir, hits);
        }
    }

    const content = await fs.readFile(
        exists
            ? skillMdPath
            : path.join(skillDir, (await fs.readdir(skillDir)).find(e => e.toLowerCase() === 'skill.md')!),
        'utf-8'
    );
    let parsed: matter.GrayMatterFile<string>;
    try {
        parsed = matter(content);
    } catch (err) {
        hits.push({
            level: 'error',
            code: 'E_FRONTMATTER_PARSE',
            message: `frontmatter 解析失败: ${(err as Error).message}`,
        });
        return makeReport(skillDir, hits);
    }
    const fm = parsed.data as Record<string, unknown>;
    const body = parsed.content;

    // ====== 1. frontmatter (errors) ======
    const name = typeof fm.name === 'string' ? fm.name : '';
    if (!name) {
        hits.push({ level: 'error', code: 'E_NO_NAME', message: 'frontmatter 缺少 name' });
    } else {
        if (!NAME_PATTERN.test(name)) {
            hits.push({
                level: 'error',
                code: 'E_NAME_FORMAT',
                message: 'name 必须 kebab-case (小写字母数字单横线)',
            });
        }
        if (name.length > 64) {
            hits.push({ level: 'error', code: 'E_NAME_TOO_LONG', message: `name 超过 64 字符 (${name.length})` });
        }
        if (path.basename(skillDir) !== name) {
            hits.push({
                level: 'error',
                code: 'E_NAME_DIR_MISMATCH',
                message: `目录名 ${path.basename(skillDir)} 与 name ${name} 不一致`,
            });
        }
    }

    const description = typeof fm.description === 'string' ? fm.description : '';
    if (!description) {
        hits.push({ level: 'error', code: 'E_NO_DESC', message: 'frontmatter 缺少 description' });
    } else {
        if (description.length > 1024) {
            hits.push({
                level: 'error',
                code: 'E_DESC_TOO_LONG',
                message: `description 超过 1024 字符 (${description.length})`,
            });
        }
        if (description.includes('<') || description.includes('>')) {
            hits.push({ level: 'error', code: 'E_DESC_ANGLE', message: 'description 不能包含 < 或 >' });
        }
        if (/TODO/i.test(description)) {
            hits.push({ level: 'error', code: 'E_DESC_TODO', message: 'description 包含 TODO 占位' });
        }
        if (!TRIGGER_KEYWORDS.some(kw => description.includes(kw))) {
            hits.push({ level: 'warn', code: 'W_DESC_NO_TRIGGER', message: 'description 缺少触发场景关键词' });
        }
        if (description.length < 50) {
            hits.push({
                level: 'warn',
                code: 'W_DESC_TOO_SHORT',
                message: `description 偏短 (${description.length} 字符),难以路由`,
            });
        }
        // 反模式:trigger-only 开头
        const triggerStarters = ['当用户', '用户说', '用户提到', '如果用户', 'When user', 'Use when'];
        if (triggerStarters.some(p => description.startsWith(p))) {
            hits.push({
                level: 'warn',
                code: 'W_DESC_TRIGGER_FIRST',
                message: 'description 应先写能力边界,再补触发场景',
            });
        }
    }

    // ====== 2. body 残留 TODO ======
    if (/\bTODO\b/.test(body)) {
        hits.push({ level: 'error', code: 'E_BODY_TODO', message: 'SKILL.md 正文仍含 TODO 占位' });
    }

    // ====== 3. 正文长度 ======
    const wordCount = body.split(/\s+/).filter(Boolean).length;
    if (wordCount > 5000) {
        hits.push({ level: 'warn', code: 'W_BODY_TOO_LONG', message: `正文 ${wordCount} 词 (建议 ≤5000)` });
    }

    // ====== 4. 错误处理章节 ======
    const mentionsApi = /scripts\/|API|接口|api/.test(content);
    const hasErrorHandling = /错误处理|Error Handling/i.test(content);
    if (mentionsApi && !hasErrorHandling) {
        hits.push({
            level: 'error',
            code: 'E_NO_ERROR_HANDLING',
            message: '涉及脚本/API 必须包含「错误处理」章节',
        });
    }

    // ====== 5. 命令安全 ======
    checkCommandSafety(body, hits);

    // ====== 6. 资源可发现性 ======
    await checkResourceDiscoverability(skillDir, body, hits);

    // ====== 7. 文档结构 (类型化) ======
    const skillType =
        (typeof fm.metadata === 'object' && fm.metadata && (fm.metadata as Record<string, unknown>).type) || 'workflow';
    const requiredHeaders = SECTION_HEADERS[skillType as string];
    if (requiredHeaders) {
        const missing = requiredHeaders.filter(h => !body.includes(h));
        if (missing.length === requiredHeaders.length) {
            hits.push({
                level: 'warn',
                code: 'W_TYPE_SECTIONS',
                message: `${skillType} 类型应包含章节之一: ${requiredHeaders.join(' / ')}`,
            });
        }
    }

    // ====== 8. 安全 (baidu-skill-checker 5.x 子集,本地能判的) ======
    if (/curl[^`\n]*\s-k\b/.test(body)) {
        hits.push({ level: 'warn', code: 'W_SECURE_CURL_K', message: 'curl 使用 -k 跳过证书校验' });
    }
    if (/(^|[^.\w])(eval|exec)\(/.test(body)) {
        hits.push({ level: 'warn', code: 'W_EVAL_EXEC', message: '正文出现 eval/exec 调用,请确认安全' });
    }

    return makeReport(skillDir, hits);
}

// 格式化报告为可读文本
export function formatReport(report: ValidationReport, _opts: { color?: boolean } = {}): string {
    const lines: string[] = [];
    lines.push(`Validation report for ${report.skillDir}`);
    lines.push('');
    if (report.hits.length === 0) {
        lines.push('  No issues found.');
        return lines.join('\n');
    }
    for (const h of report.hits) {
        const mark = h.level === 'error' ? '✖' : '⚠';
        const tag = `[${h.level === 'error' ? 'error' : 'warn'}]`;
        lines.push(`  ${mark} ${tag.padEnd(7)} ${h.code.padEnd(22)} ${h.message}`);
    }
    lines.push('');
    lines.push(`Summary: ${report.errors.length} error(s), ${report.warnings.length} warning(s)`);
    return lines.join('\n');
}
