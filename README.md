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

当前版本是 Gemma AI 分析演示适配层：

- `gemma_config.js` 保存 Demo 级模型配置和占位说明。
- `gemma_adapter.js` 用于模拟/封装 AI 分析输出。
- 当前代码默认不真实调用 Gemma API。
- 后续可在安全环境中接入真实 Gemma API、本地模型服务或企业内网 AI 服务。

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

当前版本为前端 Demo 适配层，可后续接入 Gemma 4 / Gemini API 或本地模型服务。为了公开参赛仓库安全，当前代码不包含真实 API Key，也不会默认向外部 AI 服务发送生产数据。

## 目录结构

```text
gemma4-repair-dashboard/
├─ data/                         # 脱敏演示数据
├─ icons/                        # 图标资源
├─ libs/                         # 本地离线依赖，例如 xlsx.full.min.js
├─ index.html                    # 参赛 Demo 首页
├─ README.md                     # 项目说明
├─ gemma_config.js               # Gemma Demo 配置
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
