# 一键换品：首帧起始状态资产与 ShotPlan 连续性 v2

状态：本阶段开发基准
日期：2026-08-21
阶段分支：`feat/replacement-first-frame-origin-anchor-v2`
主线基线：`origin/main@aa92737`（已发布应用版本 `2.11.23`）

## 1. 本阶段解决的问题

现有实现已经要求用户在任务开始时选择“沿用原片首帧”或“生成新首帧”，但首帧在执行层仍被当作普通 ShotPlan 锚点处理：

- 首帧只有命中首个镜头的必需关键帧时才进入 Video Node，不能保证它始终是视频起始资产；
- 首帧可能替代 ShotPlan 的关键帧覆盖，导致用户选用首帧后同一时间点的换品关键帧不再生成；
- Asset Manifest 没有“新视频 0 秒起始状态”角色，最终 Prompt 也没有无条件声明首帧的 0 秒职责；
- 生成的新首帧已经固定人物、产品数量、摆放、方向和遮挡，但后续 ShotPlan 关键帧生图没有引用它；
- 切换已选首帧时，已生成的 ShotPlan 关键帧没有记录或校验首帧依赖；
- “沿用原片首帧”会无条件写入 `noProductReplacementRequired=true`，即使首帧仍明显包含旧产品；
- 新首帧生图虽然把场景图放在第一张输入，但会优先取首个 ShotPlan 语义关键帧，不能保证图 1 就是原片 0 秒首帧；
- 当前默认提示词没有使用本次任务的旧产品名、新产品名、真实尺寸和数量策略完成确定性编译。

本阶段将首帧升级为独立的 `Initial State Asset`。它始终与 ShotPlan Anchor Group 并列存在，不再替代、删除或满足 ShotPlan 换品关键帧覆盖。

## 2. 预期结果与验收标准

### 2.1 用户选择“沿用原片首帧”

- 使用参考视频实际提取的 0 秒首帧，不调用图片生成模型；
- 该图作为第一个最终 Video Node 的 `initial_state_anchor` 连接资产；
- 最终 Prompt 明确它是“新视频 0.0 秒起始状态图”；
- 它负责人物、姿态、构图、机位、背景、接触、遮挡和空间布局；
- 图中旧产品的产品身份权威为 0，目标产品身份仍只服从 `product_identity_truth`；
- 它不计入 ShotPlan 的必需换品关键帧覆盖，不删除同一 source keyframe 的已选换品锚点，也不改变 ShotPlan 重构和引用。

### 2.2 用户选择“生成新首帧”

- 图片模型输入顺序固定为：图 1 原片 0 秒首帧，图 2 起为用户在“新首帧图产品素材”中勾选并通过产品层级筛选的图片；
- 每个输入保存 `inputIndex/assetId/role`，模型请求的 `inputUrls` 必须与清单严格同序；
- 用户点击“选用”后，该候选作为第一个最终 Video Node 的 `initial_state_anchor`；
- 该图对新视频 0 秒的人物、产品数量、尺寸、摆放、方向、接触、遮挡和空间关系具有起始状态权威；
- 产品 Logo、标签、包装结构、颜色和材质仍以目标产品真值图为最高权威；
- 后续 ShotPlan 关键帧生图把已选新首帧作为连续性参考图，且记录候选 ID 与哈希依赖；
- 用户改选首帧后，依赖旧首帧生成的 ShotPlan 关键帧必须失效并重新生成，原始 `sourceShots` 和 source keyframes 不变。

### 2.3 通用验收

1. 任一换产品任务在提交首个 Video Node 前都有且只有一个已连接的 `initial_state_anchor`。
2. `initial_state_anchor.targetTime=0`，Compiled Video Prompt v2 明确写出“新视频 0.0 秒起始状态图”。
3. `initial_state_anchor` 不进入 `requiredAnchorCount/coveredAnchorCount`，ShotPlan 覆盖仍只由生成并选用的换品关键帧满足。
4. 新首帧输入图 1 永远是 `referenceAssets.firstFramePath`，不再替换为首个 ShotPlan 语义关键帧。
5. 新首帧输入图 2、图 3等严格对应 `firstFrameAssetIds` 经过当前产品层级契约筛选后的顺序。
6. 新首帧候选记录输入资产清单；ShotPlan 关键帧候选记录所依赖的已选新首帧 ID 与 SHA-256。
7. 沿用原片首帧时不把旧产品声明为目标产品真值，不再写死“首帧无需换产品”。
8. 生成新首帧时，ShotPlan 关键帧输入顺序为：原片语义关键帧 → 已选新首帧 → 可选同组全开箱基准 → 产品真值图。
9. 首帧、产品真值图、ShotPlan 锚点均计入模型参考图容量；超限时生成前阻断，不静默丢弃首帧。
10. 完整参考视频、T1—T4、Merged Generation Unit、Normalized Action Timeline、Product State Chain、Person Continuity Profile 和 QA Contract 继续按 v2.11.23 工作。

## 3. 前端变化

保留现有两个操作，不新增表单：

- “沿用原片首帧”；
- “生成新首帧”，并在候选图上点击“选用”。

增加两条只读反馈：

- 已选首帧显示“已作为新视频 0.0 秒起始状态”；
- 已选生成首帧额外显示“ShotPlan 新关键帧将继承此图的产品数量、摆放、方向和空间关系”。

用户切换已选首帧、且已有依赖旧首帧的 ShotPlan 关键帧时，沿用现有任务提示区说明这些关键帧需要重新生成，不引入复杂管理界面。

## 4. 后端数据契约

### 4.1 Initial State Asset

执行前从 `selectedFirstFrameId` 编译：

```json
{
  "assetId": "initial-state-first-frame-01",
  "candidateId": "first-frame-xxx",
  "role": "initial_state_anchor",
  "strategy": "generated",
  "targetTime": 0,
  "authority": {
    "motion": 0,
    "camera": 95,
    "personIdentity": 95,
    "productIdentity": 85,
    "productState": 100,
    "inventoryLayout": 100
  },
  "connectToVideoNode": true,
  "nodeKey": "real-node-key"
}
```

沿用原片首帧时 `strategy=reference`、`productIdentity=0`、`productState=40`、`inventoryLayout=100`。生成新首帧或用户自定义上传的已确认换品首帧使用 `strategy=generated/custom`；产品基础身份仍低于 `product_identity_truth=100`。

硬限制导致多个 Video Node 时，只有全局目标时间从 0 开始的第一个 Video Node 连接全局 `initial_state_anchor`；后续硬切片段使用各自 ShotPlan 状态锚点。

### 4.2 新首帧生图输入清单

```json
{
  "schemaVersion": "one-click-replacement-first-frame-input-v2",
  "assets": [
    { "inputIndex": 1, "assetId": "reference-first-frame", "role": "source_edit_base" },
    { "inputIndex": 2, "assetId": "product-asset-01", "role": "product_identity_truth" },
    { "inputIndex": 3, "assetId": "product-asset-02", "role": "product_identity_truth" }
  ]
}
```

清单在图片生成任务创建前持久化；实际上传 URL 顺序必须由此清单派生。

### 4.3 ShotPlan 关键帧首帧依赖

```json
{
  "initialStateDependency": {
    "candidateId": "first-frame-xxx",
    "sha256": "...",
    "role": "initial_state_continuity_reference",
    "inputIndex": 2
  }
}
```

仅已选的生成/自定义新首帧进入关键帧生图输入；沿用原片首帧不重复加入，因为原片语义关键帧与完整参考视频已经提供旧画面事实，且旧产品不能污染目标产品身份。

## 5. 新首帧默认提示词模板

前端继续允许编辑基础模板。后台用任务变量编译方括号占位符，并在末尾追加现有产品替换硬锁契约。

```text
【这是一次真实照片编辑任务，以图1人物场景图作为主体原图】。
以图1作为唯一编辑底图，仅将图1中的[旧产品]替换为图2、图3中的
[新产品名称]，彻底清除旧包装，不改变图1中的其他内容。

先识别旧产品在图1中的真实状态，包括位置、数量、朝向、透视、
堆叠方式，以及它与手部、人物、桌面、地面、货架、抽屉、容器
或其他物体之间的支撑、接触和遮挡关系。

用新产品重建相同的空间和物理关系：
被拿着时保持原手指和手臂遮挡；
放在桌面或地面时准确接触平面并匹配阴影；
在货架时与层板透视对齐；
在抽屉、袋子或箱子内时保留容器边缘遮挡；
堆叠或散落时保持原区域的密度、重心和占画面比例。

新产品真实尺寸为[尺寸]。
数量策略为[保持原数量 / 保持原区域体积自动调整数量 / 指定数量]。
所有同款产品必须使用同一物理尺寸模板，不能通过缩小、拉伸
或压扁产品制造数量感。

严格参考图2、图3等，保持包装形状、材质、颜色、Logo、标签、
产品名称和关键图案。匹配图1的光源、色温、透视、景深、
环境反射和接触阴影，使产品自然融入原场景。

只修改产品；人物、手部、家具、桌面、地面、货架、背景、
构图、文字和水印全部保持不变。

禁止旧产品残留、产品漂浮、穿模、尺寸错误、包装变形、
Logo反向、参考图背景被复制、白边、光晕、额外文字和场景变化。
```

占位符来源：

- `[旧产品]`：`taskVariables.originalProductName`；
- `[新产品名称]`：`taskVariables.newProductName || productName`；
- `[尺寸]`：当前产品契约在首个规划单元激活层级的真实尺寸；缺失时写“服从产品参考图中的真实尺寸与比例”，不得虚构；
- 数量策略：`taskVariables.productQuantityRule`。

## 6. Compiled Video Prompt v2 与资产权威

`【输入资产及权威关系】`增加：

```text
{{Node initial-state-node}}：新视频0.0秒起始状态图。
人物、姿态、构图、机位、背景、接触、遮挡及空间布局从该图开始；
若为生成新首帧，还要继承目标产品数量、尺寸模板、摆放和方向。
目标产品Logo、标签、结构、颜色和材质仍服从product_identity_truth。
若为沿用原片首帧，图中的旧产品只有空间定位证据，没有产品身份权威。
```

`initial_state_anchor`、`identity_anchor` 和 `product_state_anchor` 可以同时连接同一 Video Node；前者只负责新视频入口，后两者负责 ShotPlan 动作阶段，不互相去重。

产品身份优先级：

```text
product_identity_truth > generated initial_state_anchor > ShotPlan identity_anchor
> product_state_anchor > reference initial_state_anchor / reference video旧产品
```

产品起始数量、摆放、方向和空间关系优先级：

```text
selected generated initial_state_anchor > Product State Chain起始状态
> ShotPlan状态锚点 > reference initial_state_anchor / reference video
```

## 7. 可逆恢复与迁移

- 历史任务已有 `selectedFirstFrameId` 时，执行前确定性编译 `initial_state_anchor`，不要求重建任务；
- 历史首帧候选带有 `sourceKeyframeId` 时，不再用它满足 ShotPlan 覆盖；
- 旧 ShotPlan 锚点没有 `initialStateDependency` 时仍可读取；若当前选用的是生成/自定义首帧，提交新视频前必须按当前首帧重新生成；用户切换首帧时直接失效；
- 从“生成新首帧”切到“沿用原片首帧”时，依赖生成首帧的关键帧失效；从旧首帧切到新首帧同理；
- 删除、取消选用或切换首帧不修改 `sourceAnalysis.sourceShots`、source keyframes、Merged Generation Unit 或原片时间轴；
- 切换首帧只重编译执行资产，并使直接依赖旧首帧的派生 ShotPlan 关键帧失效。

## 8. 测试矩阵

| 类别 | 用例 | 预期 |
| --- | --- | --- |
| 沿用旧首帧 | 首帧有旧产品 | 连接为0秒起始资产，旧产品身份权威为0，不满足ShotPlan覆盖 |
| 生成新首帧 | 两张产品素材 | inputUrls严格为原片首帧、产品图1、产品图2 |
| 提示词 | 四类占位符 | 旧/新产品名、尺寸、数量策略全部编译，无未解析方括号 |
| ShotPlan | 已选生成新首帧后生成关键帧 | 输入包含新首帧并记录ID/哈希依赖 |
| ShotPlan | 沿用旧首帧 | 不把旧首帧加入关键帧生图输入 |
| 独立覆盖 | 首帧与首个关键帧同源 | 首帧不替代ShotPlan锚点，必需锚点仍生成、选用和连线 |
| 切换首帧 | 新首帧A→B | 依赖A的关键帧失效，sourceShots不变 |
| Manifest | 单Video Node | 1个initial_state_anchor、产品真值图和ShotPlan锚点全部有真实nodeKey |
| Prompt | 沿用旧首帧 | 明确0秒、旧产品身份权威0、目标产品服从真值图 |
| Prompt | 生成新首帧 | 明确继承数量、尺寸、摆放、方向和空间关系 |
| 容量 | 首帧+产品图+锚点超限 | 生成前返回ASSET_CAPACITY_EXCEEDED |
| 硬限制分段 | 多Video Node | 仅第一节点连接全局0秒首帧，后续片段使用所属ShotPlan锚点 |
| 回归 | 只换背景/只换口播 | 不新增换品首帧约束，原行为保持 |

## 9. 本阶段不在范围内

- 不增加新的用户必填字段或管理后台；
- 不改变 Qwen `sourceShots` 事实提取协议；
- 不用额外视觉模型自动识别生成首帧中的精确产品数量；用户“选用”作为该起始状态的人工确认；
- 不接入 DeepSeek，不新增付费推理链；
- 不自动解决 T4 多视角、分屏、手数或透视冲突；
- 不自动创建正式 LibTV 视频任务，不消耗生产生成额度；
- 未获得本阶段新的明确授权时，不合并主线、不发布生产。
