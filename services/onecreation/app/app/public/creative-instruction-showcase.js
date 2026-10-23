(function creativeInstructionShowcaseController(global) {
  "use strict";

  const WORKFLOW_TYPE = "creative_instruction_showcase";
  const DRAFT_KEY = "creative-instruction-showcase-draft-v2";
  const ACTIVE_TASK_KEY = "creative-instruction-showcase-active-task-v2";
  const TASK_STATE_KEY = "creative-instruction-showcase-task-state-v2";
  const TERMINAL_STATUSES = new Set(["success", "partial", "failed", "interrupted"]);
  const HIDDEN_VIDEO_MODEL_IDS = new Set(["kling-o3"]);
  const MODE_LABELS = Object.freeze({
    mixed2video: "全能参考",
    image2video: "图片参考",
    singleImage2video: "单图生视频",
    text2video: "文生视频",
    frames2video: "首尾帧",
    videoEdit2video: "视频编辑"
  });
  const $ = (selector) => document.querySelector(selector);

  const state = {
    config: null,
    sceneAsset: null,
    productAssets: [],
    instruction: "",
    taskProductId: "",
    categoryId: "",
    outputCount: 1,
    duration: 5,
    clarity: "720p",
    videoModelId: "seedance-2-vip",
    videoGenerationMode: "mixed2video",
    compiled: null,
    job: null,
    activeOutputIndex: 1,
    uploading: null,
    busy: false,
    status: "",
    error: "",
    polling: 0,
    recoveryInFlight: false,
    recoveryJobId: "",
    recoveryLastAttemptAt: 0,
    recoveryAttempts: 0
  };

  global.addEventListener("module-task-new", (event) => {
    if (event?.detail?.module !== "product-studio.html") return;
    stopPolling();
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(ACTIVE_TASK_KEY);
    localStorage.removeItem(TASK_STATE_KEY);
  });

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function api(url, options = {}) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `请求失败（${response.status}）`);
      error.code = payload.code || "";
      throw error;
    }
    return payload;
  }

  function loadJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
  }

  function saveDraft() {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      workflowType: WORKFLOW_TYPE,
      sceneAsset: state.sceneAsset,
      productAssets: state.productAssets,
      instruction: state.instruction,
      taskProductId: state.taskProductId,
      categoryId: state.categoryId,
      outputCount: state.outputCount,
      duration: state.duration,
      clarity: state.clarity,
      videoModelId: state.videoModelId,
      videoGenerationMode: state.videoGenerationMode,
      compiled: state.compiled
    }));
    if (state.job?.id) {
      localStorage.setItem(ACTIVE_TASK_KEY, state.job.id);
      localStorage.setItem(TASK_STATE_KEY, JSON.stringify(state.job));
    }
  }

  function restoreDraft() {
    const draft = loadJson(DRAFT_KEY);
    if (draft?.workflowType === WORKFLOW_TYPE) {
      state.sceneAsset = draft.sceneAsset || null;
      state.productAssets = Array.isArray(draft.productAssets) ? draft.productAssets.slice(0, 9) : [];
      state.instruction = String(draft.instruction || "");
      state.taskProductId = String(draft.taskProductId || draft.productProfileId || "");
      state.categoryId = String(draft.categoryId || "");
      state.outputCount = Number(draft.outputCount || 1);
      state.duration = Number(draft.duration || 5);
      state.clarity = String(draft.clarity || "720p");
      state.videoModelId = String(draft.videoModelId || "seedance-2-vip");
      state.videoGenerationMode = String(draft.videoGenerationMode || "mixed2video");
      state.compiled = draft.compiled || null;
    }
    const activeTaskId = String(localStorage.getItem(ACTIVE_TASK_KEY) || "").trim();
    const savedJob = loadJson(TASK_STATE_KEY);
    if (activeTaskId) state.job = savedJob?.id === activeTaskId ? savedJob : { id: activeTaskId, status: "running" };
  }

  function syncLinkedJobFromTaskContext() {
    const taskContext = global.AiProductTaskContext?.current?.() || {};
    const linked = taskContext.creativeInstructionJob || null;
    const linkedId = String(linked?.id || "").trim();
    const candidateJobId = String(taskContext.id || "").trim();
    if (linkedId && state.job?.id !== linkedId) {
      state.job = {
        id: linkedId,
        candidateJobId,
        status: String(linked.status || "running"),
        readyCount: Number(linked.readyCount || 0),
        total: Number(linked.total || 1),
        hasOutput: Boolean(linked.hasOutput),
        outputs: []
      };
      state.recoveryJobId = "";
      state.recoveryAttempts = 0;
      saveDraft();
      return true;
    }
    if (!linkedId && candidateJobId && state.job?.candidateJobId && state.job.candidateJobId !== candidateJobId) {
      state.job = null;
      localStorage.removeItem(ACTIVE_TASK_KEY);
      localStorage.removeItem(TASK_STATE_KEY);
      stopPolling();
      return true;
    }
    return false;
  }

  function selectedTaskProductId() {
    return String($("#productSelect")?.value || "").trim();
  }

  function selectedProfile() {
    const products = Array.isArray(state.config?.products) ? state.config.products : [];
    return products.find((product) => product.id === selectedTaskProductId()) || null;
  }

  function syncTaskProduct(productId = selectedTaskProductId(), { announce = false } = {}) {
    const nextProductId = String(productId || "").trim();
    if (!nextProductId) return;
    const changed = Boolean(state.taskProductId && state.taskProductId !== nextProductId);
    const hasMismatchedAssets = state.productAssets.some((asset) => String(asset?.productId || "") !== nextProductId);
    if (changed || hasMismatchedAssets) {
      state.productAssets = [];
      state.compiled = null;
      if (announce) state.status = "页面顶部产品 SKU 已切换，请为新 SKU 重新选择产品白底图。";
    }
    state.taskProductId = nextProductId;
  }

  function selectedCategory() {
    const categories = Array.isArray(state.config?.categories) ? state.config.categories : [];
    return categories.find((category) => category.id === state.categoryId) || null;
  }

  function renderCategories() {
    const carousel = $("#cisCategoryCarousel");
    const categories = Array.isArray(state.config?.categories) ? state.config.categories : [];
    const locked = workflowBusy();
    carousel.innerHTML = categories.map((category) => (
      `<button class="cis-category-option" type="button" role="radio" aria-checked="${category.id === state.categoryId}" data-category-id="${escapeHtml(category.id)}"${locked ? " disabled" : ""}><b>${escapeHtml(category.label)}</b><span>${escapeHtml(category.description)} · ${Number(category.sceneCount || 0)}个场景</span></button>`
    )).join("");
    carousel.querySelectorAll("[data-category-id]").forEach((button) => button.addEventListener("click", () => {
      if (workflowBusy()) return;
      state.categoryId = button.dataset.categoryId;
      state.compiled = null;
      state.error = "";
      state.status = `已选择“${selectedCategory()?.label || ""}”分类。`;
      saveDraft();
      render();
      carousel.querySelector('[aria-checked="true"]')?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }));
    const category = selectedCategory();
    const scenes = Array.isArray(category?.scenes) ? category.scenes : [];
    const hint = $("#cisCategorySceneHint");
    hint.textContent = category
      ? `已选择“${category.label}”：服务端已读取 ${scenes.length || category.sceneCount} 个预设场景；生成 ${state.outputCount} 条时会去重选择并组装不同提示词。${scenes.length ? ` 场景示例：${scenes.slice(0, 4).map((scene) => scene.name).join("、")}。` : ""}`
      : "请选择分类；服务端将从对应的 20 个场景中按生成数量去重组装提示词。";
    hint.title = scenes.map((scene) => `${scene.index}. ${scene.name}`).join("；");
  }

  function videoModels() {
    const configured = Array.isArray(state.config?.videoModels) ? state.config.videoModels : [];
    return configured.filter((model) => !HIDDEN_VIDEO_MODEL_IDS.has(model.id));
  }

  function selectedModel() {
    return videoModels().find((model) => model.id === state.videoModelId)
      || videoModels().find((model) => model.available !== false)
      || videoModels()[0]
      || null;
  }

  function modelModes(model = selectedModel()) {
    const modes = Array.isArray(model?.videoGenerationModes) ? model.videoGenerationModes : [];
    const compatible = modes.filter((mode) => ["mixed2video", "image2video", "singleImage2video"].includes(mode.value));
    return compatible.length ? compatible : [{ value: "mixed2video", label: "全能参考" }];
  }

  function workflowBusy() {
    return state.busy || Boolean(state.uploading) || Boolean(state.job?.id && !TERMINAL_STATUSES.has(state.job.status));
  }

  function ensureSettingsCompatible() {
    const models = videoModels();
    if (!models.some((model) => model.id === state.videoModelId && model.available !== false)) {
      state.videoModelId = models.find((model) => model.available !== false)?.id || models[0]?.id || "seedance-2-vip";
    }
    const model = selectedModel();
    const min = Math.max(3, Number(model?.durationMin || 4));
    const max = Math.min(15, Math.max(min, Number(model?.durationMax || 15)));
    state.duration = Math.max(min, Math.min(max, Math.round(Number(state.duration || model?.defaultDuration || 5))));
    const clarityOptions = Array.isArray(model?.clarityOptions) ? model.clarityOptions : [];
    if (!clarityOptions.some((item) => item.value === state.clarity)) {
      state.clarity = model?.defaultClarity || clarityOptions[0]?.value || "720p";
    }
    const modes = modelModes(model);
    if (!modes.some((mode) => mode.value === state.videoGenerationMode)) {
      state.videoGenerationMode = modes.find((mode) => mode.value === "mixed2video")?.value || modes[0]?.value || "mixed2video";
    }
  }

  function renderSettings() {
    $("#cisOutputCount").value = String(state.outputCount);

    const model = selectedModel();
    $("#cisVideoModel").innerHTML = videoModels().map((item) => (
      `<option value="${escapeHtml(item.id)}"${item.id === state.videoModelId ? " selected" : ""}${item.available === false ? " disabled" : ""}>${escapeHtml(item.label)}${item.available === false ? `（${escapeHtml(item.unavailableReason || "不可用")}）` : ""}</option>`
    )).join("");
    const durationMin = Math.max(3, Number(model?.durationMin || 4));
    const durationMax = Math.min(15, Math.max(durationMin, Number(model?.durationMax || 15)));
    $("#cisDuration").innerHTML = Array.from({ length: durationMax - durationMin + 1 }, (_, index) => durationMin + index)
      .map((duration) => `<option value="${duration}"${duration === state.duration ? " selected" : ""}>${duration}秒</option>`).join("");
    const clarityOptions = Array.isArray(model?.clarityOptions) && model.clarityOptions.length
      ? model.clarityOptions
      : [{ value: "720p", label: "720P" }];
    $("#cisClarity").innerHTML = clarityOptions.map((item) => `<option value="${escapeHtml(item.value)}"${item.value === state.clarity ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
    $("#cisVideoMode").innerHTML = modelModes(model).map((mode) => `<option value="${escapeHtml(mode.value)}"${mode.value === state.videoGenerationMode ? " selected" : ""}>${escapeHtml(mode.label || MODE_LABELS[mode.value] || mode.value)}</option>`).join("");
    $("#cisVideoModelHint").textContent = model?.available === false
      ? (model.unavailableReason || "当前模型不可用")
      : `最多 ${Number(model?.maxProductImages || 9)} 张产品图${model?.availabilityMessage ? ` · ${model.availabilityMessage}` : ""}`;
  }

  function renderScene() {
    const slot = $("#cisSceneSlot");
    if (state.uploading?.role === "scene") {
      slot.innerHTML = `<div class="cis-upload-progress"><b>正在上传场景图</b><progress max="100" value="${state.uploading.progress || 0}"></progress><span>${state.uploading.progress || 0}%</span></div>`;
      return;
    }
    const locked = workflowBusy();
    if (!state.sceneAsset) {
      slot.innerHTML = `<button class="cis-asset-empty" id="cisPickSceneButton" type="button"${locked ? " disabled" : ""}><b>＋ 上传场景图</b><span>可不上传；未上传时由自然指令和后端内置场景勾画生成背景</span></button>`;
      $("#cisPickSceneButton").addEventListener("click", () => $("#cisSceneInput").click());
      return;
    }
    slot.innerHTML = `<div class="cis-scene-preview"><img src="${escapeHtml(state.sceneAsset.previewUrl)}" alt="自定义场景图" /><div class="cis-asset-footer"><b title="${escapeHtml(state.sceneAsset.name)}">${escapeHtml(state.sceneAsset.name)}</b><button class="cis-remove-button" id="cisRemoveSceneButton" type="button"${locked ? " disabled" : ""}>移除</button></div></div>`;
    $("#cisRemoveSceneButton").addEventListener("click", () => {
      state.sceneAsset = null;
      state.compiled = null;
      saveDraft();
      render();
    });
  }

  function renderProducts() {
    const slot = $("#cisProductSlot");
    const locked = workflowBusy();
    const previews = state.productAssets.map((asset, index) => `<button class="ps-product-preview-thumb" data-cis-preview-product="${escapeHtml(asset.id)}" type="button" aria-label="查看大图：${escapeHtml(asset.name)}" title="点击查看大图：${escapeHtml(asset.name)}">
      <img src="${escapeHtml(asset.previewUrl)}" alt="${escapeHtml(asset.name)}缩略图" loading="lazy" />
      <i>${index + 1}</i>
    </button>`).join("");
    slot.innerHTML = previews
      ? `<div class="ps-asset-slot ps-multi-asset-slot ps-product-multi-asset-slot cis-selected-product-assets">
          <div class="ps-product-preview-grid" aria-label="已选产品白底图缩略图">${previews}</div>
          <button class="ps-asset-adjust-button" id="cisAddProductsButton" type="button"${locked ? " disabled" : ""}>
            <span><b>已选${state.productAssets.length}张产品白底图</b><em>调整选择</em></span>
            <small>点击上方缩略图可在页面查看大图</small>
          </button>
        </div>`
      : `<button class="cis-asset-empty" id="cisPickFirstProductsButton" type="button"${locked ? " disabled" : ""}><b>＋ 选择产品白底图</b><span>必选 1–9 张；仅显示页面顶部所选 SKU 的图片</span></button>`;
    $("#cisPickFirstProductsButton")?.addEventListener("click", openProductPicker);
    $("#cisAddProductsButton")?.addEventListener("click", openProductPicker);
    slot.querySelectorAll("[data-cis-preview-product]").forEach((button) => button.addEventListener("click", () => {
      global.AiProductAssetPicker?.previewProductImage?.(button.dataset.cisPreviewProduct);
    }));
  }

  async function openProductPicker() {
    if (workflowBusy()) return;
    const profile = selectedProfile();
    if (!profile) {
      state.error = "请先在页面顶部选择本次任务使用的产品 SKU。";
      return render();
    }
    const picker = global.AiProductAssetPicker;
    if (!picker?.selectProductImages) {
      state.error = "产品图片选择器暂不可用，请刷新页面后重试。";
      return render();
    }
    state.error = "";
    try {
      await picker.selectProductImages({
        contextLabel: "备用创意通道",
        selectedIds: state.productAssets.map((asset) => asset.id),
        minimum: 1,
        maximum: Math.min(9, Number(selectedModel()?.maxProductImages || 9)),
        onConfirm(assets) {
          state.productAssets = assets.map((asset) => ({
            id: String(asset.id || ""),
            name: String(asset.title || asset.name || "产品白底图"),
            productId: String(asset.productId || profile.id),
            previewUrl: String(asset.thumbnailUrl || asset.previewUrl || asset.originalUrl || "")
          }));
          state.compiled = null;
          state.status = `已选择 ${state.productAssets.length} 张“${profile.name}”产品白底图。`;
          saveDraft();
          render();
        }
      });
    } catch (error) {
      state.error = error.message;
      render();
    }
  }

  function outputStageMarkup(output) {
    const index = Math.max(1, Number(output?.index || 1));
    const title = String(output?.displayName || `创意视频${index}`);
    if (output?.hasOutput && output.previewUrl) {
      return `<div class="cis-output-ready"><video controls playsinline preload="metadata" src="${escapeHtml(output.previewUrl)}"></video><footer><b>${escapeHtml(title)}</b>${output.downloadUrl ? `<a href="${escapeHtml(output.downloadUrl)}">下载无水印成片</a>` : ""}</footer></div>`;
    }
    const progress = Math.max(0, Math.min(100, Number(output?.progress || 0)));
    return `<div class="cis-output-empty"><b>${escapeHtml(output?.stageLabel || output?.status || "创意视频生成中…")}</b><span>${progress}%</span></div>`;
  }

  function renderOutput() {
    const slot = $("#cisOutputSlot");
    const job = state.job;
    const outputs = Array.isArray(job?.outputs) ? job.outputs : [];
    const playableOutputs = outputs.filter((output) => output?.hasOutput && output.previewUrl);
    if (playableOutputs.length > 1) {
      if (!playableOutputs.some((output) => Number(output.index) === Number(state.activeOutputIndex))) {
        state.activeOutputIndex = Number(playableOutputs[0].index || 1);
      }
      const activeOutput = playableOutputs.find((output) => Number(output.index) === Number(state.activeOutputIndex)) || playableOutputs[0];
      slot.innerHTML = `<div class="cis-output-tabbed"><div class="cis-output-tabs" role="tablist" aria-label="创意视频结果">${playableOutputs.map((output) => {
        const index = Math.max(1, Number(output.index || 1));
        const active = index === Number(state.activeOutputIndex);
        return `<button type="button" role="tab" aria-selected="${active}" tabindex="${active ? "0" : "-1"}" data-cis-output-tab="${index}">视频${index}</button>`;
      }).join("")}</div><div class="cis-output-tab-panel" id="cisOutputTabPanel" role="tabpanel">${outputStageMarkup(activeOutput)}</div></div>`;
      slot.querySelectorAll("[data-cis-output-tab]").forEach((button, buttonIndex, buttons) => {
        const activate = () => {
          state.activeOutputIndex = Number(button.dataset.cisOutputTab || 1);
          renderOutput();
        };
        button.addEventListener("click", activate);
        button.addEventListener("keydown", (event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const nextIndex = event.key === "Home" ? 0
            : event.key === "End" ? buttons.length - 1
              : event.key === "ArrowRight" ? (buttonIndex + 1) % buttons.length
                : (buttonIndex - 1 + buttons.length) % buttons.length;
          state.activeOutputIndex = Number(buttons[nextIndex].dataset.cisOutputTab || 1);
          renderOutput();
          slot.querySelector(`[data-cis-output-tab="${state.activeOutputIndex}"]`)?.focus();
        });
      });
      return;
    }
    if (playableOutputs.length === 1) {
      state.activeOutputIndex = Number(playableOutputs[0].index || 1);
      slot.innerHTML = outputStageMarkup(playableOutputs[0]);
      return;
    }
    if (outputs.length) {
      const activeOutput = outputs.find((output) => !["success", "failed"].includes(String(output.status || ""))) || outputs[0];
      slot.innerHTML = outputStageMarkup(activeOutput);
      return;
    }
    if (job?.id && !TERMINAL_STATUSES.has(job.status)) {
      slot.innerHTML = `<div class="cis-output-empty"><b>创意视频生成中…</b><span>${escapeHtml(job.stageLabel || `${job.model || "LibTV"} 正在处理`)}</span><span>${Number(job.progress || 0)}%</span></div>`;
      return;
    }
    if (job?.status === "failed" || job?.status === "interrupted") {
      slot.innerHTML = `<div class="cis-output-empty"><b>生成未完成</b><span>${escapeHtml(job.error || "请检查任务状态后重试")}</span></div>`;
      return;
    }
    slot.innerHTML = `<div class="cis-output-empty"><b>输出创意视频</b></div>`;
  }

  function renderTrace() {
    const holder = $("#cisPromptTrace");
    const compiled = state.compiled;
    const jobTrace = state.job?.promptTrace;
    if (!compiled && !jobTrace) {
      holder.hidden = true;
      holder.innerHTML = "";
      return;
    }
    const template = compiled?.promptTemplate || jobTrace?.template || {};
    const rules = compiled?.rulesApplied || jobTrace?.rulesApplied || [];
    const sceneMode = compiled?.sceneMode || jobTrace?.sceneMode || "";
    const sceneSource = compiled?.sceneSource || jobTrace?.sceneSource || "";
    const category = compiled?.category || jobTrace?.category || selectedCategory();
    const promptRows = Array.isArray(compiled?.prompts) ? compiled.prompts : [];
    const sceneLinkLabel = sceneMode === "uploaded-scene"
      ? "用户上传场景图"
      : sceneSource === "user-instruction"
        ? "用户自然指令显式场景"
        : "服务端8×20场景库";
    holder.hidden = false;
    holder.innerHTML = [
      `<b>模板追溯：${escapeHtml(template.id || "-")}@${escapeHtml(template.version || "-")}</b>`,
      `<span>商业分类：${escapeHtml(category?.label || "-")} · ${Number(category?.sceneCount || 20)} 个服务端场景</span>`,
      `<span>场景链路：${sceneLinkLabel}</span>`,
      `<span>已应用规则：${rules.map(escapeHtml).join("；") || "-"}</span>`,
      compiled?.purpose ? `<span>编译结果：${Number(compiled.outputCount || promptRows.length || 1)} 套不同提示词 · 每套 ${Number(compiled.shotCount || 0)} 个分镜</span>` : "",
      ...(Array.isArray(compiled?.warnings) ? compiled.warnings.map((warning) => `<span>资产提醒：${escapeHtml(warning)}</span>`) : []),
      ...promptRows.map((prompt, index) => `<details><summary>提示词 ${index + 1} · ${escapeHtml(prompt.scenePreset?.name || prompt.treatment?.label || "创意变体")}</summary><pre>${escapeHtml(prompt.positivePrompt || "")}\n\n负面提示词：${escapeHtml(prompt.negativePrompt || "")}</pre></details>`),
      !promptRows.length && compiled?.positivePrompt ? `<details><summary>查看编译后的完整提示词</summary><pre>${escapeHtml(compiled.positivePrompt)}\n\n负面提示词：${escapeHtml(compiled.negativePrompt || "")}</pre></details>` : ""
    ].filter(Boolean).join("");
  }

  function setCheck(selector, ready, text) {
    const element = $(selector);
    element.classList.toggle("ready", ready);
    element.innerHTML = `<i>${ready ? "✓" : "—"}</i>${escapeHtml(text)}`;
  }

  function legacyCopyText(text) {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand("copy");
    helper.remove();
    if (!copied) throw new Error("浏览器未允许复制");
  }

  async function copyInstructionExample() {
    const button = $("#cisInstructionCopy");
    const text = $("#cisInstructionExample")?.textContent?.trim() || "";
    if (!button || !text) return;
    try {
      if (global.navigator?.clipboard?.writeText) {
        try { await global.navigator.clipboard.writeText(text); }
        catch { legacyCopyText(text); }
      } else {
        legacyCopyText(text);
      }
      button.textContent = "已复制";
    } catch {
      button.textContent = "复制失败";
    }
    global.setTimeout(() => { button.textContent = "复制示例"; }, 1600);
  }

  function render() {
    if (!state.config?.enabled) return;
    const model = selectedModel();
    const profile = selectedProfile();
    const skuReady = Boolean(profile);
    const maxImages = Number(model?.maxProductImages || 9);
    const productsReady = skuReady && state.productAssets.length >= 1 && state.productAssets.length <= 9 && state.productAssets.length <= maxImages
      && state.productAssets.every((asset) => String(asset.productId || "") === profile.id);
    const instructionReady = Boolean(state.instruction.trim());
    const categoryReady = Boolean(selectedCategory());
    const outputCountReady = Number.isInteger(state.outputCount) && state.outputCount >= 1 && state.outputCount <= 9;
    const modelReady = Boolean(model && model.available !== false);
    const busy = workflowBusy();
    renderCategories();
    renderScene();
    renderProducts();
    renderOutput();
    renderTrace();
    $("#cisInstruction").value = state.instruction;
    $("#cisInstruction").disabled = busy;
    ["#cisOutputCount", "#cisDuration", "#cisClarity", "#cisVideoModel", "#cisVideoMode"].forEach((selector) => { $(selector).disabled = busy; });
    setCheck("#cisSkuCheck", skuReady, skuReady ? `使用页面顶部任务 SKU：“${profile.name}”` : "请在页面顶部选择本次任务产品 SKU");
    setCheck("#cisSceneCheck", true, state.sceneAsset ? "自定义场景图已上传，将作为明确场景资产" : "未上传场景图，将由自然指令或分类场景库勾画");
    setCheck("#cisCategoryCheck", categoryReady, categoryReady ? `已选择“${selectedCategory().label}”，可读取该分类20个场景` : "请选择 1 个商业分类");
    setCheck("#cisOutputCountCheck", outputCountReady, outputCountReady ? `将重组 ${state.outputCount} 套提示词并在同一画布创建 ${state.outputCount} 个视频节点` : "生成数量必须是 1–9 的整数");
    setCheck("#cisProductCheck", productsReady, productsReady ? `已选择 ${state.productAssets.length} 张“${profile.name}”产品事实图` : state.productAssets.length > maxImages ? `${model.label} 最多支持 ${maxImages} 张产品图` : "请为顶部所选 SKU 选择 1–9 张产品白底图");
    setCheck("#cisInstructionCheck", instructionReady, instructionReady ? "一句话自然指令已填写" : "请填写一句话自然指令");
    setCheck("#cisModelCheck", modelReady, modelReady ? `${model.label} 可提交` : `${model?.label || "视频模型"} 当前不可用`);
    $("#cisCompileButton").disabled = busy || !skuReady || !productsReady || !instructionReady || !categoryReady || !outputCountReady;
    $("#cisGenerateButton").disabled = busy || !skuReady || !productsReady || !instructionReady || !categoryReady || !outputCountReady || !modelReady;
    $("#cisGenerateButton").textContent = busy && state.job?.id && !TERMINAL_STATUSES.has(state.job.status) ? "生成中…" : state.job?.hasOutput ? `重新生成 ${state.outputCount} 条创意视频` : `生成 ${state.outputCount} 条创意视频`;
    $("#cisSettingSummary").textContent = `${profile?.name || "未选SKU"} · ${selectedCategory()?.label || "未选分类"} · ${state.outputCount}套提示词/同画布${state.outputCount}节点 · ${model?.label || "视频模型"} · ${MODE_LABELS[state.videoGenerationMode] || state.videoGenerationMode} · ${state.duration}秒 · ${state.clarity} · ${state.sceneAsset ? "上传场景" : "自然指令/场景库"}`;
    $("#cisCanvasLink").innerHTML = state.job?.canvasUrl ? `<a class="ps-canvas-link" href="${escapeHtml(state.job.canvasUrl)}" target="_blank" rel="noreferrer">打开本任务独立 LibTV 画布 →</a>` : "";
    const notice = $("#cisStatus");
    const message = state.error || state.status;
    notice.hidden = !message;
    notice.classList.toggle("error", Boolean(state.error));
    notice.textContent = message;
  }

  function profilePayload() {
    const profile = selectedProfile();
    return {
      productId: profile?.id || "",
      productName: profile?.name || "用户上传产品",
      productCategory: profile?.category || ""
    };
  }

  function requestPayload() {
    const workstation = global.WorkbenchWorkstation?.identity?.() || {};
    const taskContext = global.AiProductTaskContext?.current?.() || {};
    return {
      workflowType: WORKFLOW_TYPE,
      workstationId: workstation.id,
      workstationLabel: workstation.label,
      candidateJobId: String(taskContext.id || ""),
      ...profilePayload(),
      categoryId: state.categoryId,
      outputCount: state.outputCount,
      sceneAsset: state.sceneAsset,
      productAssetIds: state.productAssets.map((asset) => asset.id),
      productAssets: state.productAssets.map((asset) => ({ id: asset.id, name: asset.name, productId: asset.productId })),
      instruction: state.instruction.trim(),
      duration: state.duration,
      clarity: state.clarity,
      videoModelId: state.videoModelId,
      videoGenerationMode: state.videoGenerationMode
    };
  }

  async function uploadAsset(file, role) {
    const params = new URLSearchParams({
      role,
      name: file.name,
      session: `${role}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    });
    return api(`./api/product-workflows/creative-instruction-showcase/assets/upload?${params}`, { method: "POST", body: file });
  }

  async function onSceneSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || workflowBusy()) return;
    state.uploading = { role: "scene", progress: 20 };
    state.error = "";
    render();
    try {
      const result = await uploadAsset(file, "scene");
      state.sceneAsset = result.asset;
      state.compiled = null;
      state.status = "场景图已上传。";
    } catch (error) {
      state.error = error.message;
    } finally {
      state.uploading = null;
      saveDraft();
      render();
    }
  }

  async function compilePrompt(showStatus = true) {
    state.busy = true;
    state.error = "";
    if (showStatus) state.status = "正在由服务端编译自然指令…";
    render();
    try {
      const result = await api("./api/product-workflows/creative-instruction-showcase/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload())
      });
      state.compiled = result.compiled;
      if (showStatus) state.status = `已从“${result.compiled.category?.label || "所选分类"}”的20个场景中重组 ${result.compiled.outputCount || 1} 套不同提示词；未提交视频生成，也未消耗正式生成额度。`;
      saveDraft();
      return result.compiled;
    } catch (error) {
      state.error = error.message;
      throw error;
    } finally {
      state.busy = false;
      render();
    }
  }

  async function createJob() {
    try {
      await compilePrompt(false);
    } catch {
      return;
    }
    if (!global.confirm(`将向 LibTV 提交 ${state.outputCount} 次正式视频生成：同一备用创意任务、同一独立画布、${state.outputCount} 个视频节点，并消耗对应额度。确认继续吗？`)) return;
    state.busy = true;
    state.error = "";
    state.status = "正在创建备用创意通道独立任务…";
    render();
    try {
      await global.AiProductTaskContext?.ensure?.("creative-instruction");
      const result = await api("./api/product-workflows/creative-instruction-showcase/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload())
      });
      state.job = result.job;
      state.status = `任务已提交到独立 LibTV 画布，正在运行 ${state.outputCount} 个创意视频节点。`;
      saveDraft();
      global.dispatchEvent(new Event("module-task-updated"));
      startPolling();
    } catch (error) {
      state.error = error.message;
    } finally {
      state.busy = false;
      render();
    }
  }

  async function pollJob() {
    if (!state.job?.id) return;
    try {
      const previousTaskCenterSignature = `${state.job.status || ""}:${Number(state.job.readyCount || 0)}:${Number(state.job.total || 0)}`;
      const result = await api(`./api/product-workflows/creative-instruction-showcase/jobs/${encodeURIComponent(state.job.id)}`);
      state.job = result.job;
      state.error = state.job.status === "failed" || state.job.status === "interrupted" ? state.job.error : "";
      state.status = state.job.hasOutput
        ? `已完成 ${Number(state.job.readyCount || 0)}/${Number(state.job.total || state.outputCount)} 条创意视频，可分别预览和下载。`
        : state.job.stageLabel || "创意视频生成中…";
      const recoveryRunning = await maybeRecoverRemoteOutputs();
      saveDraft();
      render();
      const nextTaskCenterSignature = `${state.job.status || ""}:${Number(state.job.readyCount || 0)}:${Number(state.job.total || 0)}`;
      if (nextTaskCenterSignature !== previousTaskCenterSignature) global.dispatchEvent(new Event("module-task-updated"));
      if (TERMINAL_STATUSES.has(state.job.status) && !recoveryRunning) stopPolling();
    } catch (error) {
      state.status = `任务轮询暂时失败，将继续重试：${error.message}`;
      render();
    }
  }

  async function maybeRecoverRemoteOutputs() {
    const job = state.job;
    if (!job?.id || job.hasOutput && Number(job.readyCount || 0) >= Number(job.total || 1)) return false;
    const recoverable = job.canRecoverDownload === true
      || (Array.isArray(job.outputs) && job.outputs.some((output) => output?.videoNodeName && !output?.hasOutput));
    if (!recoverable) return false;
    const now = Date.now();
    const terminal = TERMINAL_STATUSES.has(String(job.status || ""));
    const lastUpdate = Date.parse(job.updatedAt || job.createdAt || "") || now;
    if (!terminal && now - lastUpdate < 45_000) return false;
    if (state.recoveryJobId !== job.id) {
      state.recoveryJobId = job.id;
      state.recoveryLastAttemptAt = 0;
      state.recoveryAttempts = 0;
    }
    if (state.recoveryInFlight || now - state.recoveryLastAttemptAt < 15_000) return terminal && state.recoveryAttempts < 24;
    if (terminal && state.recoveryAttempts >= 24) return false;
    state.recoveryInFlight = true;
    state.recoveryLastAttemptAt = now;
    state.recoveryAttempts += 1;
    try {
      const result = await api(`./api/product-workflows/creative-instruction-showcase/jobs/${encodeURIComponent(job.id)}/recover-download`, { method: "POST" });
      state.job.status = "running";
      state.error = "";
      state.status = result.recovery === "running"
        ? "已检测到远端成片，正在恢复回传；不会重新生成视频。"
        : `已检测到 ${Number(result.taskIndexes?.length || 0)} 条远端成片，正在恢复回传无水印原链；不会重新生成视频。`;
      return true;
    } catch (error) {
      if (["REMOTE_RESULT_NOT_READY", "NO_RECOVERABLE_REMOTE_NODE"].includes(error.code)) {
        if (terminal && state.recoveryAttempts < 24) {
          state.error = "";
          state.status = "远端视频节点已存在，正在等待LibTV同步成片资源后自动回传。";
          return true;
        }
        return false;
      }
      state.error = `自动恢复回传暂时失败：${error.message}`;
      return terminal && state.recoveryAttempts < 24;
    } finally {
      state.recoveryInFlight = false;
    }
  }

  function startPolling() {
    stopPolling();
    pollJob();
    state.polling = global.setInterval(pollJob, 2500);
  }

  function stopPolling() {
    if (state.polling) global.clearInterval(state.polling);
    state.polling = 0;
  }

  function bindEvents() {
    $("#cisSceneInput").addEventListener("change", onSceneSelected);
    $("#cisInstructionCopy").addEventListener("click", copyInstructionExample);
    $("#cisInstruction").addEventListener("input", (event) => {
      state.instruction = event.target.value;
      state.compiled = null;
      saveDraft();
      render();
    });
    global.addEventListener("ai-product-sku-changed", (event) => {
      const previousProductId = state.taskProductId;
      syncTaskProduct(event.detail?.productId, { announce: Boolean(previousProductId) });
      state.compiled = null;
      saveDraft();
      render();
    });
    global.addEventListener("ai-product-task-context-changed", () => {
      if (!syncLinkedJobFromTaskContext()) return;
      render();
      if (state.job?.id) startPolling();
    });
    $("#cisOutputCount").addEventListener("input", (event) => {
      state.outputCount = Number(event.target.value);
      state.compiled = null;
      saveDraft();
      render();
    });
    $("#cisDuration").addEventListener("change", (event) => {
      state.duration = Number(event.target.value || 5);
      state.compiled = null;
      saveDraft();
      render();
    });
    $("#cisClarity").addEventListener("change", (event) => {
      state.clarity = event.target.value;
      saveDraft();
      render();
    });
    $("#cisVideoModel").addEventListener("change", (event) => {
      state.videoModelId = event.target.value;
      ensureSettingsCompatible();
      state.compiled = null;
      renderSettings();
      saveDraft();
      render();
    });
    $("#cisVideoMode").addEventListener("change", (event) => {
      state.videoGenerationMode = event.target.value;
      saveDraft();
      render();
    });
    $("#cisCategoryPrev").addEventListener("click", () => $("#cisCategoryCarousel").scrollBy({ left: -368, behavior: "smooth" }));
    $("#cisCategoryNext").addEventListener("click", () => $("#cisCategoryCarousel").scrollBy({ left: 368, behavior: "smooth" }));
    $("#cisCompileButton").addEventListener("click", () => compilePrompt(true).catch(() => {}));
    $("#cisGenerateButton").addEventListener("click", createJob);
    global.addEventListener("beforeunload", stopPolling);
  }

  async function init() {
    const panel = $("#creativeInstructionShowcasePanel");
    if (!panel) return;
    restoreDraft();
    try {
      state.config = await api("./api/product-workflows/creative-instruction-showcase/config");
      if (!state.config.enabled) {
        panel.hidden = true;
        global.dispatchEvent(new CustomEvent("ai-product-channel-availability", { detail: { channel: "creative-instruction", available: false } }));
        return;
      }
      global.dispatchEvent(new CustomEvent("ai-product-channel-availability", { detail: { channel: "creative-instruction", available: true } }));
      panel.hidden = false;
      if (!state.config.categories?.some((category) => category.id === state.categoryId)) state.categoryId = "";
      syncTaskProduct(selectedTaskProductId());
      if (!Number.isInteger(state.outputCount) || state.outputCount < 1 || state.outputCount > 9) {
        state.outputCount = Number(state.config.outputCount?.default || 1);
      }
      state.videoModelId = state.videoModelId || state.config.defaultVideoModelId;
      ensureSettingsCompatible();
      $("#cisTemplateBadge").textContent = `${state.config.promptTemplate.id}@${state.config.promptTemplate.version}`;
      bindEvents();
      syncLinkedJobFromTaskContext();
      renderSettings();
      render();
      if (state.job?.id && !TERMINAL_STATUSES.has(state.job.status)) startPolling();
      else if (state.job?.id) pollJob();
    } catch (error) {
      global.dispatchEvent(new CustomEvent("ai-product-channel-availability", { detail: { channel: "creative-instruction", available: true } }));
      panel.hidden = false;
      state.error = `备用创意通道初始化失败：${error.message}`;
      const notice = $("#cisStatus");
      notice.hidden = false;
      notice.classList.add("error");
      notice.textContent = state.error;
    }
  }

  global.AiCreativeInstructionShowcaseContext = Object.freeze({
    current() {
      return Object.freeze({
        id: String(state.job?.id || ""),
        candidateJobId: String(state.job?.candidateJobId || ""),
        hasOutput: Boolean(state.job?.hasOutput || (state.job?.outputs || []).some((output) => output?.hasOutput))
      });
    }
  });

  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
})(window);
