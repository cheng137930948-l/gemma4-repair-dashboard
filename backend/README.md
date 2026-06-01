# Gemma 4 维修看板 · 精简后端 (Demo Backend)

比赛演示用的最小后端。核心只有一条主干：

```
读取 SKILL.md  →  拼接 prompt（Skill 规则 + 看板数据）  →  调用 Gemma 4  →  返回报告
```

前端两个看板默认是 **Demo Mode**（纯前端规则模拟，零配置即可演示）。
本后端是 **可选的加分项**：让评委用自己的 Key 接入真实 Gemma 4 模型复现效果。

## 为什么是 Gemma 4

调用代码用的是 `google-genai` SDK 的纯 prompt 写法：

```python
client = genai.Client(api_key=GOOGLE_API_KEY)
response = client.models.generate_content(model=MODEL_NAME, contents=prompt)
```

没有用到 `system_instruction=` / `tools=` / `response_schema=` 等 Gemini 独占特性，
因此把 `MODEL_NAME` 设为 `gemma-4-31b-it` 即可直接运行，无需改任何代码。

技能（`skills/repair-report/SKILL.md`）以 **Markdown Skill** 的形式定义分析规则，
作为 prompt 文本注入，模型据此生成结构化的维修管理汇报。

## 快速开始

```bash
cd backend
pip install -r requirements.txt

# 配置 Key（.env 已被 .gitignore 忽略，不会上传）
cp .env.example .env
# 编辑 .env，填入在 https://aistudio.google.com/apikey 申请的 GOOGLE_API_KEY

python report_server.py
# -> http://127.0.0.1:8000
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET  | `/api/health`          | 健康检查，返回当前模型 / Key 是否配置 / Skill 是否加载 |
| POST | `/api/generate-report` | 生成维修报告。Body: `{ reportType, scopeLabel, dateRange, data }` |
| POST | `/api/ask`             | 针对当前数据问答。Body: `{ question, data }` |

`reportType` 可选值：`daily / weekly / monthly / yearly / shift / material / overtime / summary`。

## 接入前端

把前端 `gemma_config.js` 中的 `demoMode` 改为 `false`，看板即会请求本后端的真实 Gemma 4 接口。
不改则保持纯前端 Demo Mode，无需后端也能完整演示。

## 安全说明

- 真实 API Key 只存在本地 `.env`，已被 `.gitignore` 排除，不会进入 Git。
- 仓库内提供的是 `.env.example` 占位模板。
- 本后端不含任何公司内部数据源、Webhook 或业务逻辑，仅保留 Gemma 4 报告生成主干。
