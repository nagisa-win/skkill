import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { loadConfig, getInstallRoot } from '../lib/config.js';
import { logger, SkitError } from '../utils/logger.js';
import { assertPathSafe } from '../utils/sanitize.js';
import { pathExists } from '../utils/paths.js';
import { upsertSkill } from '../lib/skill-lock.js';
import type { ConfigFile } from '../types/config.js';
import type { SkillFrontmatter, SkillPackageJson } from '../types/skill.js';

// manifest.ts 同款正则, init 阶段先校验避免后续 validate 报错
const KEBAB_RE = /^[a-z0-9-]+$/;

// init 子命令: 生成空 skill 骨架 (SKILL.md + package.json + references/scripts/assets 目录)
// 不依赖 LLM, 不联网, 纯脚手架
export async function initCommand(
    name: string,
    opts: { description?: string; config?: ConfigFile; lockPath?: string } = {}
): Promise<{ skillPath: string; name: string }> {
    validateName(name);

    const config = opts.config ?? (await loadConfig());
    const installRoot = getInstallRoot(config);
    const skillPath = path.join(installRoot, name);
    assertPathSafe(installRoot, skillPath);

    if (await pathExists(skillPath)) {
        throw new SkitError('E_ALREADY_INSTALLED', `${skillPath} 已存在, init 拒绝覆盖`);
    }
    await fs.mkdir(skillPath, { recursive: true });

    const description = opts.description?.trim() || `TODO: 描述 ${name} 的用途 (≤1024 字符)`;
    await writeSkillMd(skillPath, name, description);
    await writePackageJson(skillPath, name, description);
    await ensureResourceDirs(skillPath);

    // 写 lock (init 视为新装, installedAt 用当前时间)
    await upsertSkill(
        {
            name,
            source: name,
            sourceType: 'local',
            sourceUrl: `file://${skillPath}`,
            backend: 'git',
            installedAt: new Date().toISOString(),
        },
        opts.lockPath
    );

    logger.success(`Initialized ${name} at ${skillPath}`);
    const promptBody = buildPromptBody(skillPath, name);
    await fs.writeFile(path.join(skillPath, 'PROMPT.md'), promptBody, 'utf-8');
    printPromptToStdout(skillPath, name, promptBody);
    logger.info(`下一步: 在 ${skillPath}/ 下编辑 SKILL.md, 然后用 'skkill validate ${name}' 校验`);
    return { skillPath, name };
}

function validateName(name: string): void {
    if (name.length === 0 || name.length > 64 || !KEBAB_RE.test(name)) {
        throw new SkitError(
            'E_INVALID_INPUT',
            `skill name 必须为 kebab-case (小写字母/数字/-) 且 ≤64 字符: "${name}"`
        );
    }
}

async function writeSkillMd(skillPath: string, name: string, description: string): Promise<void> {
    const frontmatter: SkillFrontmatter = { name, description };
    const fmYaml = formatYaml(frontmatter);
    const body = [
        `# ${name}`,
        '',
        `> ${description}`,
        '',
        '## When to use',
        '',
        '<!-- 描述什么场景下应该启用这个 skill -->',
        '',
        '## Steps',
        '',
        '1. ',
        '2. ',
        '',
        '## References',
        '',
        '<!-- references/ 下的文档会被自动检索, 在此处用相对链接引用关键文件 -->',
        '',
    ].join('\n');
    await fs.writeFile(path.join(skillPath, 'SKILL.md'), `---\n${fmYaml}---\n${body}\n`, 'utf-8');
}

function formatYaml(fm: SkillFrontmatter): string {
    // 简单 YAML 序列化, 避免依赖 gray-matter 的 stringify (它会把 description 引号化得很奇怪)
    const desc = fm.description.includes(':') || fm.description.includes('#')
        ? `"${fm.description.replace(/"/g, '\\"')}"`
        : fm.description;
    return `name: ${fm.name}\ndescription: ${desc}\n`;
}

async function writePackageJson(skillPath: string, name: string, description: string): Promise<void> {
    const pkg: SkillPackageJson = {
        name,
        version: '0.1.0',
        description,
        skkill: { installedAt: new Date().toISOString() },
    };
    await fs.writeFile(
        path.join(skillPath, 'package.json'),
        JSON.stringify(pkg, null, 2) + '\n',
        'utf-8'
    );
}

async function ensureResourceDirs(skillPath: string): Promise<void> {
    for (const dir of ['references', 'scripts', 'assets']) {
        const full = path.join(skillPath, dir);
        await fs.mkdir(full, { recursive: true });
        await fs.writeFile(path.join(full, '.gitkeep'), '', 'utf-8');
    }
}

function buildPromptBody(skillPath: string, name: string): string {
    return `# 用 coding agent 完成 ${name} skill

你是一个 AI coding agent。请按下列规范, 直接编辑目录 \`${skillPath}\` 完成这个 skill, 完成后用 \`skkill validate ${name}\` 自检直至 0 error。

## 必读约束 (来自 skkill 校验器)

1. **目录结构**: SKILL.md 必须位于 \`${skillPath}/SKILL.md\` (根目录)
2. **frontmatter**: 必须含 \`name\` (kebab-case, ≤64 字符) 和 \`description\` (≤1024 字符, 描述 \`when to use\` 而非 \`what it does\`)
3. **资源子目录**: 三个固定子目录, 引用必须用相对路径
    - \`references/\` — 长篇文档 (>= 100 字 才值得放, 否则直接写 SKILL.md)
    - \`scripts/\` — 可执行代码 (含 shebang, 用 bash/python/node, 不要写伪代码)
    - \`assets/\` — 二进制 / 模板文件 (SVG, JSON 模板等)
4. **SKILL.md 大小**: body ≤ 5000 字符, 超出则拆到 references/
5. **description 质量红线**:
    - 不能用 \`when to use this skill\` 这种空洞开头
    - 不能纯大写或全 ASCII 装饰符
    - 第三人称视角 ("Processes X" 而非 "Use this to process X")
6. **命令安全**: scripts/ 里不允许 \`curl | sh\` \`rm -rf /\` \`eval\` 这类危险模式
7. **不要硬编码内网 URL / token**; 所有可配置项写到 \`~/.skkill/config.yaml\`

## 推荐工作流

1. 读 \`~/.skkill/skills/\` 下已安装 skill 各 1 份 (作为风格参考, 注意哪些 frontmatter 写法被 validate 接受)
2. 询问我 (用户) 这个 skill 要解决的**具体场景**和**典型输入/输出**
3. 写 SKILL.md (frontmatter + body: When to use / Steps / References 三段式, 见现有骨架)
4. 如需脚本/参考文档, 放到对应子目录并在 SKILL.md 用相对路径引用 (如 \`scripts/deploy.sh\`)
5. 跑 \`skkill validate ${name}\`, 修到 0 error / 0 warn (或仅可接受的 warn)
6. 跑 \`skkill install ${skillPath.replace(/\/$/, '')}\` 把 skill 链接到目标 agent (claude-code / codex 等)

## 编辑禁区

- **不要改** \`package.json\` 的 \`name\` \`version\` \`skkill.installedAt\` 三个字段 (skkill 自己维护)
- **不要删** \`.gitkeep\` 文件 (保证空目录能被 git 跟踪)
- **不要在 SKILL.md 放完整代码**: 长代码放 scripts/ 然后引用

## 参考资源

- 校验规则源码: https://github.com/<owner>/skkill/tree/main/src/lib/skill-rules.ts
- 已安装 skill 示例: \`ls ~/.skkill/skills/\`
- skkill 文档: 运行 \`skkill --help\` 看所有命令

完成后告诉我哪些步骤做了什么, 我来 review。
`;
}

function printPromptToStdout(skillPath: string, name: string, body: string): void {
    const border = '─'.repeat(72);
    console.log('');
    console.log(chalk.bold.cyan(border));
    console.log(chalk.bold.cyan(`  已生成 PROMPT.md — 把下面这段发给 Claude / Codex / 其他 coding agent`));
    console.log(chalk.bold.cyan(`  (文件也在 ${path.join(skillPath, 'PROMPT.md')})`));
    console.log(chalk.bold.cyan(border));
    console.log(body);
    console.log(chalk.bold.cyan(border));
}
