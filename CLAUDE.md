# CLAUDE.md

> 本项目协作给 Claude / 猫娘编码助理时,优先遵守的规则。
> 全局规则见 `~/.claude/CLAUDE.md` (opop 猫娘人设 + 编码原则),本文件做项目级具体化。

## 项目速览

- **skkill** — AI Agent Skill 包管理器,onetool-first, GitHub 兜底
- **包名**: `@steven-y/skkill` (发布到 npmjs)
- **运行时**: Node.js >= 20, ESM, TypeScript strict
- **入口**: `cli.ts` (根) → `src/commands/` 拆分命令
- **架构核心**:
    - `src/backends/` — onetool / github / git (实现 `SkillBackend`)
    - `src/lib/` — installer / publisher / searcher / skill-rules / config
    - `src/agents/` — claude-code / codex / opencode / cursor / aider adapter
- **发布**: 合 main 后 CI 自动读 `package.json` version 打 tag + `npm publish` (NPM_TOKEN env)

## 关键约束

- **不动 git 写操作**: 禁止主动 `git add` / `git commit` / `git push` / `git reset`,节奏由主人决定
- **不造轮子**: 优先复用 `src/lib/` 已有工具,新增前先 grep
- **命名规范**: 命令 `xxxCommand`、backend `xxxBackend`、provider `xxxProvider`、agent adapter `xxxAdapter`
- **目录整洁**: 主目录只放 `bin/` `cli.ts` `dist/` `src/`,其它按语义拆子目录
- **单文件 < 300 行**, 超了拆
- **注释只解释 Why**, 命名好的代码不需要 What 注释
- **错误统一抛 `SkitError(code, message)`**, code 取自 `SkitErrorCode` 联合
- **🚫 禁止源码硬编码任何内网地址 / token / 私密域名**:
    - 需要用户配置 → 走 `config.yaml` (`configKeyToEnv` 映射 env 变量)
    - 公开 CDN / 默认端口 / 默认命令 → 走 `constants.ts`
    - 哪怕 `// 兜底`,也只放占位值,不放真实内网 URL

## 配置体系 (重要)

**配置文件**: `~/.skkill/config.yaml` (YAML 格式,首次运行自动生成)

**优先级链**: `process.env > config.yaml > hardcoded default`

**添加新配置项**:

1. 在 `src/constants.ts` 的 `ConfigKey` 加一条 (kebab-case 点分,如 `backend.foo.bar`)
2. `configKeyToEnv()` 会自动生成 `SKKILL_<UPPER_SNAKE>` 形式 env 名 (camelCase 边界自动拆下划线)
3. 在 `src/lib/config-template.ts` 写注释模板 (默认值 + 说明)
4. 读取用 `getConfigValue(ConfigKey.X, config)`,会自动从 env/config 选优

**`config` 命令**: `init` / `show` / `path` / `edit` / `set <key> <value>` / `unset <key>`

## 常用命令

```bash
npm run typecheck   # tsc --noEmit, 提交前必跑
npm test            # vitest run
npm run dev -- <args>   # tsx 直接跑 src/
npm run build       # tsc 产出 dist/
node dist/bin/skkill.js <args>   # 测编译后版本
skkill doctor       # 环境自检
skkill config show  # 看所有有效配置 (含 env 覆盖)
```

## Backend 添加流程

1. `src/backends/<id>.ts` 实现 `SkillBackend` (来自 `src/types/backend.ts`)
2. `src/backends/index.ts` 注册到 `BACKENDS` map
3. `src/types/backend.ts` 把 `<id>` 加到 `BackendId` 联合
4. 覆盖 `search / resolve / fetch / upgrade` 四个方法
5. 纳入默认链需改 `src/lib/searcher.ts` 的 chain 数组
6. **后端需要的私密配置** (URL / token) → 加 `ConfigKey` 条目,不要硬编码

## 命令添加流程

1. `src/commands/<name>.ts` 导出 `xxxCommand(args, opts)`
2. `cli.ts` 用 `program.command(...).action(...)` 注册
3. 选项默认值走 commander 的 `option(name, desc, defaultValue)`
4. 错误码用 `SkitErrorCode` 联合,新增 code 需先在 `src/utils/logger.ts` 联合里加

## 测试与校验

- 单测与源文件同目录 `*.test.ts`, 用 vitest
- E2E 验证命令 (Phase 完成后跑):
    - `skkill doctor` 全部 ✔ (onetool 未配置不算红 X,显式标 "未配置")
    - `skkill search skill` ≥ 1 结果
    - `skkill install <owner/repo>` 装到 `~/.skkill/skills/<name>/`, 含 SKILL.md
    - `skkill validate <path>` 0 error
    - 合成 bad skill: `skkill validate <bad> --strict` exit 1

## 发布流程 (主人的)

- 升级版本: 手动改 `package.json` 的 `version` 字段, commit 到 main
- CI: `.github/workflows/release.yml` 检测 version 变化 → 打 `v<x.y.z>` tag → `npm publish`
- 凭据: `NPM_TOKEN` (npmjs.com Automation token) 配在 GitHub repo Settings → Secrets
- 首次发布: 包名 `@steven-y/skkill` 需先在 npmjs.com 创建 organization `@steven-y` 并授权 publish

## 修改前先读

进 `src/<dir>/` 工作前,先 `ls` 目录看现有结构,再 grep 关键字看是否已有实践,不要凭印象造新文件。

改 backend 时:**先看现有的 `findSkillDir` (BFS)** 是否能复用,不要重新发明 `entries[0]` 这种 hack。
