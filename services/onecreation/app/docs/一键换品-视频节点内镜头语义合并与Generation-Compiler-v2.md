# 一键换品：视频节点内镜头语义合并与 Generation Compiler v2

状态：本阶段开发基准
日期：2026-08-21
阶段分支：`feat/video-node-semantic-merge-v2`
主线基线：`origin/main@609a954`（仓库版本 `2.11.22`）

## 1. 文档目的与统一口径

本文定义“一键换品”视频节点内镜头语义合并的本阶段开发范围、数据契约、前后端行为、迁移策略和验收标准。开发必须以本文为准；如实现需要扩大范围，应先修改本文，再修改代码。

统一术语如下：

- `sourceShot`：Qwen 从参考视频提取的原始事实单元。它记录原片硬切、人物、场景、动作、产品状态和证据，不因用户操作而删除、合并或改写。
- 视频节点内镜头语义合并：同一个最终 Video Node 内，用户判断相邻两个或多个 `sourceShot` 属于同一连续生成意图，并选择“与上一个镜头共用关键帧”后，系统在规划层建立新的连续生成单元。
- “与上一个镜头共用关键帧”是用户唯一需要理解的操作；它不是单纯把后一镜头指向前一张图片，而是触发规划层和执行层重新编译。
- 原片镜头边界仍作为事实与 QA 证据保留。语义合并不等于删除硬切，也不等于把多个原片视频拼成一个视频节点。

## 2. 基线核对结论

### 2.1 仓库与版本

- 仓库未提供根目录或子目录 `AGENTS.md`。
- 开发分支从最新 `origin/main@609a954` 创建；原本地 `main` 落后远端且有用户未提交的 `README.md` 修改，本阶段使用独立 worktree，未触碰该修改。
- `app/package.json` 和主线 `README.md` 声明版本为 `2.11.22`。
- `docs/handoffs/AI-KOC-接续摘要.md` 记录 v2.11.22 发布流水线 `#202` 成功，并已通过企业登录中心确认新版本在线。
- 本次会话匿名请求线上 `/api/app-meta` 返回 401，应用内浏览器也停在登录页，因此本次没有以当前登录态再次读取运行时版本。本文把“最新有发布证据的线上版本”记为 v2.11.22，不把当前会话无法登录误写为线上未发布。

### 2.2 当前实现

当前实现已经具备：

- `sourceAnalysis.sourceShots`、`shotPlan.units`、`actionPhases`、人物轨迹、产品定位和 T1–T4 分类；
- 完整参考视频、目标产品图、选定换品锚点进入同一个 Video Node；
- `mergeWithPrevious + anchorStrategy=inherit_previous`；
- 后一镜头时间轴沿用前序真实换品锚点，纯语义时间帧可只负责动作定位；
- 严格覆盖、nodeKey、时间范围、素材上限和悬空锚点预检；
- 按 T1–T4 `qaProfile` 路由的动态质检。

当前缺口是：

- 人工“合并”仍以 `sourceUnit` 为单位保留两份独立动作文本，只把锚点和覆盖状态继承到后一镜头；
- 生成时 `action / actionGeometry / productExposure / continuity` 仍主要通过字符串汇总进入 Video Node；
- 没有持久化的 `Merged Generation Unit`、标准化动作时间轴、产品状态链、人物连续性档案和锚点组；
- 资产连线、资产语义角色和 Prompt 描述分散在不同字段，尚无统一 `Asset Manifest`；
- QA 知道 sourceShot 和 T1–T4，但不知道“哪些 sourceShot 已被用户声明为同一连续生成组”。

## 3. 本次开发解决的问题

本阶段解决以下确定性问题：

1. 用户选择“与上一个镜头共用关键帧”后，系统不再只共享一张锚点或减少关键帧计数，而是创建新的规划单元。
2. 合并动作不再通过 `shotA.action + shotB.action` 机械拼接；系统按原片动作阶段建立有顺序、时间和状态迁移的动作事件，并生成新的连续动作摘要。
3. 原片时长与目标生成时长解耦。动作先归一化到 `0..1`，再映射到目标视频时长。
4. 产品“保持一致”升级为可质检的状态链，明确关闭、打开、取出、展开、使用等允许迁移。
5. 人物连续性不再靠全局一句“同一人物”；系统明确锁定人物、允许的机位变化、原片硬切边界和不能跨边界继承的身份。
6. 关键帧从“共用一张图”升级为 `Anchor Group`：身份锚点和状态锚点各司其职。
7. 参考视频、产品白底图、换品关键帧和纯语义时间帧通过 `Asset Manifest` 明确角色、权威和实际连线。
8. 最终视频 Prompt 和 QA 使用同一份编译结果，避免 Prompt、画布连线和质检标准互相漂移。
9. 取消共用后可由原始事实层重新生成独立规划单元，不依赖反向解析已合并文本。

## 4. 预期效果与验收标准

### 4.1 用户结果

以“拿起包装并打开”加“取出内容物、展开并使用”为例，用户勾选后一镜头“与上一个镜头共用关键帧”后，应看到：

- 两张镜头卡属于同一个“连续生成组 A”；
- 连续动作摘要为“拿起 → 打开 → 取出 → 展开 → 使用”；
- 人物摘要为“同一人物锁定”或“按原片边界分别保持”；
- 产品摘要为“关闭 → 打开 → 取出 → 展开 → 使用”；
- 锚点摘要为“身份锚点 1 个，状态锚点 N 个”；
- 提交生成时，最终 Prompt、资产连线和 QA 均引用该组，而不是退回旧的独立镜头文本汇总。

### 4.2 必须通过的验收标准

1. `sourceAnalysis.sourceShots` 在合并、取消合并、重新确认和生成前后深度相等。
2. 两个相邻镜头共用后生成一个 `kind=merged_generation_unit` 的规划单元，包含全部 `sourceUnitIds/sourceShotIds` 和原片边界证据。
3. `normalizedActionTimeline` 单调、无重叠、首项从 0 开始、末项到 1；映射到任意目标时长后仍保持动作比例。
4. `productStateChain` 的顺序与动作时间轴一致，不允许无动作依据的逆迁移或产品数量变化。
5. `personContinuityProfile` 明确 `locked/scoped_by_source_shot/review_required`，不能因性别相同把不同人物合并。
6. `anchorGroup` 区分 `identity_anchor` 与 `product_state_anchor`；纯语义时间帧不进入必须连线锚点计数。
7. `assetManifest` 中所有 `connectToVideoNode=true` 的资产在提交时有真实 nodeKey，所有 `connectToVideoNode=false` 的纯语义时间帧不进入 LibTV `--left` 连线。
8. Compiled Video Prompt v2 包含任务、连续动作、人物连续性、产品身份、产品状态链、资产角色与权威、关键帧关系、禁止项，并使用真实 nodeKey 引用已连接资产。
9. QA Contract 同时保留 `sourceShot` 边界检查和 `mergedGenerationUnit` 内部连续性检查。
10. 取消共用后，原组消失，两个镜头恢复为独立规划单元、独立锚点需求和独立执行摘要。
11. T4 禁止新建自动语义合并；人物明确冲突、时间不相邻或产品状态明确冲突时返回可解释阻断。
12. v4 及更早任务可读取；有足够 sourceAnalysis 的任务确定性补齐 v2 规划，证据不足时保留旧执行逻辑并标记兼容降级，不破坏历史任务。

## 5. 前端对用户的变化

### 5.1 保留的操作

- 非首镜头继续提供一个轻量复选操作：“与上一个镜头共用关键帧”。
- 用户不需要理解 `Merged Generation Unit`、`Asset Manifest` 或 Prompt 编译器。
- 不新增管理后台、策略表、模型选择或必填表单。

### 5.2 新增的可见反馈

勾选后，镜头卡内显示只读的“连续生成组”摘要：

- 组名：连续生成组 A/B/C；
- 覆盖镜头：镜头 01 + 02；
- 连续动作：最多展示 5 个动作节点；
- 人物：同一人物锁定 / 按原片边界保持 / 待复核；
- 产品：状态迁移摘要；
- 锚点：身份锚点与状态锚点数量；
- 重算状态：已重算动作、人物、产品、资产和质检。

### 5.3 取消共用

- 取消勾选后立即提交新的 ShotPlan 规划。
- 前端展示恢复后的独立生成摘要。
- 已生成但因规划变化而过期的镜头锚点沿用现有清理规则，不删除原始 source keyframe 或 sourceShot。

### 5.4 错误反馈

前端不引入复杂门禁页。不能合并时，在现有操作附近显示后端返回的简短原因，例如：

- “两个镜头人物身份明确不同，不能建立同一人物连续生成组”；
- “两个镜头原片时间不相邻”；
- “当前任务为 T4，需要人工设计生成方案”。

## 6. 三层架构

```text
事实层（只读）
sourceAnalysis.sourceShots / actionPhases / personTracks / keyframes
        ↓
规划层（可重建）
shotPlan.units + generationPlanning.units + mergedUnits + anchorGroups
        ↓
执行层（每次提交重新编译）
Normalized Timeline + Product State Chain + Person Profile
+ Asset Manifest + Compiled Video Prompt v2 + QA Contract
        ↓
LibTV Video Node / QA Node
```

事实层不得引用规划层 ID；规划层只保存来源 ID 和确定性派生结果；执行层保存编译快照，便于追溯本次生成实际使用了什么。

## 7. 后端架构与数据契约

### 7.1 Generation Planning 根对象

```json
{
  "schemaVersion": "one-click-replacement-generation-planning-v2",
  "compilerVersion": "one-click-replacement-generation-compiler-v2",
  "compiledAt": "2026-08-21T00:00:00.000Z",
  "units": [],
  "mergedUnits": [],
  "anchorGroups": [],
  "warnings": [],
  "fallback": null
}
```

- `units` 是执行语义的规范顺序。未合并镜头也生成 `single_generation_unit`，避免下游同时理解两套数据。
- `mergedUnits` 是 `units` 中 `kind=merged_generation_unit` 的只读派生列表，便于前端与 QA 使用。
- `anchorGroups` 与 `units` 一一对应；合并组包含共享身份锚点及必要状态锚点。

### 7.2 Merged Generation Unit

```json
{
  "id": "merged-generation-unit-01",
  "kind": "merged_generation_unit",
  "label": "连续生成组 A",
  "sourceUnitIds": ["source-shot-unit-01", "source-shot-unit-02"],
  "sourceShotIds": ["shot-01", "shot-02"],
  "sourceRange": { "start": 0, "end": 4.2 },
  "sourceBoundaries": [
    { "at": 1.8, "hardCut": true, "identityBoundary": false, "sourceShotId": "shot-02" }
  ],
  "mergeDecision": {
    "requestedByUser": true,
    "allowed": true,
    "executionType": "T3",
    "reasonCodes": ["ADJACENT", "ACTION_CONTINUITY", "PRODUCT_STATE_CHAIN"]
  },
  "continuousActionSummary": "拿起 → 打开 → 取出 → 展开 → 使用",
  "normalizedActionTimeline": [],
  "productStateChain": [],
  "personContinuityProfile": {},
  "anchorGroupId": "anchor-group-01",
  "qaContractId": "qa-contract-01"
}
```

单镜头规划单元使用相同结构，但 `kind=single_generation_unit`、`requestedByUser=false`。

### 7.3 Normalized Action Timeline

```json
[
  {
    "actionId": "action-01",
    "order": 1,
    "action": "拿起面膜盒",
    "sourceRange": { "start": 0, "end": 0.8 },
    "normalizedRange": { "start": 0, "end": 0.1905 },
    "targetRange": { "start": 0, "end": 1.143 },
    "sourceShotId": "shot-01",
    "semanticFrameId": "semantic-keyframe-01",
    "anchorSourceKeyframeId": "replacement-anchor-01",
    "transitionType": "hold",
    "inventoryMutation": false
  }
]
```

规则：

- 先按 `sourceRange` 排序并裁剪到规划单元范围；
- 相邻且语义相同的重复阶段可合并，不能通过字符串相加制造新动作；
- `normalizedRange=(sourceTime-unitStart)/(unitEnd-unitStart)`；
- `targetRange=normalizedRange*targetDuration`，目标时长变化只重映射，不重做来源理解；
- `semanticFrameId` 只表示时间证据；`anchorSourceKeyframeId` 才表示换品状态资产来源。

### 7.4 Product State Chain

```json
[
  {
    "stateId": "product-state-00",
    "at": 0,
    "packageState": "closed",
    "contentLocation": "inside_package",
    "contentShape": "folded",
    "inventoryMutation": false,
    "evidenceActionId": "action-01"
  },
  {
    "stateId": "product-state-01",
    "at": 0.42,
    "packageState": "open",
    "contentLocation": "inside_package",
    "contentShape": "folded",
    "inventoryMutation": false,
    "evidenceActionId": "action-02"
  }
]
```

最小字段为包装状态、内容物位置、内容物形态、库存变化和证据动作。无法确定的字段写 `unknown`，不能猜测。状态只允许由 `transitionType`、`revealState`、`inventoryMutation` 或明确动作文本推进。

### 7.5 Person Continuity Profile

```json
{
  "mode": "locked",
  "primaryPersonIds": ["person-01"],
  "lockedFeatures": ["face", "hair", "bodyType"],
  "softFeatures": ["clothing", "accessories"],
  "allowedCameraChanges": ["source_hard_cut", "medium_to_hand_closeup"],
  "sourceShotScopes": [
    { "sourceShotId": "shot-01", "personIds": ["person-01"] },
    { "sourceShotId": "shot-02", "personIds": ["person-01"] }
  ],
  "confidence": 0.91,
  "reviewRequired": false
}
```

`mode`：

- `locked`：有足够主要身份证据证明同一人物；
- `scoped_by_source_shot`：原片合法换人或证据不足，只能逐 sourceShot 保持；该模式不能由“共用人物关键帧”强行改成同一人物；
- `review_required`：证据或结构冲突，不能自动建立强连续性。

### 7.6 Anchor Group

```json
{
  "id": "anchor-group-01",
  "generationUnitId": "merged-generation-unit-01",
  "identityAnchorId": "replacement-anchor-01",
  "stateAnchorIds": ["replacement-anchor-01", "replacement-anchor-03"],
  "semanticFrameIds": ["semantic-keyframe-01", "semantic-keyframe-02"],
  "inheritance": {
    "sourceUnitIds": ["source-shot-unit-01", "source-shot-unit-02"],
    "ownerSourceUnitId": "source-shot-unit-01"
  },
  "connectToVideoNode": ["replacement-anchor-01", "replacement-anchor-03"]
}
```

- `identityAnchorId` 锁定人物、场景和目标产品在当前连续组中的基础视觉身份。
- `stateAnchorIds` 只覆盖最小充分产品状态。
- `semanticFrameIds` 为时间定位证据，不默认连接 Video Node。
- 用户“共用关键帧”表示进入同一 `Anchor Group`，不等于只能传一张图。

### 7.7 Asset Manifest

```json
{
  "schemaVersion": "one-click-replacement-asset-manifest-v2",
  "generationUnitId": "merged-generation-unit-01",
  "assets": [
    {
      "assetId": "reference-video-01",
      "role": "motion_reference",
      "authority": { "motion": 100, "productIdentity": 0 },
      "connectToVideoNode": true,
      "nodeKey": "video-node-key"
    }
  ]
}
```

Manifest 在规划阶段可以没有 `nodeKey`；视频提交前必须用上传返回的真实 nodeKey 再编译并校验。

### 7.8 Compiled Video Prompt v2

Prompt 不负责发现资产，只解释 Manifest 中已经连接的资产。固定章节：

1. `【编译器】`：版本、规划单元 ID、T1–T4 类型；
2. `【任务】`：允许变化范围；
3. `【输入资产及权威关系】`：逐角色说明，并引用真实 nodeKey；
4. `【连续动作】`：Normalized Timeline 映射后的目标秒数；
5. `【人物连续性】`：Person Continuity Profile；
6. `【产品身份】`：产品契约与白底图最高产品身份权威；
7. `【产品状态链】`：有证据的状态迁移；
8. `【关键帧关系】`：身份锚点和状态锚点；
9. `【原片边界】`：允许的硬切/机位/人物变化；
10. `【禁止】`：产品漂移、逆状态迁移、无来源数量变化、人物串换、悬空资产等。

Prompt v2 继续复用现有产品契约、声音锁定、字幕禁止、物理规则和 nodeKey 严格审计，不另建第二条生成入口。

### 7.9 QA Contract

```json
{
  "id": "qa-contract-01",
  "schemaVersion": "one-click-replacement-qa-contract-v2",
  "executionType": "T3",
  "qaProfile": "global_inventory_continuity",
  "sourceShotChecks": ["hard_cut_preserved", "source_shot_order_preserved", "per_source_shot_identity_preserved"],
  "generationUnitChecks": [
    "merged_action_order_match",
    "person_continuity_match",
    "product_state_chain_match",
    "anchor_group_coverage_match"
  ],
  "retryPolicy": "profile_controlled"
}
```

QA 同时理解：

- `sourceShot` 决定原片允许发生的硬切、换人、换景和时间边界；
- `Merged Generation Unit` 决定组内必须保持的动作、人物和产品状态连续性。

## 8. 资产角色、权威优先级与 Video Node 连线

| 资产 | Manifest role | 主要权威 | 冲突优先级 | 连接 Video Node |
| --- | --- | --- | --- | --- |
| 参考视频 | `motion_reference` | 原片动作、节奏、人物、镜头、构图、接触、遮挡、声音 | 动作/镜头最高；目标产品身份最低 | 是 |
| 产品白底图/产品参考图 | `product_identity_truth` | 包装结构、尺寸比例、Logo、标签、颜色、材质、内容物真值 | 产品身份最高 | 是（换产品模式） |
| 身份关键帧 | `identity_anchor` | 当前人物、场景、目标产品比例和空间关系 | 低于产品白底图的产品身份，高于普通状态帧的组内视觉身份 | 是 |
| 状态关键帧 | `product_state_anchor` | 某动作阶段的开合、位置、形态和遮挡状态 | 产品状态高；产品基础身份仍服从白底图 | 是 |
| 纯语义时间帧 | `timeline_evidence` | 动作阶段时间、临界时刻、原片顺序 | 只提供时间证据，不提供产品身份 | 否 |

冲突时按维度分别判定，不能使用一个全局优先级：

- 产品身份：产品白底图 > 身份关键帧 > 状态关键帧 > 参考视频中的旧产品。
- 动作与镜头：参考视频 + ShotPlan > 状态关键帧 > 身份关键帧 > 产品白底图。
- 产品阶段状态：Product State Chain + 状态关键帧 > 身份关键帧；但不得覆盖产品白底图的 Logo、颜色和结构真值。
- 人物身份：参考视频当前 sourceShot + Person Continuity Profile > 关键帧；产品白底图无人物权威。

## 9. 合并门禁与 T1–T4 对接

### 9.1 通用门禁

`canMergeWithPrevious` 至少检查：

- 两个规划源单元在数组中相邻；
- `current.sourceStart` 与 `previous.sourceEnd` 误差不超过 0.2 秒；
- 不是 T4；
- 人物没有明确不同的主要身份或 personId 冲突；
- 产品层级、包装版本和状态迁移没有明确冲突；
- 动作是同一连续链，或由用户显式选择且没有硬冲突；
- 场景/机位变化只作为风险和 QA 边界，不单独绝对禁止。

### 9.2 分类行为

- T1：允许相邻误拆动作段合并；生成 `locked` 人物档案和单组动作时间轴。
- T2：默认保留 sourceShot 硬切；只有用户显式选择且人物/产品无硬冲突时建立语义组。原片硬切仍写入 `sourceBoundaries`，QA 不把合法机位变化判为失败。
- T3：允许并优先建立跨镜头状态组；必须生成 Product State Chain 和最小充分状态锚点。
- T4：禁止本阶段自动语义合并，返回 `REPLACEMENT_SEMANTIC_MERGE_MANUAL_REVIEW_REQUIRED`。本阶段不承诺解决 T4。

## 10. 现有 Generation Prompt 的兼容与迁移

### 10.1 兼容原则

- 保留现有一键换品任务入口、LibTV 单 Video Node、完整参考视频、产品契约、声音锁定、负面提示词和严格 nodeKey 预检。
- `one-click-replacement-built-in-video-v3` 仍作为工作流识别 ID；模板版本升级，Prompt 内增加 Generation Compiler v2 标识。
- 旧任务有 `replacementJobId` 时仍识别为一键换品，不因模板版本升级失去恢复能力。
- 现有 `generationUnits` 继续表示受模型时长/素材上限影响的 Video Node 执行分段；新的 `generationPlanning.units` 表示单个 Video Node 内的语义规划，二者不得混名。

### 10.2 迁移规则

- 新任务直接生成 v2 planning。
- 历史任务存在 `shotPlan.units + sourceAnalysis` 时，在初始化/读取/更新时确定性补齐 v2 planning，不修改 `sourceAnalysis.sourceShots`。
- 历史 `mergeWithPrevious=true` 或 `anchorStrategy=inherit_previous` 视为用户已经表达共用意图，迁移为同一 Merged Generation Unit。
- 历史任务证据不足以构建动作阶段时，使用原 unit 时间范围和 action 建立单阶段 timeline，并写入 `fallback=legacy_action_summary`。
- 历史任务缺少 sourceAnalysis 或存在明确结构冲突时，保留现有 v1 Prompt 汇总逻辑并写入兼容降级原因，不静默伪造 v2 数据。
- 每次用户调整共用关系后，重新编译 planning、coverage、generation units、T1–T4 快照和后续执行快照。

## 11. 可逆恢复

取消共用按以下顺序执行：

1. 把当前 source unit 的 `mergeWithPrevious=false`、`anchorStrategy=generate`；
2. 从未修改的 `sourceAnalysis.sourceShots` 和 `shotPlan.units` 重建 generation planning；
3. 删除旧的派生 merged unit/anchor group（不删除 sourceShot/source keyframe）；
4. 重建独立 normalized timeline、person profile、product state chain 和 anchor requirement；
5. 按现有变更签名规则令受影响的已生成锚点候选过期；
6. 下次提交重新生成 Asset Manifest、Prompt v2 和 QA Contract。

系统不从合并后的连续动作文本反向拆分，因此恢复不会丢失原始动作事实。

## 12. 测试矩阵

| 类别 | 用例 | 预期 |
| --- | --- | --- |
| 事实层 | 合并、取消、再合并 | `sourceShots` 深度不变 |
| 动作 | 拿起→打开→取出→展开→使用 | 一个 merged unit，动作有序且 normalized 0..1 |
| 时长 | 4.2 秒原片映射到 6/8 秒 | 比例不变，末项分别为 6/8 秒 |
| 产品 | 关闭→打开→取出 | 状态链单向推进，无凭空复位 |
| 产品 | 完整包装→不同包装版本 | 合并阻断 |
| 人物 | 同一人物，中景→手部特写 | 可合并，不因第二镜头看不到脸而换人 |
| 人物 | person-01→person-02 | 合并阻断，不能用性别相同覆盖 |
| T2 | 硬切但同人物连续动作 | 用户确认后可成组，硬切边界保留 |
| T3 | 仅手部取出/放入/排列 | 可合并，按物理状态链 QA |
| T4 | 多视角/透视冲突 | 生成前阻断自动语义合并 |
| 锚点 | 一身份锚点+多状态锚点 | 同 Anchor Group，均按需连接 |
| 语义帧 | `semantic-keyframe-07` 未入选 | 只定位时间，不连接、不触发 dangling |
| Manifest | 参考视频/白底图/锚点 | 角色、权威、nodeKey、connectToVideoNode 正确 |
| Prompt | v2 编译 | 固定章节齐全、真实 nodeKey、无 Mixed/显示名 |
| QA | 合并组跨原片硬切 | 同时检查组内连续与原片边界保真 |
| 取消 | 合并后取消 | 独立组、独立锚点需求、独立摘要恢复 |
| 迁移 | v4 历史共享锚点任务 | 自动补齐 merged unit，不损坏历史数据 |
| 回归 | 只换口播/只换背景 | 不强制目标产品锚点，原入口不变 |
| 容量 | 图片超过模型上限 | 继续只按硬限制拆 Video Node，不按语义组拆节点 |

测试分层：

1. 纯函数专项：规划、门禁、时间归一化、状态机、人物档案、锚点组；
2. runtime 专项：更新 ShotPlan、取消共用、历史迁移、覆盖计数；
3. server 专项：Asset Manifest、Prompt v2、nodeKey/时间轴预检、QA Contract；
4. 前端静态与 DOM 文案测试：单操作、组摘要、取消反馈；
5. 一键换品相关测试全量；
6. 仓库完整回归。

## 13. 本阶段不在范围内

- 不新增数据库表、OSS 案例归档、策略管理后台或普通用户复杂表单；
- 不接入 DeepSeek 或新增付费模型调用；
- 不开发“只共用产品关键帧但明确跨人物”的局部连续性模式；
- 不自动解决 T4 多视角、分屏、手数/透视冲突；
- 不改变 Qwen sourceShot 的事实提取协议，不重新分析已有原片；
- 不重新设计 LibTV 画布，不把一个语义组强行拆成新的 Video Node；
- 不在本阶段做真实成片效果上线验收或消耗生产积分；
- 不自动提交 PR、合并主线或发布生产。

## 14. 开发顺序与交付边界

1. 增加 Generation Planning v2 纯函数与数据迁移；
2. 把“与上一个镜头共用关键帧”接到语义合并和取消恢复；
3. 将 v2 planning 带入 Video Node 执行单元；
4. 编译 Asset Manifest、Compiled Video Prompt v2 和 QA Contract；
5. 增加前端连续生成组与重算摘要；
6. 完成专项和全量回归；
7. 交付时报告修改文件、测试、分支、提交/合并/部署状态。

本阶段默认只在阶段分支完成开发和验证。没有用户新增授权时，不发布生产。
