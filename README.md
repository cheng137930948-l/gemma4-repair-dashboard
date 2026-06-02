# Gemma 4 Repair Dashboard Demo

面向工厂维修场景的 AI Repair Dashboard Demo，用于展示维修现场数据可视化、领退料异常预警、协同推送配置预留，以及 Gemma AI 分析适配层在维修流程中的辅助说明能力。

本项目是参赛演示版本，默认使用脱敏演示数据，可通过本地浏览器直接打开，也可部署到 GitHub Pages 作为静态页面演示。

## 核心功能

- 产线维修综合看板：展示出勤、维修趋势、个人产出等综合维修分析视图。
- 领退料异常预警看板：展示维修领料、退料闭环和超时异常预警。
- Demo 数据展示：项目内置脱敏演示数据和页面内演示数据，便于离线演示。
- Teams / 企业微信推送配置预留：页面提供 Webhook 配置入口，Demo 模式下默认只生成预览，不真实发送。
- Forms 闭环链接配置预留：可配置闭环反馈链接，用于演示异常处理闭环。
- Gemma AI 分析演示：通过 `gemma_adapter.js` 模拟/封装 AI 分析输出，展示后续接入 Gemma API 或本地模型服务的集成位置。

## 脱敏声明

- 当前数据为脱敏演示数据，不代表真实生产数据。
- 仓库不包含真实 Webhook。
- 仓库不包含真实 Cookie。
- 仓库不包含真实账号密码。
- 仓库不包含真实客户敏感数据。
- 请勿在公开仓库中提交真实 API Key、Token、Webhook、Cookie、人员隐私或生产接口地址。

## Gemma 说明

本项目提供两种运行方式：

**1. 前端 Demo 模式（默认）**

- `gemma_config.js` 保存模型配置（`modelId: gemma-4-31b-it`）和 `demoMode` 开关，默认 `demoMode: true`。
- `gemma_adapter.js` 用于模拟/封装 AI 分析输出，离线即可演示。
- Demo 模式下不真实调用任何外部 AI 服务，不发送生产数据。

**2. 真实 Gemma 4 后端模式（可选）**

- `backend/` 提供一个精简的 Flask 后端，通过 `google-genai` SDK 真实调用 **Gemma 4（`gemma-4-31b-it`）**。
- 后端将 `backend/skills/repair-report/SKILL.md` 注入为分析 Prompt，生成日报 / 周报 / 异常预警等管理汇报。
- 在 `backend/.env`（参考 `backend/.env.example`）填入自己的 `GOOGLE_API_KEY` 后即可启用，密钥不会进入仓库。
- 将 `gemma_config.js` 中的 `demoMode` 改为 `false`，前端即对接本地后端 `http://127.0.0.1:8000`。
- 详细启动步骤见 `backend/README.md`。

## 如何运行

### 本地运行

1. 下载或克隆本仓库。
2. 双击打开根目录下的 `index.html`。
3. 在首页点击两个核心入口进入看板。

### GitHub Pages 运行

1. 将本仓库推送到 GitHub。
2. 在仓库 `Settings` → `Pages` 中选择部署分支，例如 `main` / root。
3. 等待 GitHub Pages 构建完成。
4. 打开 Pages 首页的 `index.html`。
5. 点击首页中的两个核心看板入口。

如果 GitHub Pages 中文路径打不开，请确认链接和文件名完全一致。

## 当前 Gemma 4 集成状态

仓库已包含一个可真实调用 **Gemma 4（`gemma-4-31b-it`）** 的精简后端（见 `backend/`），默认前端仍以 Demo 模式离线演示。为了公开参赛仓库安全，仓库不包含真实 API Key（使用 `.env.example` 占位），也不会默认向外部 AI 服务发送生产数据；启用真实后端需自行在本地 `.env` 配置 `GOOGLE_API_KEY`。

## 目录结构

```text
gemma4-repair-dashboard/
├─ backend/                      # 真实 Gemma 4 后端（可选）
│  ├─ report_server.py           # Flask 服务，调用 gemma-4-31b-it
│  ├─ requirements.txt           # 后端依赖
│  ├─ .env.example               # API Key 占位（自行复制为 .env）
│  ├─ README.md                  # 后端启动说明
│  └─ skills/repair-report/SKILL.md  # 注入为分析 Prompt 的汇报技能
├─ data/                         # 脱敏演示数据
├─ icons/                        # 图标资源
├─ libs/                         # 本地离线依赖，例如 xlsx.full.min.js
├─ index.html                    # 参赛 Demo 首页
├─ README.md                     # 项目说明
├─ gemma_config.js               # Gemma 模型配置（gemma-4-31b-it / demoMode）
├─ gemma_adapter.js              # Gemma AI 分析演示适配层
├─ material_dashboard.js         # 领退料看板脚本
├─ 产线维修综合看板_v3.html       # 产线维修综合看板
└─ 产线维修课领退料看板.html       # 产线维修领退料看板
```

## 常见问题

### 本地双击可以运行吗？

可以。项目是静态 Demo，直接打开 `index.html` 即可进入首页。

### Excel 导出依赖在哪里？

Excel 导出依赖 `libs/xlsx.full.min.js`。请保留 `libs/` 目录，不要把路径改成 `lib/`。

### 为什么 Demo 模式下没有真实推送？

为了参赛演示安全，默认 `Demo 模式` 只生成推送内容预览，不向真实 Webhook 发送消息。

当前参赛版本的推送预览会按责任人汇总脱敏异常项，展示单号、工单、料号、站别和超时状态，便于现场说明维修闭环协同方式。关闭 `Demo 模式` 并在本地浏览器中配置 Teams / 企业微信 Webhook 后，可用于联调真实推送；请不要把真实 Webhook、账号或生产数据提交到公开仓库。

### 如果 GitHub Pages 中文路径打不开怎么办？

请检查 `index.html` 中的链接是否与仓库中的真实中文文件名完全一致，包括“领退料”三个字。

## 验收建议

- 本地双击 `index.html` 能打开首页。
- 首页两个入口都能正常跳转。
- 综合看板和领退料看板能正常打开。
- 系统设置能打开、关闭、保存并刷新恢复。
- 控制台不出现 `SyntaxError`、`XLSX is not defined`、`toast is not defined`、`state is not defined`。
