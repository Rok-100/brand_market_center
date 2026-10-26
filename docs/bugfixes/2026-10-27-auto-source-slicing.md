# Bugfix：自动混剪补源续跑与本地上传接入

- 日期：2026-10-27
- 分支：`codex/bugfix-auto-source-slicing`
- 目标分支：`main`
- 模块：二创工作台自动混剪

## 问题与影响

自动混剪计划在现有切片缺少框架角色、目标时长或未重复开头时，没有进入完整选源和切片流程。页面的选源、切片等阶段可能显示“已完成”，实际处理数量为 `0/0`，随后混剪停在等待补源状态。

即使二创本地已经上传视频，原来的普通补源流程也只查询云管家源视频接口。云端候选为空时，本地上传视频没有参与候选选择，页面用“没有发现新的合规源视频”描述结果，容易被理解为素材审核不通过。

切片总数不等于可生成数量。例如固定框架需要“钩子 → 痛点 → 产品方案 → 证明 → 行动”，缺少其中角色、完整时长或可用开头，仍然不能形成有效组合。

## 根因

1. `autoApproveOutputs` 基础质检分支只检查已有切片，并将前置阶段统一标为完成；调度没有在真实库存不足时继续调用完整前置生产流程。
2. 普通自动选源没有接入 `manual_upload` 本地来源。
3. 旧等待状态的迁移与新来源准备的退避重试混在一起，可能重复唤醒任务或覆盖已有准备回执。

## 修复后的行为

### 库存优先与原批次续跑

- 先检查已有切片能否满足本批角色、时长和不同开头要求。
- 库存充足时直接复用，不重复选源、拆解。
- 库存不足时执行选源、来源准备、切点校准和切片审核。
- 修复旧基础质检分支写入的空完成回执，同时保留真实选源和处理记录。
- 普通库存缺口进入 `awaiting_sources` 并安排后续重试；有限历史来源仍保留原有来源边界和退避规则。
- 原批次继续处理，保留已完成结果；暂停或权限变化不会被后续回调自动恢复。

### 本地上传接入

- 本地上传优先，云端候选补足剩余额度，两者共用本批选源数量上限。
- 根据任务所有人的读取权限、目标产品或通用素材品类、文件存在性、有效时长及风险标签筛选。
- 不将私人来源加入团队自动混剪，也不跨产品拼接。
- 对已有内容哈希或存储文件标识去重。
- 已就绪的拆解结果直接复用；尚未拆解的来源进入既有分析流程。
- 按来源快照保存本批处理记录；未变化且已完成的本地来源不会重复准备，失败来源按退避规则重试。
- 校准产生的注释更新不会单独导致同一来源重新处理。

### 回执与提示

- 选源摘要分别显示本地上传和素材中心的选择数量。
- 来源准备进度增加本地来源标签及其通过、待处理和失败计数。
- 本地来源存在但准备失败时保留具体失败原因；退避期间没有新操作，也不会把先前失败覆盖成空完成结果。
- 来源准备完成不等于切片审核通过，更不等于已经生成合格成片。

## 文件范围

| 文件 | 用途 |
| --- | --- |
| `services/remix/app/render-worker/clip-remix-service.mjs` | 补源调度、本地候选、拆解复用、退避记录及回执 |
| `services/remix/app/render-worker/source-preparation-progress.mjs` | 本地来源进度与去重统计 |
| `services/remix/app/render-worker/scripts/actual-service-basic-source-shortfall.test.mjs` | 新增库存缺口及本地上传回归测试 |
| `services/remix/app/render-worker/scripts/actual-service-on-demand-source.test.mjs` | 显式驱动测试中被拦截的周期调度，避免假超时 |

## 验证

2026-10-27 提交前重新运行以下三组测试，共 **21 项通过，0 项失败**：

- `actual-service-basic-source-shortfall.test.mjs`
- `actual-service-on-demand-source.test.mjs`
- `actual-service-duration-feasibility.test.mjs`

覆盖库存充分与不足、旧空回执续跑、本地无云配置选源、已有拆解复用、共享批次上限、去重、权限与品类过滤、缺失文件、分析回退不自动批准、凭证校验、失败回执保留、历史来源有限准备及暂停回调。

测试使用隔离临时目录、合成素材和接口替身，不调用真实 AI、投放或生产素材服务。已有本地镜像包含依赖时，可从仓库根目录在 PowerShell 执行：

```powershell
docker run --rm -v "${PWD}/services/remix/app:/test-src:ro" brand-market-delivery/remix:local sh -c 'cp -r /test-src /tmp/test-app && ln -s /app/render-worker/node_modules /tmp/test-app/render-worker/node_modules && node --test /tmp/test-app/render-worker/scripts/actual-service-basic-source-shortfall.test.mjs /tmp/test-app/render-worker/scripts/actual-service-on-demand-source.test.mjs /tmp/test-app/render-worker/scripts/actual-service-duration-feasibility.test.mjs'
```

另外执行了 Node 语法检查和 `git diff --check`。本地二创镜像已重建并部署，实际回执确认三条本地上传视频能够被选择；后续测试品类任务也已进入切片校准与审核阶段。该验证不代表完整成片链路已无阻塞。

## 保留的约束

- 当前黑晶面膜来源仍需通过既有产品版本或历史来源凭证校验。本次没有取消、伪造或自动补写凭证。
- 普通本地测试应使用匹配的测试品类；任务目标、源视频和需要复用的切片品类应一致。
- 所有来源仍需通过后续边界、音轨、时长及角色等检查；候选入选不保证生成成片。
- 本次没有提交 `.env`、`.local/`、真实素材、数据库、个人配置或实际凭据，也没有修改前端运行产物、开启真实投放或删除数据卷。

## 已知独立问题：并发保存冲突（本次未修复）

接通选源后，本地任务曾在切片审核阶段出现 `Document changed during transaction`。存储层在提交时发现文档版本已变化，拒绝覆盖；当前任务缺少相应的冲突恢复，页面还可能将其笼统显示为“外部权限或配置”问题。

这不是素材数量不足，也不是产品版本凭证错误。确切并发写入方及是否与本次变更存在因果关系尚未通过独立复现确认。

后续应单独处理存储并发控制、安全重试、幂等和原批次进度恢复，并更正错误分类。验收应覆盖多个审核回调或任务同时更新素材库时，不覆盖新数据、不重复生成或批准，并且用户暂停仍然有效。**本 PR 不声称解决该冲突，也不保证当前任务可以完成全部混剪流程。**
