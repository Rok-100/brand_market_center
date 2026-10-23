# 用户自建 SKU 与统一 OSS 资产映射

## 目标

资产库允许用户创建产品 SKU，将该 SKU 的图片和产品碎镜头写入阿里云 OSS，并让 AI 产品镜、一键换品、一键做同款、AI-KOC 等视频入口读取同一套 SKU 和资产元数据。

## SKU 接口契约

- 新接口：`GET/POST /api/product-workflows/skus`、`PUT/DELETE /api/product-workflows/skus/:id`。
- 旧接口 `/api/product-workflows/products` 与 `/api/product-workflows/products/:id` 保留兼容，避免旧客户端失效。
- 新建 SKU 先写入本机状态，再尝试写入部门共享资源目录。共享服务暂不可用时接口仍返回已创建的 SKU，同时返回 `metadataSync.status=local_pending` 和 `warnings`，用户可继续编辑和上传素材。
- 共享 SKU 的资源类型为 `product_workflow_sku`；资源键为 `product-workflow-sku:<skuId>`。

SKU 的平台映射字段如下：

| 字段 | 用途 |
| --- | --- |
| `id` | 不可变 SKU 编码；默认由系统生成 |
| `name` / `shortName` / `category` | 各视频入口显示与提示词基础信息 |
| `defaultProductState` | OSS 资产与一键做同款产品形态映射；自建 SKU 必填 |
| `dimensionsCm` | 长、宽、高、直径；一键做同款自动布局需要，其他视频入口可不填 |
| `status` | `active` 可选择，`inactive` 保留 SKU 和素材但不进入可选目录 |
| `assetStatus` | 标记素材可用或待补，不替代实际 OSS 资产数量检查 |

## OSS 资产契约

- 图片和碎镜头继续使用 `product_workflow_asset` 资源类型，文件本体写入阿里云 OSS。
- 上传或修改资产归属时，服务端必须重新校验 SKU 存在且处于启用状态，并以 SKU 目录中的名称、分类覆盖客户端传值，防止伪造或陈旧映射。
- 产品图片必须标注 `productState`；新增图片时默认带出 SKU 的 `defaultProductState`，用户仍可按实际素材调整。
- 原始资产统一通过 `GET /api/product-workflows/assets/:id/original` 读取。服务端负责从 OSS 落本地缓存并按图片或视频类型流式返回，消费端不依赖 OSS 跨域配置。

## 视频入口消费规则

| 视频入口 | SKU 来源 | 资产来源 | 使用边界 |
| --- | --- | --- | --- |
| AI 产品镜 | 统一启用 SKU 目录 | 统一 OSS 产品图片与碎镜头 | 可直接选择自建 SKU 及其资产 |
| 一键换品 | 统一启用 SKU 目录 | 统一 OSS 产品图片 | 产品身份仅服从用户上传资产 |
| 一键做同款 | 统一启用且至少有一张图片的 SKU | 按 `productState` 分层的 OSS 图片 | 自动布局还要求对应形态尺寸完整 |
| AI-KOC | 统一启用 SKU 目录 | 当前 SKU 的统一 OSS 产品图片 | 选中后由服务端原图接口导入当前任务 |
| 单视频批量裂变 | 统一平台 SKU 目录 | 仍按该工作流现有输入规则 | 自建 SKU 不再被静默替换为首个内置产品 |

自建 SKU 没有内置产品知识时，平台只生成保守的通用产品描述和动作边界：允许陈列、手持，禁止虚构包装结构、开合、出液、功效、规格和使用动作。

## 兼容与失败语义

- 旧的本机自建 SKU 没有 `defaultProductState` 时仍能读取；用户下次通过新 SKU 管理界面保存时必须补选默认形态。
- SKU 共享目录或 OSS 元数据目录暂不可用时，列表回退本机缓存并明确返回提示，不用模糊的 `Not found` 覆盖真实错误。
- 含资产的自建 SKU 不允许删除；应改为停用，确保 OSS 文件和已有任务引用不丢失。
- 一键做同款缺少尺寸或缺少对应形态资产时，SKU 形态保持不可选并返回具体数据缺口，不猜测实物比例。

