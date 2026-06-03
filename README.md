# Gemma 4 Repair Dashboard Demo

面向工厂产线维修场景的 **AI Agent 维修数据看板**，用于展示维修现场数据可视化、修复率/WIP 数字孪生监控、领退料异常预警、协同推送配置预留，以及 **Gemma 4 + Skill 分析适配层** 在维修流程中的辅助决策能力。

本项目是参赛演示版本，默认使用脱敏演示数据，可通过本地浏览器直接打开，也可部署到 GitHub Pages 作为静态页面在线演示。

> 🔗 在线演示（GitHub Pages）：`https://cheng137930948-l.github.io/gemma4-repair-dashboard/`
> （部署后请实测三个中文文件名页面均可打开；若 Pages 对中文路径异常，见文末"常见问题"。）

## 核心功能

- **产线维修综合看板**：出勤、维修趋势、个人产出等综合分析视图，并由 Gemma 适配层自动生成 WIP / 修复率管理汇报。
- **维修修复率看板**：面向 WIP 与不良分析的修复率监控，聚焦待修积压、超期工单预警、不良 TOP 缺陷、原因分布与各组修复率排行，驱动闭环改善。
- **领退料异常预警看板**：维修领料、退料闭环与超时异常预警，确保备件闭环管理。
- **Demo 数据展示**：内置脱敏演示数据与页面内演示数据，离线即可完整演示。
- **Gemma AI 分析演示**：`gemma_adapter.js` 以 tool-registry + planner + trace 的方式模拟智能体多步推理，并预留真实 Gemma 4 后端的接入位置。
- **Teams / 企业微信推送配置预留**：页面提供 Webhook 配置入口，Demo 模式下默认只生成预览，不真实发送。
- **Forms 闭环链接配置预留**：可配置闭环反馈链接，用于演示异常处理闭环。

## 脱敏声明

- 当前数据为脱敏演示数据，不代表真实生产数据。
- 仓库不包含真实 Webhook、Cookie、账号密码、客户敏感数据或内部接口地址。
- 真实 API Key 仅存于本地 `backend/.env`（已被 `.gitignore` 排除），仓库仅提供 `.env.example` 占位。
- 请勿在公开仓库中提交真实 API Key、Token、Webhook、Cookie、人员隐私或生产接口地址。

## Gemma 说明

本项目提供两种运行方式：

**1. 前端 Demo 模式（默认）**

- `gemma_config.js` 保存模型配置（`modelId: gemma-4-26b-a4b-it`）与 `demoMode` 开关，默认 `demoMode: true`。
- `gemma_adapter.js` 用于模拟/封装 AI 分析输出，离线即可演示智能体推理链路（planner / 工具调用 / trace）。
- Demo 模式下不真实调用任何外部 AI 服务，不发送生产数据。

**2. 真实 Gemma 4 后端模式（可选 / 加分项）**

- `backend/` 提供一个精简 Flask 后端，通过 `google-genai` SDK 真实调用 **Gemma 4（`gemma-4-26b-a4b-it`）**。
- 后端实现了 **Gemma 4 原生函数调用循环**（`backend/agent.py` + `backend/tools.py`）：把 `SKILL.md` 与工具清单注入 prompt，由模型自主输出 ```` ```tool_code ````、后端真实执行 Python 工具并以 ```` ```tool_output ```` 回灌，多轮循环直至生成最终汇报；每一步工具调用都记录在 `trace` 并落盘为 `backend/output/agent_run_*.log` 运行日志。
- 在 `backend/.env`（参考 `backend/.env.example`）填入自己的 `GOOGLE_API_KEY` 后即可启用，密钥不会进入仓库。
- 首页「**AI 智能分析中心**」会直接请求本地后端 `http://127.0.0.1:8001`（与 `backend/.env` 的 `PORT` 一致），**无需改任何开关**即可出真实 Gemma 4 报告；各看板页面内嵌的离线模拟由 `gemma_config.js` 的 `demoMode` 控制（默认 `true`）。
- 一键启动见下方「如何运行 → 一键启动」；详细后端说明见 `backend/README.md`。

## 如何运行

### 一键启动（真实 Gemma 4，推荐）

同时拉起【后端 `:8001` + 前端 `:8123`】，打开页面点「开始分析」即走真实 Gemma 4 原生函数调用循环。

**方式 A · 本地脚本**（自动建 venv、装依赖、起前后端）：

```bash
./start.sh
# 首次会生成 backend/.env —— 填入 GOOGLE_API_KEY（https://aistudio.google.com/apikey）后重跑
# 启动后打开 http://127.0.0.1:8123/index.html
```

**方式 B · Docker**（一条命令）：

```bash
GOOGLE_API_KEY=你的Key docker compose up
# 或在本目录建 .env 写 GOOGLE_API_KEY=...，再 docker compose up
# 启动后打开 http://127.0.0.1:8123/index.html
```

> 时延提示：单次真实报告约 40–95s（模型多轮取数推理）。若要现场零等待，先 `cd backend && python warm_cache.py` 预热，再在 `backend/.env` 设 `REPLAY_ONLY=1` 重启后端，即可秒回真实跑批缓存。详见 `backend/README.md`。

### 本地运行（纯前端离线，零配置）

1. 下载或克隆本仓库。
2. 双击打开根目录下的 `index.html`（或 `python -m http.server 8123` 后访问 `http://127.0.0.1:8123/index.html`）。
3. 在首页点击三个核心入口分别进入综合看板、领退料看板、修复率看板。（此模式 AI 为离线模拟；要真实 Gemma 4 用上面的「一键启动」。）

> 若使用 Excel 导入/导出等需要相对路径加载本地依赖的功能，建议用静态服务器打开，例如：
> `python -m http.server 8123` 后访问 `http://127.0.0.1:8123/index.html`。

### GitHub Pages 运行

1. 将本仓库推送到 GitHub。
2. 在仓库 `Settings` → `Pages` 中选择部署分支，例如 `main` / root。
3. 等待 GitHub Pages 构建完成。
4. 打开 Pages 首页的 `index.html`，点击三个核心看板入口。

如果 GitHub Pages 中文路径打不开，请确认链接和文件名完全一致（包含"领退料""修复率"等中文字符）。

## 当前 Gemma 4 集成状态

仓库已包含一个可真实调用 **Gemma 4（`gemma-4-26b-a4b-it`）** 的精简后端（见 `backend/`），并在后端实现了 **Gemma 4 原生函数调用循环**（模型自主调用 `get_wip` 等工具、后端真实执行并回灌、多轮推理后产出汇报，附运行日志）。默认前端仍以 Demo 模式离线演示。为了公开参赛仓库安全，仓库不包含真实 API Key（使用 `.env.example` 占位），也不会默认向外部 AI 服务发送生产数据；启用真实后端需自行在本地 `.env` 配置 `GOOGLE_API_KEY`。

## 目录结构

```text
gemma4-repair-dashboard/
├─ backend/                       # 真实 Gemma 4 后端（可选）
│  ├─ report_server.py            # Flask 服务，路由 + 单轮兜底 + 录制回放缓存
│  ├─ agent.py                    # Gemma 4 原生函数调用循环（解析/执行/回灌/trace/重试/时长预算）
│  ├─ tools.py                    # 后端工具注册表（get_wip 等，返回 {summary,data}）
│  ├─ demo_data.py                # 三看板脱敏演示数据（后端兜底，口径与前端一致）
│  ├─ warm_cache.py               # 录制预热：三看板各真跑一次并缓存，供回放模式秒回
│  ├─ requirements.txt            # 后端依赖
│  ├─ .env.example                # API Key 占位 + 模型/超时/回放等配置说明
│  ├─ README.md                   # 后端启动说明（含时延与录制回放）
│  └─ skills/repair-report/SKILL.md  # 注入为分析 Prompt 的汇报技能
├─ data/demo/                     # 脱敏演示数据（integrated / material）
├─ icons/                         # 图标资源
├─ libs/                          # 本地离线依赖，例如 xlsx.full.min.js
├─ index.html                     # 参赛 Demo 首页（三看板入口）
├─ README.md                      # 项目说明
├─ gemma_config.js                # Gemma 模型配置（gemma-4-26b-a4b-it / demoMode）
├─ gemma_adapter.js               # Gemma AI 分析适配层（planner / 工具 / trace）
├─ material_dashboard.js          # 领退料看板脚本
├─ 产线维修综合看板_v3.html         # 产线维修综合看板
├─ 产线维修课领退料看板.html         # 产线维修领退料看板
└─ 修复率看板.html                  # 维修修复率看板
```

## 常见问题

### 本地双击可以运行吗？

可以。项目是静态 Demo，直接打开 `index.html` 即可进入首页（Excel 导入/导出建议用静态服务器打开）。

### Excel 导出依赖在哪里？

Excel 导出依赖 `libs/xlsx.full.min.js`。请保留 `libs/` 目录，不要把路径改成 `lib/`。

### 为什么 Demo 模式下没有真实推送？

为了参赛演示安全，默认 `Demo 模式` 只生成推送内容预览，不向真实 Webhook 发送消息。推送预览会按责任人汇总脱敏异常项，展示单号、工单、料号、站别与超时状态，便于现场说明维修闭环协同方式。关闭 `Demo 模式` 并在本地浏览器配置 Teams / 企业微信 Webhook 后，可用于联调真实推送；请不要把真实 Webhook、账号或生产数据提交到公开仓库。

### 如果 GitHub Pages 中文路径打不开怎么办？

请检查 `index.html` 中的链接是否与仓库中的真实中文文件名完全一致，包含"领退料""修复率"等中文字符。

## 验收建议

- 本地双击 `index.html` 能打开首页。
- 首页三个入口（综合 / 领退料 / 修复率）都能正常跳转。
- 三个看板均能正常打开，设置面板能开关、保存并刷新恢复。
- 修复率看板自动加载 57 行脱敏演示数据，图表（修复率排行 / 进出板 / 不良 TOP5 / 原因分布）完整渲染。
- 综合看板 AI 分析能输出 WIP 与修复率结论（与修复率看板口径一致，约 81%）。
- 控制台不出现 `SyntaxError`、`XLSX is not defined`、`toast is not defined`、`state is not defined`，无失败网络请求。
