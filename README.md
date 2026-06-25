# skkill

> AI Agent Skill 包管理器 — 像 npm 一样管理 Skill,在 Claude Code / Codex / OpenCode 等多 Agent 间一键共享

[![npm version](https://img.shields.io/npm/v/@steven-y/skkill)](https://www.npmjs.com/package/@steven-y/skkill)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/nagisa-win/skkill/ci.yml?label=ci)](https://github.com/nagisa-win/skkill/actions)

## 概述

**skkill** 是一个面向 AI Agent Skill 的跨平台包管理器。它把分散在多个 Agent (Claude Code / Codex / OpenCode / Cursor / Aider 等) 的 Skill 统一安装到 `~/.skkill/skills/`,再通过软链接一键分发到目标 Agent,做到一处升级、处处生效。

后端默认走 [onetool](https://bj.bcebos.com/onetool/skills-json) (百度内网 Skill 平台) 走 BOS zip 下载,自动兜底 GitHub `skill` 关键字搜索。

主要能力:

- **onetool-first 搜索 / 安装** — 优先查 onetool 注册中心,下载后自动写入 `.skill-meta.json` 记录 skill_id;0 结果自动回退 GitHub
- **骨架 + coding agent 创建** — `init` 生成空 Skill + 内置给 Claude/Codex 的 PROMPT.md,真正内容编辑交给 coding agent
- **本地校验** — frontmatter / 命令安全 / 资源可发现性 / 描述质量全查
- **oneskill 联动发布** — shell out `oneskill create/update` 完成内网发布,自动回写 skill_id
- **跨 Agent 迁移** — `import` 把别处的 skill 目录 mv 到 `~/.skkill/skills/` 并接管管理
- **Git 兜底** — `git@…` URL 或 `owner/repo` 简写自动走 git backend,跨仓库结构都能正确识别 SKILL.md

## 快速上手

### 前置条件

- Node.js >= 20
- git
- (可选) 内网访问 onetool 才能搜到内网 Skill (需要先配置 `backend.onetool.apiBase`)
- (可选) `oneskill` CLI 用于 `publish` 命令

### 安装

```bash
# 正式版 (待发布)
npm install -g @steven-y/skkill

# 或本地开发版
npm install -g .
```

### 初始化

```bash
skkill doctor    # 检查 Node / git / onetool / LLM key 状态 (LLM 仅 publish 用)
```

首次运行会自动在 `~/.skkill/config.yaml` 生成配置模板。查看 / 编辑:

```bash
skkill config path    # 打印配置文件路径
skkill config show    # 查看当前生效值 (含 env 覆盖)
skkill config edit    # 用 $EDITOR 打开
skkill config set backend.onetool.apiBase http://your-onetool-host:port/api/v1
skkill config unset backend.onetool.apiBase
```

#### 配置优先级

> **process.env > config.yaml > hardcoded default**

所有配置项都能通过 `SKKILL_<UPPER_SNAKE>` 环境变量覆盖。例如:

```bash
SKKILL_BACKEND_ONETOOL_API_BASE=http://env-override.example.com/api/v1 \
  skkill config show
```

会看到 `↑ backend.onetool.apiBase = http://...` (来源标记 `↑` 表示 env 覆盖)。

#### 必需配置 (只有发布到内网才需要)

| ConfigKey                 | 环境变量                                                         | 用途                                                      |
| ------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| `backend.onetool.apiBase` | `SKKILL_BACKEND_ONETOOL_API_BASE`                                | onetool 内网 API 地址,留空则自动回退 GitHub               |
| `publisher.bin`           | `SKKILL_PUBLISHER_BIN`                                           | oneskill CLI 路径,默认探测 `~/.oneskill-cli/bin/oneskill` |

其它配置 (GitHub token、LLM model、install root、publisher.minVersion 等) 都有合理默认值。

### 搜索 Skill

```bash
skkill search skill                          # 优先 onetool,0 结果自动回退 GitHub
skkill search llm --backend github           # 只看 GitHub 来源
```

### 安装 + 应用到 Agent

```bash
skkill install skill-recommender -a claude-code codex   # 从 onetool 装
skkill install owner/repo -a claude-code                # 从 GitHub 装
skkill install https://github.com/owner/repo -a claude-code   # 任意 git URL
```

安装路径:`~/.skkill/skills/<name>/`。再用 `apply` 软链接到 Agent:

```bash
skkill apply claude-code    # 也支持 `skkill apply all`
```

### 从其他 Agent 迁移 Skill

如果你在 Claude Code / Codex / OpenCode 等其他 Agent 的 `skills/` 目录下已经有现成的 skill 想纳入 skkill 管理:

```bash
skkill import ~/.claude/skills/dodo-refactor-fe/    # 从 claude-code 接管
skkill import ~/.codex/skills/my-skill --name my-skill -a claude-code   # 重命名 + 直接链接
```

行为:

- **mv 而非 cp** — 源目录会被移到 `~/.skkill/skills/<name>/`,原路径不再可用(避免双份不同步)
- **校验源** — 必须含 `SKILL.md`,否则报错;目标若是真目录则拒绝覆盖,若是 symlink 则替换
- **自动生成 `package.json`** — 缺失时按 frontmatter 兜底补齐
- **写 lock** — 加入 skkill 管理,后续 `validate` / `link` / `uninstall` 都能识别
- **支持 `~/`** — `~` 自动展开为 `$HOME`
- **拒绝套娃** — 源若在 `~/.skkill/skills/` 内会被拒绝(避免从自己管理的目录二次 import)

### 初始化 Skill 骨架

```bash
skkill init my-skill -d "一句话描述用途"
```

会在 `~/.skkill/skills/my-skill/` 生成 SKILL.md / package.json / references/ / scripts/ / assets/ 空骨架,并把完整 **"交给 Claude/Codex 的 prompt 模板"** 写到 stdout 和 `PROMPT.md` — 直接复制粘贴给 coding agent 让它继续填充内容即可。

### 校验 Skill

```bash
skkill validate ~/.skkill/skills/skill-creator            # 已安装的 skill
skkill validate ./my-local-skill --strict                 # 本地目录,strict 模式把 warn 当 error
```

### 发布到 onetool

```bash
# 首次发布
skkill publish my-skill --tags 1,2 --scope workspace

# 更新已发布版本
skkill publish my-skill --update --scope hub -y
```

发布到 `hub` (广场) 会触发安全扫描,CLI 会原样输出平台通知。

## 文档

- [CONTRIBUTING.md](./CONTRIBUTING.md) — 开发规范 / 提 PR 流程
- [CLAUDE.md](./CLAUDE.md) — 项目级 Claude 协作规则

## 贡献指南

欢迎 PR / Issue! 请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解:

- 提交前跑 `npm run typecheck` 和 `npm test`
- 单个 PR 聚焦一件事,标题参考 Conventional Commits (`feat:` / `fix:` / `refactor:` / `docs:`)
- 新增命令必须在 `src/commands/` + `cli.ts` 同时注册
- 新增 backend 必须实现 `SkillBackend` 接口并在 `src/backends/index.ts` 注册
- **禁止在源码中硬编码任何内网地址 / token** — 一律走 `config.yaml` 或 env

## 致谢

本项目遵循 [all-contributors](https://github.com/all-contributors/all-contributors) 规范,贡献者列表由 [`scripts/contributors.ts`](./scripts/contributors.ts) 维护:

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

本项目站在以下开源工作之上:

- [commander.js](https://github.com/tj/commander.js) — CLI 框架
- [simple-git](https://github.com/steveukx/git-js) — git 封装
- [unzipper](https://github.com/ZJONSSON/node-unzipper) — zip 解压
- [gray-matter](https://github.com/jonschlinkert/gray-matter) — frontmatter 解析
- [yaml](https://github.com/eemeli/yaml) — config 文件格式
- [inquirer](https://github.com/SBoudrias/Inquirer.js) / [ora](https://github.com/sindresorhus/ora) / [chalk](https://github.com/chalk/chalk) — 终端 UX
- [execa](https://github.com/sindresorhus/execa) — 子进程

## 许可证书

[MIT](./LICENSE) © 2026 nagisa-win
