import { Command } from 'commander';
import { SKKILL_VERSION } from './src/constants.js';
import { installCommand } from './src/commands/install.js';
import { uninstallCommand } from './src/commands/uninstall.js';
import { upgradeCommand } from './src/commands/upgrade.js';
import { linkCommand } from './src/commands/link.js';
import { unlinkCommand } from './src/commands/unlink.js';
import { searchCommand } from './src/commands/search.js';
import { initCommand } from './src/commands/init.js';
import { importCommand } from './src/commands/import.js';
import { publishCommand } from './src/commands/publish.js';
import { duplicateCommand } from './src/commands/duplicate.js';
import { listCommand } from './src/commands/list.js';
import { doctorCommand } from './src/commands/doctor.js';
import { validateCommand } from './src/commands/validate.js';
import { configCommand } from './src/commands/config.js';

const program = new Command();

program
    .name('skkill')
    .description('AI Agent Skill 包管理器 — 像 npm 一样管理 Skill')
    .version(SKKILL_VERSION)
    .option('--config <path>', '配置文件路径', undefined)
    .option('--verbose', '输出详细日志', false);

program
    .command('install <ref>')
    .alias('i')
    .description('下载并安装 Skill')
    .option('-a, --agents <ids...>', '指定应用的 agent id 列表')
    .action(async (ref: string, opts: { agents?: string[] }) => {
        await installCommand(ref, opts);
    });

program
    .command('uninstall <name>')
    .alias('u')
    .description('卸载 Skill')
    .option('-a, --agents <ids...>', '从哪些 agent 移除软链接 (默认: 全部)')
    .action(async (name: string, opts: { agents?: string[] }) => {
        await uninstallCommand(name, opts);
    });

program
    .command('upgrade <name>')
    .description('升级 Skill')
    .action(async (name: string) => {
        await upgradeCommand(name);
    });

program
    .command('link <agent>')
    .description('将已安装的 Skill 软链接到目标 agent (传入 all 则应用到全部)')
    .action(async (agent: string) => {
        await linkCommand(agent);
    });

program
    .command('unlink <agent>')
    .description('移除已安装 Skill 在目标 agent 的软链接 (传入 all 则从全部移除)')
    .action(async (agent: string) => {
        await unlinkCommand(agent);
    });

program
    .command('search <query>')
    .alias('s')
    .description('搜索 Skill (优先 onetool, 回退 GitHub topic:skkill-skill)')
    .option('-l, --limit <n>', '限制结果数', '20')
    .option('-b, --backend <id>', '指定 backend: onetool|github|npx-skill|git')
    .action(async (query: string, opts: { limit?: string; backend?: string }) => {
        await searchCommand(query, { limit: opts.limit ? Number(opts.limit) : undefined, backend: opts.backend });
    });

program
    .command('init <name>')
    .description('生成空 Skill 骨架 (SKILL.md + package.json + references/scripts/assets 目录)')
    .option('-d, --description <text>', '一句话描述 (默认留 TODO 占位)')
    .action(async (name: string, opts: { description?: string }) => {
        await initCommand(name, opts);
    });

program
    .command('import <path>')
    .description('把其他 Agent 的 skill 目录 mv 到 ~/.skkill/skills/ 并加入管理 (自动生成 package.json + lock)')
    .option('--name <name>', '强制指定 skill name (默认从 SKILL.md frontmatter 读, 退化用目录名)')
    .option('-a, --agents <ids...>', '指定应用的 agent id 列表')
    .action(async (sourcePath: string, opts: { name?: string; agents?: string[] }) => {
        await importCommand(sourcePath, opts);
    });

program
    .command('publish <name> [url]')
    .alias('pub')
    .description('发布 Skill 到 onetool 平台 (oneskill create/update)')
    .option('--update', '更新已存在的 skill (默认新建)', false)
    .option('--scope <scope>', '发布范围: workspace | hub (默认 workspace)')
    .option('--workspace-id <id>', '关联工作空间 ID (create 时可选,默认隐藏空间)', v => Number(v))
    .option('--tags <ids>', '场景标签 ID,逗号分隔 (create 必填,如 1,2,3)')
    .option('--brief-desc <text>', '简要描述 (≤100 字,缺则 LLM 生成)')
    .option('--detail-doc <text>', '详细描述 markdown (缺则 LLM 生成)')
    .option('--display-name <name>', '展示名称 (默认使用 frontmatter.name)')
    .option('-y, --yes', '跳过确认步骤', false)
    .action(
        async (
            name: string,
            url: string | undefined,
            opts: {
                update?: boolean;
                scope?: string;
                workspaceId?: number;
                tags?: string;
                briefDesc?: string;
                detailDoc?: string;
                displayName?: string;
                yes?: boolean;
            }
        ) => {
            await publishCommand(name, url, opts);
        }
    );

program
    .command('duplicate <src> <newName>')
    .alias('d')
    .description('派生 Skill 到新名称')
    .action(async (src: string, newName: string) => {
        await duplicateCommand(src, newName);
    });

program
    .command('list')
    .alias('ls')
    .description('列出已安装的 Skills')
    .option('--json', '以 JSON 格式输出', false)
    .action(async (opts: { json?: boolean }) => {
        await listCommand({ json: opts.json });
    });

program
    .command('doctor')
    .description('环境自检 (Node, git, npm, onetool, config, LLM key)')
    .action(async () => {
        await doctorCommand();
    });

program
    .command('validate <path-or-name>')
    .alias('check')
    .description('校验 Skill 目录或已安装 Skill (frontmatter / 命令安全 / 资源可发现性 / 描述质量)')
    .option('--strict', 'warn 也视作 error', false)
    .action(async (target: string, opts: { strict?: boolean }) => {
        await validateCommand(target, { strict: opts.strict });
    });

program
    .command('config')
    .description('查看 / 编辑 ~/.skkill/config.yaml (init | show | path | edit | set <key> <value> | unset <key>)')
    .argument('[action]', 'init | show | path | edit | set | unset', 'show')
    .argument('[key]', 'set / unset 时使用,形如 backend.onetool.apiBase')
    .argument('[value]', 'set 时使用')
    .action(async (action: string, key?: string, value?: string) => {
        await configCommand({
            action: action as 'init' | 'show' | 'path' | 'edit' | 'set' | 'unset',
            key,
            value,
        });
    });

await program.parseAsync(process.argv);
