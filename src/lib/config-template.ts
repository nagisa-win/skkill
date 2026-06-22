// ~/.skkill/config.yaml 模板生成器
// YAML 原生支持 # 注释,不需要 strip
// 字段命名与 ConfigKey 一致 (env 变量 = SKKILL_<KEY 大写>)

export const CONFIG_FILE_NAME = 'config.yaml';
export const CONFIG_BASENAME_NO_EXT = 'config';

const TEMPLATE = `# ============================================================
# skkill 配置文件
# 修改后无需重启,下次 skkill 命令自动 reload
# 任何字段都可通过 process.env 覆盖 (优先级: env > 此文件 > 硬编码默认)
# 文件不存在时 skkill 会用全部默认值,功能部分可用 (search fallback github / install 走 git)
# ============================================================

# 配置文件 schema 版本;当前固定 1,不要改
version: 1

# ---- 安装目录 ----
# 装好的 skill 放哪里;默认 ~/.skkill/skills
# installRoot: ~/.skkill/skills

# ---- Backend ----
# search / install / upgrade 的数据来源
# 留空 / 不填时自动链式 fallback: onetool → github → git
backend:
  # 当前默认 backend;可选: onetool | github | git | npx-skill
  provider: onetool

  # onetool 内网 API 地址 (从内网文档获取)
  # 不填时: search 跳过 onetool 直接走 github, install 走 git, create 不受影响
  # 也可通过 SKKILL_BACKEND_ONETOOL_API_BASE 环境变量覆盖
  onetool:
    # apiBase: 请填内网 API 地址,如 http://10.x.x.x:xxxx/api/v1

  # GitHub search 兜底 (无需 token, 限速 60/h;有 token 提到 5000/h)
  github:
    # token: ghp_xxx

  # npx-skill 兼容 (DEPRECATED,不推荐)
  npxSkill:
    # bin: npx --yes skill
    # baseUrl: https://skills.sh/api

# ---- LLM (create / publish 描述生成用) ----
# 不填也能用 search / install / validate;只是 create 不可用
llm:
  # anthropic | openai
  provider: anthropic

  # API key;不填时也支持 ANTHROPIC_API_KEY / OPENAI_API_KEY 环境变量
  # apiKey: sk-ant-xxx

  # 模型名;留空用 provider 默认
  # model: claude-sonnet-4-6

  # 自定义 API 端点 (用于自部署 / 内网代理 / 国产 LLM 网关)
  # 留空走 SDK 默认: anthropic → https://api.anthropic.com
  #                    openai    → https://api.openai.com/v1
  # 例: openai 兼容网关 → https://your-gateway.example.com/v1
  #     anthropic 代理 → https://your-proxy.example.com
  # baseUrl: https://your-gateway.example.com/v1

# ---- Publisher (publish 到 onetool 用) ----
# 不填也能用其它命令;publish 时缺 oneskill 会提示安装
publisher:
  # 可执行文件路径;留空自动探测 PATH / ~/.oneskill-cli/bin/oneskill
  # bin: oneskill

  # 平台要求最低版本
  # minVersion: "1.0.1"

# ---- Agent adapter (可选) ----
# agents:
#   claudecode:
#     skillsDirOverride: ~/my-claude-skills
#   codex:
#     enabled: true
`;

export function buildConfigTemplate(): string {
    return TEMPLATE;
}
