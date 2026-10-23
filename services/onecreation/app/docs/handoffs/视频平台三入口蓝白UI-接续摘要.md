# 视频平台三入口蓝白 UI 接续摘要

## 本次成果

将视频平台首页由 5 个可见制作入口收敛为 3 个：`01 AI产品镜`、`02 一键做同款`、`03 AI KOC`。一键换品和单视频批量裂变保留代码、路由、任务进度绑定与权限键，但默认隐藏。首页入口区同步调整为 WIS 中枢蓝白色调，并将入口卡片和文字约放大 20%。

长期入口与视觉规则见 `docs/视频平台首页三制作入口与可见性契约.md`。

## Git 与发布状态

- 仓库：`brand-marketing-workbench-replacement-0808-mainline` 的共享 Git 仓库。
- 隔离工作树：`worktrees/creation-portal-three-entry-blue-ui`。
- 功能分支：`feat/creation-portal-three-entry-blue-ui`。
- 功能提交：`6ccdb6106d0f948747d6d08975efca7d7e652b46`；发布准备提交：`fb8d954c1bec266c775041aa9d1a042cf3327161`。
- 2026-08-31 通过 PR #253 合并到主线，合并提交为 `03b4e7a9b0fe5381f21ece1e2b075904e6e843f4`。
- 生产流水线 #262 已成功完成，目标提交为 `03b4e7a9b0fe5381f21ece1e2b075904e6e843f4`；服务器记录 v2.11.60、158 项发布测试与线上检查全部通过。
- 当前生产应用为 v2.11.60；登录态浏览器已完成首页入口、跳转、蓝白视觉和响应式布局终验。

## 已实现

- 首页计数改为 3，三个公开入口重新编号和排序。
- 隐藏入口使用静态 `hidden + aria-hidden` 兜底，并由 `CREATION_ENTRY_VISIBILITY` 统一控制。
- 每个入口保留稳定的 `data-mode`、业务路由与 `data-permission-key`，便于后续按权限重新开放。
- 首页主色、背景、授权区、资产管理条和制作入口统一为蓝白色调。
- 桌面端三卡并排；卡片高度、标题、说明、编号、图标和操作文字按约 120% 调整。
- 删除一键做同款入口旧有的整行跨列样式；窄屏两列/单列响应式布局保留。

## 验证记录

- 相关专项：`home-direct-creation-entries`、`workflow-v270`、`workflow-v280`、`workbench-v210`、`one-click-remake-v1` 共 36 项通过。
- 桌面端浏览器：`1906×923` 下三个公开入口同排、等宽约 `394px`、等高约 `325px`，标题为 `23px`；保留入口均为 `display:none` 且 `aria-hidden=true`。
- 窄屏浏览器：`390×844` 下三个入口按单列展示，页面文档宽度 `375px`，无横向溢出。
- 浏览器控制台无 error/warning。
- 完整回归：`node --test --test-concurrency=1 --test-reporter=dot app/tests/*.test.js`，`682/682` 通过。
- v2.11.60 发布准备阶段已在 `origin/main@7ebb383` 上重跑：相关专项 `36/36`、完整回归 `682/682` 通过，`git diff --check` 无错误。
- 生产登录态页面显示 `当前版本 v2.11.60`，加载 `styles.css?v=2.11.60-creation-portal-blue-ui` 与 `home.js?v=2.11.60-creation-portal-blue-ui`。
- 生产桌面端 `1280×720` 下三个入口同排、等宽 `381px`、等高 `325px`，标题 `23px`、图标 `55px`；实际点击分别进入 AI 产品镜、一键做同款和 AI KOC 页面。
- 生产窄屏 `390×844` 下三个入口单列显示，文档宽度与滚动宽度均为 `375px`，无横向溢出；一键换品、单视频批量裂变和预留人物入口均保持 `hidden=true`、`aria-hidden=true`、`display:none`。
- 生产页面控制台无 error/warning。流水线同时记录既有 Qwen 共享授权过期与 GPT Image 2 HTTP 401，并按发布脚本的外部故障隔离规则继续；不影响本次首页入口与视觉发布结果。

## 后续维护

1. 如需重新开放一键换品、单视频批量裂变或人物入口，先更新 `CREATION_ENTRY_VISIBILITY`、长期可见性契约和入口测试，再单独走发布流程。
2. Qwen 与 GPT Image 2 的共享授权问题属于发布前已存在的外部运行环境状态，需要在对应授权维护任务中处理。
