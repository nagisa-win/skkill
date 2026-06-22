# 贡献指南

感谢对 skkill 感兴趣! 本文说明提 PR / 提 Issue / 本地开发的规范。

## 开发环境

- Node.js >= 20
- npm >= 10
- git

## 本地开发

```bash
git clone git@github.com:nagisa-win/skkill.git
cd skkill
npm install

# 类型检查
npm run typecheck

# 跑测试
npm test

# 跑单个测试
npx vitest run src/lib/skill-rules.test.ts

# 开发模式: 直接跑 tsx,不编译
npm run dev -- search skill

# 产出 dist
npm run build
```

## 仓库结构

```
src/
├── bin/              CLI 入口
├── commands/         每个 CLI 子命令一个文件
├── backends/         Skill 来源: onetool / github / git
├── lib/              业务逻辑
│   ├── llm/          Anthropic / OpenAI provider
│   ├── skill-rules.ts  本地校验规则
│   ├── installer.ts  通用安装流
│   ├── publisher.ts  oneskill 联动
│   └── searcher.ts   链式搜索
├── agents/           Agent adapter (claude-code / codex / opencode)
├── types/            公共类型
├── utils/            工具函数
└── constants.ts
```

## 提 PR 流程

1. 从 `main` 拉分支:`git checkout -b feat/xxx`
2. 提交前确认:
    - `npm run typecheck` 零错
    - `npm test` 全绿
    - 新功能对应测试已加(`*.test.ts` 与源文件同目录)
3. 标题用 [Conventional Commits](https://www.conventionalcommits.org/):`feat: ...` / `fix: ...` / `refactor: ...` / `docs: ...` / `chore: ...`
4. PR 描述说明:
    - 改动的 Why(背景 / 触发问题)
    - 改动的 What(关键文件 + 行号)
    - 如何验证(命令 + 期望输出)
5. 一个 PR 聚焦一件事,不要把多个不相关改动混在一起

## 提 Issue

- **Bug**: 复现命令 + 实际输出 + 期望输出 + 环境 (`skkill doctor` 输出)
- **Feature**: 描述使用场景,而不只是解决方案
- **Question**: 先在 README / `skkill --help` 找答案,找不到再开

## 新增 CLI 命令

1. 在 `src/commands/<name>.ts` 实现函数,导出 `xxxCommand(args, opts)`
2. 在 `cli.ts` 用 `program.command(...).action(...)` 注册
3. 命令名与子目录名保持一致
4. 错误统一抛 `SkitError(code, message)`,code 取自 `SkitErrorCode`
5. 用 `logger.info / warn / error / success` 输出,不要 `console.log`

## 新增 Backend (Skill 来源)

1. `src/backends/<name>.ts` 实现 `SkillBackend` 接口 (来自 `src/types/backend.ts`)
2. `src/backends/index.ts` 注册:`BACKENDS[<id>] = new XxxBackend()`
3. `src/types/backend.ts` 把 `<id>` 加到 `BackendId` 联合
4. 至少覆盖 `search / resolve / fetch / upgrade` 四个方法
5. `src/lib/searcher.ts` 如果要纳入默认链,加入 chain 数组

## 新增 Agent Adapter

1. `src/agents/<id>.ts` 实现 `AgentAdapter` 接口
2. 在 `src/agents/index.ts` `registerAgent()` 注册
3. 至少提供 `id / displayName / detect() / applyTo(skill)`

## Coding Style

- TypeScript strict, target ES2022, module NodeNext
- 不引入新依赖除非必要,提 PR 时说明理由
- 函数优先纯函数,副作用集中到 `commands/` 和 `lib/installer.ts`
- 单文件 < 300 行,超了拆
- 不写无意义注释(只解释 Why,不重复 What)
- 命名:`xxxCommand` (命令) / `xxxBackend` / `xxxProvider` / `xxxAdapter` (agent)

## Release 流程

(待第一次 release 时补全)

- bump version: `npm version <major|minor|patch>`
- tag: `git tag v<x.y.z>`
- push tag 触发 release workflow
- 写 release notes 列出本次变更

## License

提交 PR 即同意按 MIT 协议贡献。
