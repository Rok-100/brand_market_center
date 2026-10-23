# 用户自建 SKU 与统一 OSS 资产接续摘要

## 当前基线

- 仓库：`brand-marketing-workbench-replacement-0808-mainline`
- 独立工作树：`worktrees/user-sku-asset-platform-support`
- 开发分支：`fix/user-sku-asset-platform-support`
- 基线：`origin/main@1d763ef`（v2.11.91 生产恢复记录）

## 本轮成果

- 新增稳定的 `/api/product-workflows/skus` CRUD 接口，保留旧 `/products` 接口兼容，解决资产库新增 SKU 命中旧后端或代理时只显示 `Not found`、且错误不可辨识的问题。
- 自建 SKU 新增默认产品形态和可选实物尺寸，持久化到本机状态并以 `product_workflow_sku` 同步部门共享目录。
- SKU 共享写入失败时保留本机创建结果并返回待同步警告，不再让共享服务瞬时异常阻断用户新增。
- OSS 资产上传和改归属时强制校验启用 SKU，并以服务端 SKU 名称、分类为准。
- 统一平台产品目录已纳入自建 SKU；AI 产品镜、一键换品、一键做同款、AI-KOC 和裂变配置可读取同一目录。
- AI-KOC 产品图库从本地 `imageDir` 切换到当前 SKU 的统一 OSS 资产，并通过同源原图接口导入任务。
- 一键做同款可用自建 SKU 的默认形态、尺寸和 OSS 形态资产建立可选状态；缺尺寸时仍按安全规则阻断自动布局。

长期接口与产品规则见：[用户自建SKU与统一OSS资产映射-v1.md](../用户自建SKU与统一OSS资产映射-v1.md)。

## 验证

- `node --check app/server.js`：通过。
- `node --check app/assets/product-workflows-runtime/product-workflows.js`：通过。
- `node --check app/public/asset-library.js`：通过。
- `node --check app/public/koc.js`：通过。
- SKU/资产/AI-KOC/一键做同款专项回归：37/37 通过。
- `app/tests` 串行全量回归：163/163 个测试文件通过。
- 新增 `user-sku-platform-assets-v21192.test.js`，覆盖 SKU 共享持久化、形态尺寸保真、OSS 资产映射可选性和 AI-KOC 统一资产入口。

## 交付状态

- 代码：功能提交 `acd3048`、发布准备提交 `32b1e66` 已经 PR #314 合并到主线；合并提交为 `fee2280760710d4f4694c73e0b5be3eddd926c0c`。
- 版本：v2.11.92；资产库与 AI-KOC 静态资源使用 v2.11.92 缓存键。
- 部署：生产流水线 #303 已成功，绑定提交与远端主线一致；服务器端 163 项测试与线上检查通过。
- 线上核验：登录态 `/api/ready` 返回 v2.11.92；SKU 新接口返回 HTTP 200 和 9 项目录；资产库的新形态/尺寸字段、AI-KOC 统一 OSS 图库脚本均已加载。
- 外部状态：阿里云 OSS 已连接；部门共享 SKU/资产目录仍因中枢 HTTP 302 回退本机持久化缓存。当前生产实例内链路可用，跨实例共享索引待中枢会话恢复后复验。
- 本次线上验收没有创建测试 SKU、上传测试资产或触发生成；真实新增/上传的写入验收应由业务用户用非关键 SKU 完成。
