"use strict";

const state = {
  defaults: null,
  products: [],
  assets: [],
  assetType: "image",
  editingAssetId: "",
  managingSkuId: "",
  creatingSku: false,
  pendingUploadFiles: [],
  pendingUploadMetadata: [],
  pendingUploadIndex: 0,
  uploadQueue: [],
  uploadBusy: false,
  searchTimer: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const PROXY_SAFE_UPLOAD_CHUNK_BYTES = 768 * 1024;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { Accept: "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && data.loginRequired) {
    location.href = "./login.html";
    throw new Error("请先登录工作台");
  }
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

function notice(element, message = "", error = false) {
  if (!element) return;
  element.hidden = !message;
  element.textContent = message;
  element.classList.toggle("error", Boolean(error));
}

function selectedProduct() {
  return state.products.find((product) => product.id === $("#assetProductSelect").value) || state.products[0] || null;
}

function currentAsset() {
  return state.assets.find((asset) => asset.id === state.editingAssetId) || null;
}

function closeAssetProductSelectMenu(focusTrigger = false) {
  const menu = $("#assetProductSelectMenu");
  const trigger = $("#assetProductSelectTrigger");
  if (!menu || !trigger) return;
  menu.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
  if (focusTrigger) trigger.focus();
}

function openAssetProductSelectMenu() {
  const menu = $("#assetProductSelectMenu");
  const trigger = $("#assetProductSelectTrigger");
  if (!menu || !trigger || trigger.disabled) return;
  menu.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => menu.querySelector('[aria-selected="true"]')?.focus());
}

function renderAssetProductSelectControl() {
  const select = $("#assetProductSelect");
  const trigger = $("#assetProductSelectTrigger");
  const label = $("#assetProductSelectLabel");
  const menu = $("#assetProductSelectMenu");
  if (!select || !trigger || !label || !menu) return;
  const selectedOption = select.options[select.selectedIndex];
  const selectedText = selectedOption?.textContent?.trim() || "请选择产品 SKU";
  label.textContent = selectedText;
  trigger.title = selectedText;
  trigger.disabled = select.disabled || !select.options.length;
  menu.innerHTML = [...select.options].map((option) => (
    `<button class="ps-product-select-option" type="button" role="option" data-asset-product-id="${escapeHtml(option.value)}" aria-selected="${option.selected ? "true" : "false"}" title="${escapeHtml(option.textContent)}">${escapeHtml(option.textContent)}</button>`
  )).join("");
  closeAssetProductSelectMenu();
}

function renderProductOptions(preferredId = "") {
  const active = state.products.filter((product) => product.status === "active");
  const select = $("#assetProductSelect");
  const nextId = preferredId || select.value || active[0]?.id || "";
  select.innerHTML = active.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} · ${Number(product.imageCount || 0)}图/${Number(product.videoCount || 0)}视频</option>`).join("");
  if (active.some((product) => product.id === nextId)) select.value = nextId;
  renderAssetProductSelectControl();
  const editorOptions = active.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`).join("");
  $("#assetProductInput").innerHTML = editorOptions;
  $("#assetUploadProductInput").innerHTML = editorOptions;
  const product = selectedProduct();
  $("#assetProductHint").textContent = product
    ? `${product.category || "未分类"} · ${Number(product.imageCount || 0)} 张图片 · ${Number(product.videoCount || 0)} 条碎镜头`
    : "请先新增或启用产品 SKU";
}

async function loadProducts(preferredId = "") {
  const result = await api("./api/product-workflows/skus");
  state.products = result.items || [];
  renderProductOptions(preferredId);
}

function sourceLabel(asset) {
  if (asset.source === "workspace_product_catalog" || asset.readOnly) return "系统内置 · 等待同步（只读）";
  if (asset.source === "built-in") return "系统内置 · OSS 已同步（可删除）";
  if (asset.storageStatus === "stored") return "上传资产 · OSS 已同步（可删除）";
  return "工作台资产";
}

function renderAssets() {
  const grid = $("#assetLibraryGrid");
  $("#assetLibraryEmpty").hidden = state.assets.length > 0;
  $("#assetTotalCount").textContent = `${state.assets.length} ${state.assetType === "video" ? "条碎镜头" : "张图片"}`;
  grid.innerHTML = state.assets.map((asset) => `<article class="asset-library-card" data-asset-id="${escapeHtml(asset.id)}">
    <button class="asset-library-thumb" data-preview-asset="${escapeHtml(asset.id)}" type="button" aria-label="预览原始资产：${escapeHtml(asset.title)}">
      <img src="${escapeHtml(asset.thumbnailUrl)}" alt="${escapeHtml(asset.title)}缩略图" loading="lazy" />
      ${asset.assetType === "video" ? '<i class="asset-video-badge">▶ 视频</i>' : '<i class="asset-zoom-badge">查看原图</i>'}
    </button>
    <div class="asset-library-card-copy"><b title="${escapeHtml(asset.title)}">${escapeHtml(asset.title)}</b><small>${escapeHtml(sourceLabel(asset))}</small>${asset.duplicatesConsolidated ? `<small>已自动合并 ${Number(asset.exactDuplicateCount || 0)} 份相同素材</small>` : ""}<small>${asset.size ? `${(Number(asset.size) / 1024 / 1024).toFixed(1)} MB` : "大小未知"}${asset.duration ? ` · ${Number(asset.duration).toFixed(1)} 秒` : ""}</small></div>
    <footer><button data-edit-asset="${escapeHtml(asset.id)}" type="button" ${asset.readOnly ? "disabled title=\"系统内置文件尚未完成 OSS 同步\"" : ""}>修改</button><button class="danger" data-delete-asset="${escapeHtml(asset.id)}" type="button" ${asset.readOnly ? "disabled title=\"同步完成后才能删除\"" : "title=\"删除该素材及其历史重复记录\""}>删除</button></footer>
  </article>`).join("");
  $$('[data-preview-asset]').forEach((button) => button.addEventListener("click", () => openOriginal(button.dataset.previewAsset)));
  $$('[data-edit-asset]').forEach((button) => button.addEventListener("click", () => openAssetEditor(button.dataset.editAsset)));
  $$('[data-delete-asset]').forEach((button) => button.addEventListener("click", () => deleteAsset(button.dataset.deleteAsset)));
}

async function loadAssets() {
  const product = selectedProduct();
  if (!product) {
    state.assets = [];
    renderAssets();
    return;
  }
  notice($("#assetLibraryStatus"), "正在同步 OSS 资产目录…");
  const params = new URLSearchParams({ assetType: state.assetType, productId: product.id });
  const keyword = $("#assetSearchInput").value.trim();
  if (keyword) params.set("keyword", keyword);
  const result = await api(`./api/product-workflows/assets?${params}`);
  state.assets = result.items || [];
  renderAssets();
  const storage = state.defaults?.storage || {};
  $("#assetStorageStatus").textContent = storage.sharedStorageEnabled ? "阿里云 OSS 已连接" : "OSS 未连接 · 当前为本机兜底";
  const migration = result.migration;
  const message = result.sharedMessage
    || (migration?.migrated ? `已将 ${migration.migrated} 项内置资产迁移到 OSS` : "资产目录已同步");
  notice($("#assetLibraryStatus"), message, Boolean(result.sharedMessage));
}

function fitOriginalVideoPreview(videoWidth = 9, videoHeight = 16) {
  const dialog = $("#assetOriginalDialog");
  const width = Number(videoWidth) > 0 ? Number(videoWidth) : 9;
  const height = Number(videoHeight) > 0 ? Number(videoHeight) : 16;
  const ratio = width / height;
  const maxStageWidth = Math.max(240, Math.min(720, window.innerWidth - 56));
  const maxStageHeight = Math.max(240, Math.min(720, window.innerHeight - 180));
  const stageWidth = Math.min(maxStageWidth, maxStageHeight * ratio);
  dialog.style.setProperty("--asset-original-dialog-width", `${Math.round(stageWidth + 28)}px`);
  dialog.style.setProperty("--asset-original-aspect-ratio", `${width} / ${height}`);
}

function resetOriginalPreviewLayout() {
  const dialog = $("#assetOriginalDialog");
  dialog.classList.remove("is-video-preview");
  dialog.style.removeProperty("--asset-original-dialog-width");
  dialog.style.removeProperty("--asset-original-aspect-ratio");
}

function playOriginalVideo(video) {
  const playback = video.play();
  if (playback && typeof playback.catch === "function") {
    playback.catch(() => {});
  }
}

function openOriginal(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return;
  $("#assetOriginalTitle").textContent = asset.title || "查看原始资产";
  $("#assetOriginalType").textContent = asset.assetType === "video" ? "产品碎镜头原视频" : "产品图片原图";
  const image = $("#assetOriginalImage");
  const video = $("#assetOriginalVideo");
  if (asset.assetType === "video") {
    $("#assetOriginalDialog").classList.add("is-video-preview");
    fitOriginalVideoPreview();
    image.hidden = true;
    video.hidden = false;
    video.src = asset.originalUrl || asset.previewUrl;
    video.load();
  } else {
    resetOriginalPreviewLayout();
    video.hidden = true;
    image.hidden = false;
    image.src = asset.originalUrl || asset.previewUrl;
    image.alt = asset.title || "资产原图";
  }
  $("#assetOriginalDialog").showModal();
  if (asset.assetType === "video") playOriginalVideo(video);
}

function closeOriginal() {
  const image = $("#assetOriginalImage");
  const video = $("#assetOriginalVideo");
  image.removeAttribute("src");
  video.pause();
  video.removeAttribute("src");
  video.load();
  resetOriginalPreviewLayout();
  $("#assetOriginalDialog").close();
}

function openAssetEditor(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset || asset.readOnly) return;
  state.editingAssetId = asset.id;
  $("#assetEditHeading").textContent = asset.assetType === "video" ? "修改碎镜头信息" : "修改产品图片信息";
  $("#assetTitleInput").value = asset.title || "";
  $("#assetProductInput").value = asset.productId || selectedProduct()?.id || "";
  $("#assetRoleInput").value = asset.assetRole || (asset.assetType === "video" ? "product_broll" : "white_background");
  $("#assetProductStateInput").value = asset.productState || "";
  $("#assetViewInput").value = asset.view || asset.angle || "unknown";
  $("#assetStyleInput").value = asset.style || "";
  const imageMetadataRequired = asset.assetType === "image";
  ["#assetTitleInput", "#assetProductInput", "#assetRoleInput"].forEach((selector) => {
    $(selector).required = true;
    $(selector).closest(".pw-field")?.classList.add("asset-required-field");
  });
  $("#assetProductStateInput").required = imageMetadataRequired;
  $("#assetProductStateInput").closest(".pw-field")?.classList.toggle("asset-required-field", imageMetadataRequired);
  notice($("#assetEditStatus"), "");
  $("#assetEditDialog").showModal();
}

async function saveAsset(event) {
  event.preventDefault();
  const asset = currentAsset();
  if (!asset) return;
  const productId = $("#assetProductInput").value;
  const product = state.products.find((item) => item.id === productId);
  notice($("#assetEditStatus"), "正在保存并同步 OSS 索引…");
  try {
    const result = await api(`./api/product-workflows/assets/${encodeURIComponent(asset.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: $("#assetTitleInput").value.trim(),
        productId,
        category: product?.category || "",
        assetRole: $("#assetRoleInput").value,
        productState: $("#assetProductStateInput").value,
        view: $("#assetViewInput").value,
        style: $("#assetStyleInput").value.trim()
      })
    });
    if (result.metadataSync?.message) notice($("#assetEditStatus"), `已保存；共享索引稍后重试：${result.metadataSync.message}`, true);
    else notice($("#assetEditStatus"), "已保存并同步共享资产索引");
    await loadProducts(productId);
    await loadAssets();
    setTimeout(() => $("#assetEditDialog").close(), 350);
  } catch (error) {
    notice($("#assetEditStatus"), error.message, true);
  }
}

function closeAssetUploader() {
  state.pendingUploadFiles = [];
  state.pendingUploadMetadata = [];
  state.pendingUploadIndex = 0;
  $("#assetFileInput").value = "";
  $("#assetUploadDialog").close();
}

function renderPendingImageAsset() {
  const file = state.pendingUploadFiles[state.pendingUploadIndex];
  if (!file) return;
  const previous = state.pendingUploadMetadata[state.pendingUploadIndex - 1] || {};
  $("#assetUploadTitleInput").value = file.name.replace(/\.[^.]+$/, "");
  $("#assetUploadProductInput").value = previous.productId || selectedProduct()?.id || "";
  $("#assetUploadRoleInput").value = previous.assetRole || "white_background";
  const uploadProduct = state.products.find((item) => item.id === $("#assetUploadProductInput").value);
  $("#assetUploadProductStateInput").value = previous.productState || uploadProduct?.defaultProductState || "";
  const total = state.pendingUploadFiles.length;
  $("#assetUploadFileSummary").textContent = `待上传文件${total > 1 ? `（${state.pendingUploadIndex + 1}/${total}）` : ""}：${file.name}`;
  $("#confirmAssetUploadButton").textContent = state.pendingUploadIndex < total - 1 ? "保存并填写下一张" : `确认并上传${total > 1 ? ` ${total} 张` : ""}`;
  notice($("#assetUploadStatus"), "");
}

function openImageAssetUploader(files) {
  const product = selectedProduct();
  if (!product) throw new Error("请先新增或启用产品 SKU");
  if (!files.length) return;
  const invalid = files.find((file) => !/\.(png|jpe?g)$/i.test(file.name) || file.size > 10 * 1024 * 1024);
  if (invalid) throw new Error(!/\.(png|jpe?g)$/i.test(invalid.name) ? `${invalid.name}：文件格式不支持` : `${invalid.name}：图片不能超过 10MB`);
  state.pendingUploadFiles = [...files];
  state.pendingUploadMetadata = [];
  state.pendingUploadIndex = 0;
  renderPendingImageAsset();
  $("#assetUploadDialog").showModal();
  $("#assetUploadTitleInput").focus();
  $("#assetUploadTitleInput").select();
}

async function submitImageAssetUpload(event) {
  event.preventDefault();
  const files = [...state.pendingUploadFiles];
  if (!files.length) return;
  const metadata = {
    title: $("#assetUploadTitleInput").value.trim(),
    productId: $("#assetUploadProductInput").value,
    assetRole: $("#assetUploadRoleInput").value,
    productState: $("#assetUploadProductStateInput").value
  };
  const missing = [
    ["title", "资产名称"],
    ["productId", "所属 SKU"],
    ["assetRole", "资产角色"],
    ["productState", "产品形态"]
  ].filter(([key]) => !metadata[key]).map(([, label]) => label);
  if (missing.length) return notice($("#assetUploadStatus"), `请填写必填项：${missing.join("、")}`, true);
  state.pendingUploadMetadata[state.pendingUploadIndex] = metadata;
  if (state.pendingUploadIndex < files.length - 1) {
    state.pendingUploadIndex += 1;
    renderPendingImageAsset();
    $("#assetUploadTitleInput").focus();
    $("#assetUploadTitleInput").select();
    return;
  }
  const metadataByFile = [...state.pendingUploadMetadata];
  state.pendingUploadFiles = [];
  state.pendingUploadMetadata = [];
  state.pendingUploadIndex = 0;
  $("#assetUploadDialog").close();
  await uploadAssets(files, metadataByFile);
}

async function deleteAsset(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset || asset.readOnly) return;
  if (!window.confirm(`确定删除“${asset.title}”吗？\n将同时删除 OSS 对象、共享资产索引和同内容的历史重复记录，操作无法恢复。`)) return;
  notice($("#assetLibraryStatus"), `正在删除 ${asset.title}…`);
  try {
    await api(`./api/product-workflows/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
    await loadProducts(selectedProduct()?.id || "");
    await loadAssets();
    notice($("#assetLibraryStatus"), `${asset.title} 已从资产库和 OSS 删除；同内容的历史重复记录也已清理`);
  } catch (error) {
    notice($("#assetLibraryStatus"), error.message, true);
  }
}

async function uploadResponseData(response) {
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) return response.json().catch(() => ({}));
  const text = await response.text().catch(() => "");
  return { error: text || `上传失败（${response.status}）` };
}

async function uploadInChunks(file, params, onProgress) {
  const uploadId = globalThis.crypto?.randomUUID?.() || `chunk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const totalChunks = Math.ceil(file.size / PROXY_SAFE_UPLOAD_CHUNK_BYTES);
  let uploaded = {};
  for (let index = 0; index < totalChunks; index += 1) {
    const query = new URLSearchParams(params);
    query.set("kind", state.assetType === "video" ? "product-broll-video" : "product-asset-image");
    query.set("uploadId", uploadId);
    query.set("index", String(index));
    query.set("totalChunks", String(totalChunks));
    query.set("totalSize", String(file.size));
    const body = file.slice(index * PROXY_SAFE_UPLOAD_CHUNK_BYTES, Math.min(file.size, (index + 1) * PROXY_SAFE_UPLOAD_CHUNK_BYTES));
    const response = await fetch(`./api/upload/chunk?${query}`, { method: "POST", body });
    uploaded = await uploadResponseData(response);
    if (!response.ok) throw new Error(uploaded.error || `分片上传失败（${response.status}）`);
    onProgress?.(Math.round(((index + 1) / totalChunks) * 100));
  }
  return uploaded;
}

async function uploadAssetFile(file, params, onProgress) {
  const response = await fetch(`./api/product-workflows/assets/upload?${params}`, { method: "POST", body: file });
  if (response.status === 413 && file.size > PROXY_SAFE_UPLOAD_CHUNK_BYTES) {
    const uploaded = await uploadInChunks(file, params, onProgress);
    return api("./api/product-workflows/assets/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: uploaded.path, assetType: state.assetType, name: file.name, title: params.get("title"), productId: params.get("productId"), productName: params.get("productName"), category: params.get("category"), assetRole: params.get("assetRole"), productState: params.get("productState"), view: params.get("view"), style: params.get("style") })
    });
  }
  const data = await uploadResponseData(response);
  if (!response.ok) throw new Error(data.error || `上传失败（${response.status}）`);
  return data;
}

function renderUploadQueue() {
  const queue = $("#assetUploadQueue");
  queue.hidden = state.uploadQueue.length === 0;
  if (!state.uploadQueue.length) return void (queue.innerHTML = "");
  queue.innerHTML = `<header><b>上传明细</b><span>${state.uploadQueue.filter((item) => ["success", "failed"].includes(item.status)).length}/${state.uploadQueue.length} 完成</span></header><div class="ps-upload-queue-list">${state.uploadQueue.map((item) => `<article class="${escapeHtml(item.status)}"><i>${item.status === "success" ? "✓" : item.status === "failed" ? "×" : "…"}</i><div><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.detail)}</span></div><em>${({ pending: "等待", uploading: "上传中", success: "成功", failed: "失败" })[item.status]}</em></article>`).join("")}</div>`;
}

async function uploadAssets(files, metadata = {}) {
  if (!files.length || state.uploadBusy) return;
  const metadataByFile = Array.isArray(metadata) ? metadata : files.map(() => metadata);
  const fallbackProduct = selectedProduct();
  if (!fallbackProduct && !metadataByFile.some((item) => item?.productId)) throw new Error("请先新增或启用产品 SKU");
  if (state.assetType === "video" && files.length > 12) throw new Error("一次最多上传 12 条碎镜头");
  state.uploadBusy = true;
  state.uploadQueue = files.map((file) => ({ name: file.name, status: "pending", detail: "等待上传" }));
  renderUploadQueue();
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const fileMetadata = metadataByFile[index] || {};
    const product = state.products.find((item) => item.id === fileMetadata.productId) || fallbackProduct;
    if (!product) {
      Object.assign(state.uploadQueue[index], { status: "failed", detail: "所属 SKU 不存在或已停用" });
      renderUploadQueue();
      continue;
    }
    const pattern = state.assetType === "video" ? /\.(mp4|mov)$/i : /\.(png|jpe?g)$/i;
    const limit = state.assetType === "video" ? 500 * 1024 * 1024 : 10 * 1024 * 1024;
    if (!pattern.test(file.name) || file.size > limit) {
      Object.assign(state.uploadQueue[index], { status: "failed", detail: !pattern.test(file.name) ? "文件格式不支持" : "文件超过大小限制" });
      renderUploadQueue();
      continue;
    }
    Object.assign(state.uploadQueue[index], { status: "uploading", detail: `正在上传 0%（${index + 1}/${files.length}）` });
    renderUploadQueue();
    try {
      const params = new URLSearchParams({ assetType: state.assetType, name: file.name, title: fileMetadata.title || file.name.replace(/\.[^.]+$/, ""), productId: product.id, productName: product.name, category: product.category || "", assetRole: fileMetadata.assetRole || (state.assetType === "video" ? "product_broll" : "white_background"), productState: fileMetadata.productState || "", view: fileMetadata.view || "", style: fileMetadata.style || "", session: `asset-library-${Date.now()}-${index}` });
      const result = await uploadAssetFile(file, params, (progress) => {
        state.uploadQueue[index].detail = `正在上传 ${progress}%（${index + 1}/${files.length}）`;
        renderUploadQueue();
      });
      Object.assign(state.uploadQueue[index], { status: "success", detail: result.duplicateAsset ? `OSS 中已有相同资产，已跳过：${result.duplicateMatch?.title || file.name}` : "已写入 OSS 和共享资产目录" });
    } catch (error) {
      Object.assign(state.uploadQueue[index], { status: "failed", detail: error.message });
    }
    renderUploadQueue();
  }
  state.uploadBusy = false;
  $("#assetFileInput").value = "";
  const preferredProductId = metadataByFile.at(-1)?.productId || fallbackProduct?.id || "";
  await loadProducts(preferredProductId);
  await loadAssets();
  const failed = state.uploadQueue.filter((item) => item.status === "failed").length;
  notice($("#assetLibraryStatus"), failed ? `上传完成，其中 ${failed} 项失败，请查看明细` : "上传完成，资产已可供一创模块使用", failed > 0);
}

function skuSourceLabel(source) {
  return ({ "built-in": "内置 SKU", plugin: "产品插件", pending: "待补 SKU", custom: "自定义 SKU" })[source] || "产品 SKU";
}

function managedProduct() {
  return state.products.find((item) => item.id === state.managingSkuId) || null;
}

function renderSkuManager() {
  $("#skuManagerList").innerHTML = state.products.map((product) => `<button class="ps-sku-list-item${!state.creatingSku && product.id === state.managingSkuId ? " active" : ""}" data-manage-sku="${escapeHtml(product.id)}" type="button"><b>${escapeHtml(product.name)}</b><span>${escapeHtml(skuSourceLabel(product.source))} · ${product.status === "inactive" ? "已停用" : "启用"}</span><small>${Number(product.imageCount || 0)}图 / ${Number(product.videoCount || 0)}视频</small></button>`).join("");
  $$('[data-manage-sku]').forEach((button) => button.addEventListener("click", () => { state.creatingSku = false; state.managingSkuId = button.dataset.manageSku; renderSkuManager(); }));
  const product = managedProduct();
  $("#skuEditorEmpty").hidden = state.creatingSku || Boolean(product);
  $("#skuEditorFields").hidden = !state.creatingSku && !product;
  if (!state.creatingSku && !product) return;
  $("#skuEditorSource").textContent = state.creatingSku ? "自定义 SKU" : skuSourceLabel(product.source);
  $("#skuEditorTitle").textContent = state.creatingSku ? "新增 SKU" : product.name;
  $("#skuEditorAssetCount").textContent = state.creatingSku ? "0张图片 · 0条碎镜头" : `${Number(product.imageCount || 0)}张图片 · ${Number(product.videoCount || 0)}条碎镜头`;
  $("#skuIdInput").value = state.creatingSku ? "保存后自动生成" : product.id;
  $("#skuNameInput").value = state.creatingSku ? "" : product.name || "";
  $("#skuShortNameInput").value = state.creatingSku ? "" : product.shortName || "";
  $("#skuCategoryInput").value = state.creatingSku ? "" : product.category || "";
  $("#skuDefaultProductStateSelect").value = state.creatingSku ? "" : product.defaultProductState || "";
  $("#skuLengthInput").value = state.creatingSku ? "" : product.dimensionsCm?.length || "";
  $("#skuWidthInput").value = state.creatingSku ? "" : product.dimensionsCm?.width || "";
  $("#skuHeightInput").value = state.creatingSku ? "" : product.dimensionsCm?.height || "";
  $("#skuDiameterInput").value = state.creatingSku ? "" : product.dimensionsCm?.diameter || "";
  $("#skuStatusSelect").value = state.creatingSku ? "active" : product.status || "active";
  $("#skuAssetStatusSelect").value = state.creatingSku ? "ready" : product.assetStatus || "ready";
  $("#deleteSkuButton").hidden = state.creatingSku;
  $("#deleteSkuButton").disabled = !product || product.source !== "custom" || Number(product.imageCount || 0) + Number(product.videoCount || 0) > 0;
  notice($("#skuManagerStatus"), "");
}

async function openSkuManager() {
  await loadProducts(selectedProduct()?.id || "");
  state.creatingSku = false;
  state.managingSkuId = selectedProduct()?.id || state.products[0]?.id || "";
  renderSkuManager();
  $("#skuManagerDialog").showModal();
}

async function saveSku(event) {
  event.preventDefault();
  const dimensionsCm = Object.fromEntries([
    ["length", Number($("#skuLengthInput").value || 0)],
    ["width", Number($("#skuWidthInput").value || 0)],
    ["height", Number($("#skuHeightInput").value || 0)],
    ["diameter", Number($("#skuDiameterInput").value || 0)]
  ].filter(([, value]) => Number.isFinite(value) && value > 0));
  const payload = { name: $("#skuNameInput").value.trim(), shortName: $("#skuShortNameInput").value.trim(), category: $("#skuCategoryInput").value.trim(), defaultProductState: $("#skuDefaultProductStateSelect").value, dimensionsCm, status: $("#skuStatusSelect").value, assetStatus: $("#skuAssetStatusSelect").value };
  if (!payload.name) return notice($("#skuManagerStatus"), "请输入产品名称", true);
  const current = managedProduct();
  if ((state.creatingSku || current?.source === "custom") && !payload.defaultProductState) return notice($("#skuManagerStatus"), "请选择默认产品形态，供视频平台映射素材", true);
  notice($("#skuManagerStatus"), "正在保存…");
  try {
    const result = state.creatingSku
      ? await api("./api/product-workflows/skus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await api(`./api/product-workflows/skus/${encodeURIComponent(state.managingSkuId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    state.creatingSku = false;
    state.managingSkuId = result.product.id;
    await loadProducts(result.product.id);
    renderSkuManager();
    notice($("#skuManagerStatus"), result.warnings?.length ? `SKU 已保存在本机，${result.warnings.length} 项共享索引稍后重试` : "SKU 已保存并同步到共享目录", Boolean(result.warnings?.length));
    await loadAssets();
  } catch (error) {
    notice($("#skuManagerStatus"), error.message, true);
  }
}

async function deleteSku() {
  const product = managedProduct();
  if (!product || product.source !== "custom") return;
  if (!window.confirm(`确定删除空的自建 SKU“${product.name}”吗？`)) return;
  try {
    await api(`./api/product-workflows/skus/${encodeURIComponent(product.id)}`, { method: "DELETE" });
    state.managingSkuId = "";
    const requestedProductId = new URLSearchParams(window.location.search).get("productId") || "";
    await loadProducts(requestedProductId);
    renderSkuManager();
    await loadAssets();
  } catch (error) {
    notice($("#skuManagerStatus"), error.message, true);
  }
}

async function init() {
  try {
    state.defaults = await api("./api/product-workflows/defaults");
    await loadProducts();
    await loadAssets();
  } catch (error) {
    notice($("#assetLibraryStatus"), error.message, true);
    $("#assetStorageStatus").textContent = "资产服务暂不可用";
  }

  $("#assetProductSelect").addEventListener("change", () => loadAssets().catch((error) => notice($("#assetLibraryStatus"), error.message, true)));
  $("#assetProductSelectTrigger").addEventListener("click", () => {
    if ($("#assetProductSelectMenu").hidden) openAssetProductSelectMenu();
    else closeAssetProductSelectMenu();
  });
  $("#assetProductSelectTrigger").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAssetProductSelectMenu();
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    openAssetProductSelectMenu();
  });
  $("#assetProductSelectControl").addEventListener("focusout", () => {
    requestAnimationFrame(() => {
      if (!$("#assetProductSelectControl").contains(document.activeElement)) closeAssetProductSelectMenu();
    });
  });
  $("#assetProductSelectMenu").addEventListener("click", (event) => {
    const option = event.target.closest("[data-asset-product-id]");
    if (!option) return;
    const select = $("#assetProductSelect");
    if (select.value === option.dataset.assetProductId) {
      closeAssetProductSelectMenu(true);
      return;
    }
    select.value = option.dataset.assetProductId;
    renderAssetProductSelectControl();
    select.dispatchEvent(new Event("change", { bubbles: true }));
    $("#assetProductSelectTrigger").focus();
  });
  $("#assetProductSelectMenu").addEventListener("keydown", (event) => {
    const options = $$("#assetProductSelectMenu [data-asset-product-id]");
    const currentIndex = options.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeAssetProductSelectMenu(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? options.length - 1
        : event.key === "ArrowDown" ? Math.min(options.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
    options[nextIndex]?.focus();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#assetProductSelectControl")) closeAssetProductSelectMenu();
  });
  $$('[data-asset-type]').forEach((button) => button.addEventListener("click", () => {
    state.assetType = button.dataset.assetType;
    $$('[data-asset-type]').forEach((item) => item.classList.toggle("active", item === button));
    const isVideo = state.assetType === "video";
    $("#assetFileInput").accept = isVideo ? "video/mp4,video/quicktime,.mov" : "image/png,image/jpeg,.png,.jpg,.jpeg";
    $("#assetFileInput").multiple = true;
    $("#assetUploadTitle").textContent = isVideo ? "新增产品碎镜头" : "新增产品图片";
    $("#assetUploadHint").textContent = isVideo ? "MP4 / MOV，单条不超过 500MB；上传后写入 OSS" : "PNG / JPG，单张不超过 10MB；填写完整资产信息后写入 OSS";
    loadAssets().catch((error) => notice($("#assetLibraryStatus"), error.message, true));
  }));
  $("#assetSearchInput").addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => loadAssets().catch((error) => notice($("#assetLibraryStatus"), error.message, true)), 280);
  });
  $("#assetFileInput").addEventListener("change", (event) => {
    const files = [...event.target.files];
    const action = state.assetType === "image" ? Promise.resolve().then(() => openImageAssetUploader(files)) : uploadAssets(files);
    action.catch((error) => notice($("#assetLibraryStatus"), error.message, true));
  });
  $("#manageSkuButton").addEventListener("click", () => openSkuManager().catch((error) => notice($("#assetLibraryStatus"), error.message, true)));
  $("#closeSkuManagerButton").addEventListener("click", () => $("#skuManagerDialog").close());
  $("#newSkuButton").addEventListener("click", () => { state.creatingSku = true; state.managingSkuId = ""; renderSkuManager(); $("#skuNameInput").focus(); });
  $("#skuManagerForm").addEventListener("submit", saveSku);
  $("#deleteSkuButton").addEventListener("click", deleteSku);
  $("#assetEditForm").addEventListener("submit", saveAsset);
  $("#assetUploadForm").addEventListener("submit", (event) => submitImageAssetUpload(event).catch((error) => notice($("#assetUploadStatus"), error.message, true)));
  $("#closeAssetUploadButton").addEventListener("click", closeAssetUploader);
  $("#cancelAssetUploadButton").addEventListener("click", closeAssetUploader);
  $("#assetUploadDialog").addEventListener("close", () => {
    state.pendingUploadFiles = [];
    state.pendingUploadMetadata = [];
    state.pendingUploadIndex = 0;
    $("#assetFileInput").value = "";
  });
  $("#closeAssetEditButton").addEventListener("click", () => $("#assetEditDialog").close());
  $("#cancelAssetEditButton").addEventListener("click", () => $("#assetEditDialog").close());
  $("#closeAssetOriginalButton").addEventListener("click", closeOriginal);
  $("#assetOriginalVideo").addEventListener("loadedmetadata", (event) => {
    fitOriginalVideoPreview(event.currentTarget.videoWidth, event.currentTarget.videoHeight);
  });
  window.addEventListener("resize", () => {
    const dialog = $("#assetOriginalDialog");
    const video = $("#assetOriginalVideo");
    if (dialog.open && dialog.classList.contains("is-video-preview")) {
      fitOriginalVideoPreview(video.videoWidth, video.videoHeight);
    }
  });
  $("#assetOriginalDialog").addEventListener("close", () => {
    $("#assetOriginalImage").removeAttribute("src");
    $("#assetOriginalVideo").removeAttribute("src");
    $("#assetOriginalVideo").load();
    resetOriginalPreviewLayout();
  });
}

init();
