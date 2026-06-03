# Gemma 4 维修看板 · 精简后端 (Demo Backend)

比赛演示用的最小后端。核心是一个 **Gemma 4 原生函数调用循环**：

```
注入 SKILL.md + 工具清单  →  Gemma 4 输出 ```tool_code  →  后端解析并真实执行工具
        ↑                                                              │
        └──────────  ```tool_output 回灌，多轮循环  ←──────────────────┘
                                  │ 模型信息足够
                                  ▼
                      产出最终汇报 + trace/运行日志
```

前端三看板默认是 **Demo Mode**（纯前端规则模拟，零配置即可演示），AI 分析统一在首页
「AI 智能分析中心」一个入口。本后端是 **可选的加分项**：让评委用自己的 Key 接入真实
Gemma 4 模型复现效果。

## 文件结构

- `report_server.py`：Flask 路由层（`/api/generate-report`、`/api/ask`、`/api/health`）+ 单轮兜底 + 录制回放缓存。
- `agent.py`：函数调用循环（`build_system_prompt` 注入 / `parse_tool_call` 解析 / `run_agent` 多轮 / 5xx·504 重试 / 时长预算）。
- `tools.py`：后端工具注册表（`get_wip`、`get_defect_detail`、`get_material_*` 等，统一返回 `{summary, data}`）。
- `demo_data.py`：三看板的脱敏演示数据（前端不传 data 时由后端兜底，口径与前端一致，修复率 81%）。
- `warm_cache.py`：录制预热脚本——把三看板各跑一次真实函数调用循环并缓存，供回放模式秒回。
- `skills/repair-report/SKILL.md`：以 Markdown Skill 定义分析规则，注入为 system prompt。

## 在 Gemma 4 上实现函数调用

生产环境中，原系统采用 **Google ADK（Agent Development Kit）** 的 Agent + 工具调用模式：

```python
from google.adk import Agent
from google.adk.tools import skill_toolset

root_agent = Agent(
    model="gemini-2.5-pro",
    tools=[skill_toolset.SkillToolset(skills=[repair_skill])],  # 依赖 API 级 function calling
)
```

**Gemma 4 是开放权重模型，在 Gemini API 上只支持 `generateContent`，不提供 `tools=` 参数与
`system_instruction=`**，无法把 ADK Agent 的 `model` 直接换成 `gemma-4-26b-a4b-it`。

本后端的做法不是放弃函数调用，而是**按 Gemma 4 文档的函数调用约定，在 `agent.py` 里自己实现
一个由模型驱动的多轮函数调用循环**：把工具清单注入 prompt，模型自主输出 ```` ```tool_code
get_wip() ``` ````，后端用 `parse_tool_call` 解析、在 `tools.py` 中真实执行、再以 ```` ```tool_output ````
回灌，循环直至模型给出最终汇报。每一步工具调用都记录在 `trace` 并落盘为 `output/agent_run_*.log`。

这是**模型驱动的多步函数调用**，而非把数据一次性塞进 prompt 的提示工程；同时完全符合 Gemma 4 的接口约束。
若函数调用循环不可用，会自动回退为单轮 `generate_content`，保证演示不中断。

## 快速开始

```bash
cd backend
pip install -r requirements.txt

# 配置 Key（.env 已被 .gitignore 忽略，不会上传）
cp .env.example .env
# 编辑 .env，填入在 https://aistudio.google.com/apikey 申请的 GOOGLE_API_KEY

python report_server.py
# -> http://127.0.0.1:8001  （端口由 .env 的 PORT 决定，默认 8001）
```

> 💡 想一键起【后端+前端】，见仓库根的 `start.sh`（本地）或 `docker compose up`（Docker）。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET  | `/api/health`          | 健康检查，返回模型 / Key / Skill 状态及 `functionCalling`、`maxTurns` |
| POST | `/api/generate-report` | 函数调用循环生成维修报告。Body: `{ reportType, scopeLabel, dateRange, data }`；返回 `{ report, trace, turns, logFile }` |
| POST | `/api/ask`             | 函数调用循环问答。Body: `{ question, data }`；返回 `{ answer, trace, turns }` |

`reportType` 可选值：`daily / weekly / monthly / yearly / shift / material / overtime / summary`。

## 接入前端

把前端 `gemma_config.js` 中的 `demoMode` 改为 `false`，看板即会请求本后端的真实 Gemma 4 接口。
不改则保持纯前端 Demo Mode，无需后端也能完整演示。

## 时延与录制回放（重要）

`gemma-4-26b-a4b-it` 单次推理约 **10–20 秒**，一次多轮函数调用要 3–5 次调用，端到端
通常 **40–95 秒**，接口偶发 5xx/504 重试时更久——这是模型本身的延迟，并非 bug。后端已做：
单次硬超时（`CALL_TIMEOUT_MS`）、5xx/504 退避重试、循环总时长预算（`RUN_BUDGET_SEC`，超时用已取数据强制收尾）。

录制演示对时延敏感，提供 **回放模式**（展示的仍是真实 Gemma 4 跑批结果，只是改为回放、零等待）：

```bash
# 1) 预热：三看板各真实跑一次，结果缓存到 output/cache/<board>_<reportType>.json
python warm_cache.py

# 2) 录制：在 .env 设 REPLAY_ONLY=1 并重启后端，前端点「开始分析」秒回真实缓存
python report_server.py

# 3) 录完：把 REPLAY_ONLY 改回 0，恢复实时调用
```

> 缓存内容（报告 / trace / 运行日志）都是真实的 Gemma 4 函数调用输出；`output/` 已被 `.gitignore`
> 忽略，换机器后用 `warm_cache.py` 重新预热即可。

## 安全说明

- 真实 API Key 只存在本地 `.env`，已被 `.gitignore` 排除，不会进入 Git。
- 仓库内提供的是 `.env.example` 占位模板。
- 本后端不含任何公司内部数据源、Webhook 或业务逻辑，仅保留 Gemma 4 报告生成主干。
