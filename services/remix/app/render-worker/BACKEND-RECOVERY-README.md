# 二创后端候选与限定三文件恢复

基线：`wis/remix-memory-singleflight:20261007-r1`。候选与生产分离，本文档生成时没有发布或修改线上业务记录。

当前发布冻结：主任务确认生产数据库存在紧急止写保护，已有人员处理数据库故障。本轮仅候选、隔离回归和只读核验；禁止部署、解除止写和 `--apply`。以下 apply 命令仅为故障解决并重新确认维护窗口后的操作说明。

## 改动与边界

- 候选规划阶段复用已有受管切片 SHA，不再无条件读取所有已知 SHA 候选；真正选中的切片在预占前仍读取校验，渲染后仍独立重新读取校验。
- 同一 render 内、相同文件指纹的重复前置 hash 共享结果。文件变化、读取失败会清缓存；不同 render 与渲染后复验不复用。
- 依赖预检无变化时跳过全库写入。没有批量延迟、丢弃或放松 durable 业务状态提交。
- 黑晶非历史规则流程每条 basic 审核通过、原输入复验后立即保存小型原审核/登记凭证到 `registration-journal`，不等整批结束。凭证不触发通知、回传、投放；旧三文件缺少该凭证时使用下面的新本地恢复审核，绝不伪造旧 PASS。
- 恢复出来的 render 带 `recoveryRegistration.effectsBlocked=true`；统一 `automaticEffectsAllowed` 拒绝自动回传、投放及其扫描入口。原 run 带 `RECOVERY_REGISTRATION_ONLY`，继续任务扫描明确跳过。原任务的投放账户/计划/预算配置不变。
- 恢复隔离时保留 `recoveryRegistration.priorNextRunAt`，后续按用户确认范围恢复原定时安排，不推断新的时间或预算。

## 精确范围

| 原任务 | run | 原文件 |
| --- | --- | --- |
| 10.7黑晶混剪 | 82621cb7-fece-45a7-98b4-bfe0e490d01c | de290190-34d4-4d89-ad4a-061e8886f00b-1.mp4 |
| 10.6测试 | e44a2aec-ef52-4605-ad06-419d666a00c8 | e444ea22-dc9d-41bb-8bec-0f3551565dda-1.mp4 |
| 10.6测试 | e44a2aec-ef52-4605-ad06-419d666a00c8 | e444ea22-dc9d-41bb-8bec-0f3551565dda-2.mp4 |

## 执行顺序（由主任务执行）

必须先具备包含 `automation-preflight.mjs` 隔离检查和 `continueBasicJobs` hold 检查的候选，再执行任何 `--apply`。执行外部 CAS 恢复时必须停机/隔离所有活跃主库 writer（含 sidecar），恢复成功后新服务从主存储加载，不允许旧 libraryCache 继续运行覆盖外部写。`--maintenance-writers-stopped` 是操作员确认标志，不会自动关闭服务；需要另行实际验证隔离。工具本身不发外部请求投放，但没有服务端隔离检查的旧进程可能扫描新登记结果。

以下命令在容器内执行，关闭默认 metadata preload；配置文件里的凭据只用于内部 RPC，不打印。配置作用域和网关地址受固定 allowlist 约束。

```sh
# 1. 默认 dry-run：fresh 读取主存储；不写库、不读视频体、不做媒体审核。
env NODE_OPTIONS= node /app/render-worker/scripts/recover-reserved-outputs.mjs --config /run/pinying-metadata.json

# 2. 新的真实本地核验：只读原视频/切片，输出证据 JSON；不渲染、不调用模型、不写业务库。
env NODE_OPTIONS= node /app/render-worker/scripts/recover-reserved-outputs.mjs --config /run/pinying-metadata.json --review-local --report /safe/recovery-review.json

# 3. 再 dry-run，取得当时 libraryVersion。仅在隔离 guard 已发布且原文件审核全部通过后执行。
env NODE_OPTIONS= node /app/render-worker/scripts/recover-reserved-outputs.mjs --config /run/pinying-metadata.json --apply --receipt /safe/recovery-review.json --expected-version N --backup /safe/recovery-before.json --maintenance-writers-stopped
```

`/safe` 应由主任务指定为已有、可保留和访问控制正确的中转目录。输出文件使用 `wx`，不会覆盖既有证据。`--snapshot 文件` 可替代 `--config` 做完全离线测试，但禁止离线 apply。

真实旧切片通常没有入库 SHA，默认 dry-run 可能显示 `needs_bounded_local_hash_review`。这不是终局失败。`--review-local` 仅枚举原 run 的选片、原预占精确时长，最多读取 128 个候选作 hash 消歧；不扫全库、不扩展选片。输出逐条 `{phase,measured,total}`，之后逐原文件/切片输出进度。

原 `clips` 文件不存在时，只读检查既有 `/playback-cache`（可用 `--playback-cache` 指定）的 `reconstructed-render-input` 侧车；严格匹配 clip/source/切点、已有 source SHA、原预占 SHA、缓存大小与实测 SHA。不会启动播放恢复下载或重切。首次生产 dry-run 的 `a4a0467d03d5…` 错误已查明是原 clips 路径缺失；原 concat manifest 指向的既有缓存 SHA 精确等于该预占，可沿此证据回验。

本地核验包含：原预占序列 key、唯一原切片映射、原框架完整性、当前审批/品类、源字节、ffprobe、完整解码（`-xerror`）、时长/竖版/音轨/黑屏/静音、原切片与原成片全解码画面顺序 SSIM（底部10%仅避开已有叠字）、逐段音频相关、前后文件 hash 与指纹。固定阈值不自动放宽。证据保存原 probe、decode 日志和逐片比较指标，不冒充语义/商业内容审核。

每个 FFmpeg 输入和输出均设置 `threads=1`，普通滤镜和复杂滤镜也各限制为 1 线程；三个文件逐一核验。不会因工具默认 CPU 并行度抢占整个生产主机。

apply 在重新核对三条原视频与原切片 SHA 后再 fresh 读主存储，复核原任务、来源、审核、目标、投放配置和预占关系。随后备份、单次 CAS 提交、fresh 读回。并发版本冲突或结果不确定时不自动重试；读回同一 receipt 确认为已登记后即幂等结束。未决预占从 `reserved` 改为 `recorded`，不会删除后重生成。

恢复登记与继续回传/投放是两个操作。本工具不提供解除 `effectsBlocked` 的参数，不生成新批次或消息。后续只有在明确指定任务/计划范围后才能设计解除隔离操作。

## 新登记凭证的读回位置

`render-registration-journal.mjs` 导出 `readRegistrationJournals(directory, renderId)`，校验文件名、renderId、schema 和完整 SHA 后返回原审核/登记数据。生产凭证位于 `/data/clip-remix/registration-journal/<renderId>-<digest>.json`，受既有 `remix_files` metadata 主存储管理。

启动后的 scheduler 在普通任务续跑之前，最多对一个非运行中的当前原 run 读回未登记 journal；fresh 主库、当前授权、原预占、源审核与 binding、原输入/输出 SHA 和文件指纹全部通过后，经既有串行写/CAS登记。按每条 receipt 恢复第 1 或第 2 条后崩溃的部分成果，不重复生成。恢复记录统一 `effectsBlocked` 和 `RECOVERY_REGISTRATION_ONLY`；文件/回执变化则明确 `JOURNAL_RECOVERY_BLOCKED`，不清预占，不继续模型/渲染/外部投放。运行状态在核验期间变化则不覆盖用户动作。库写失败后不污染 committed 快照。

自动 replay 的边界是当前已有 durable 序列预占协议的黑晶非 historicalRules basic 成片。基线水润/眼膜没有该预占协议，本轮未扩展去重协议或宣称全品类崩溃恢复。历史 3 文件仍需手工限定工具产生新的本地核验证据。仅登记恢复，不自动解除隔离或恢复定时。

## 回归

```sh
node --test backend-recovery.test.mjs
node --check clip-remix-service.mjs
node --check scripts/recover-reserved-outputs.mjs
```

覆盖：三个文件白名单、同批幂等/重启、CAS 冲突和结果未知读回、失败保留原库、并发身份/选片/目标/计划变更、缺失/篡改审核、缺 SHA 原片重建、同文件变化、hash 失败重试、凭证损坏、真实 FFmpeg 解码与音视频比较，以及自动回传/投放隔离。没有进行生产恢复或实际投放验收。
