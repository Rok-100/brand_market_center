"use strict";

(() => {
  const path = window.location.pathname.toLowerCase();
  const configurations = [
    { match: "product-studio.html", title: "AI产品镜任务", personalScope: true, endpoint: "./api/product-workflows/image-candidates?limit=50", createDraftEndpoint: "./api/product-workflows/image-candidates/drafts", createDraftPayload: () => ({ taskChannel: window.AiProductTaskContext?.current?.().channel || localStorage.getItem("ai-product-studio-active-channel-v1") || "standard" }), reorderEndpoint: "./api/product-workflows/image-candidates/order", storageKey: "ai-product-studio-current-task-v1", draftKey: "ai-product-studio-task-draft-v1", insertAfter: "#customCreativePanel", deleteEndpoint: (job) => `./api/product-workflows/image-candidates/${encodeURIComponent(job.id)}`, renameEndpoint: (job) => `./api/product-workflows/image-candidates/${encodeURIComponent(job.id)}`, unwrap: (data) => data.jobs || [], details: (job) => job.taskName || job.referenceImageName || "AI产品镜任务", meta: (job) => job.taskChannelLabel || job.referenceImageName || (job.status === "draft" ? "待上传参考图" : (job.imageModelLabel || "生图任务")), progress: candidateProgress },
    { match: "replace-product.html", title: "一键换品任务", personalScope: true, endpoint: "./api/product-workflows/replacement-jobs?limit=50", createDraftEndpoint: "./api/product-workflows/replacement-jobs/drafts", reorderEndpoint: "./api/product-workflows/replacement-jobs/order", storageKey: "one-click-replacement-current-task-v1", draftKey: "one-click-replacement-draft-v1", insertAfter: ".rp-grid", deleteEndpoint: (job) => `./api/product-workflows/replacement-jobs/${encodeURIComponent(job.id)}`, renameEndpoint: (job) => `./api/product-workflows/replacement-jobs/${encodeURIComponent(job.id)}`, unwrap: (data) => data.jobs || [], details: (job) => job.taskName || job.referenceVideoName || "一键换品任务", meta: (job) => job.status === "draft" ? (job.productName || "待填写") : (job.productName || "换品任务"), progress: replacementProgress },
    { match: "koc.html", title: "AI-KOC任务", personalScope: true, endpoint: "./api/koc/jobs?limit=50", createDraftEndpoint: "./api/koc/jobs/drafts", reorderEndpoint: "./api/koc/jobs/order", storageKey: "product-shot-koc-job", draftKey: "brand-marketing-koc-draft-v287", deleteEndpoint: (job) => `./api/koc/jobs/${encodeURIComponent(job.id)}`, renameEndpoint: (job) => `./api/koc/jobs/${encodeURIComponent(job.id)}`, unwrap: (data) => Array.isArray(data) ? data : [], details: (job) => job.taskName || job.config?.productType || job.productName || "KOC视频", meta: (job) => job.productType || job.productName || "KOC视频", progress: genericProgress },
    { match: "variation.html", title: "单视频批量裂变任务", personalScope: true, endpoint: "./api/variation/jobs?limit=50", createDraftEndpoint: "./api/variation/jobs/drafts", storageKey: "ai-video-variation-current-job", additionalStorageKeys: ["ai-video-variation-job-v180"], draftKey: "ai-video-variation-reference-draft-v233", deleteEndpoint: (job) => `./api/variation/jobs/${encodeURIComponent(job.id)}`, renameEndpoint: (job) => `./api/variation/jobs/${encodeURIComponent(job.id)}`, unwrap: (data) => Array.isArray(data) ? data : [], details: (job) => job.taskName || job.referenceVideoName || "单视频批量裂变任务", meta: (job) => [job.targetProductName || "未指定产品", job.referenceVideoName || "母版待确认"].join(" · "), progress: genericProgress },
    { match: "one-click-remake.html", title: "一键做同款任务", personalScope: true, supportsConcurrentNewTasks: true, endpoint: "./api/one-click-remake/jobs", storageKey: "one-click-remake-current-job", draftKey: "one-click-remake-draft-v1", inlineSwitch: true, inlineLanding: "#taskLandingHost", deleteEndpoint: (job) => `./api/one-click-remake/jobs/${encodeURIComponent(job.id)}`, renameEndpoint: (job) => `./api/one-click-remake/jobs/${encodeURIComponent(job.id)}`, unwrap: (data) => data.items || [], details: (job) => job.taskName || "一键做同款任务", meta: (job) => [job.sourceProduct?.name || "原片产品待识别", job.canvas?.projectId ? "任务画布已创建" : "任务画布准备中"].join(" · "), progress: remakeProgress },
    { match: "/person-studio/", title: "AI明星画面任务", endpoint: "./api/person-jobs?limit=50", storageKey: "wis-person-studio-current-job", draftKey: "wis-person-studio-draft-v1", unwrap: (data) => Array.isArray(data) ? data : [], details: (job) => job.productName || job.config?.productName || job.sourceName || "人物视频", progress: genericProgress, queryKey: "job" }
  ];
  const config = configurations.find((item) => path.includes(item.match));
  if (!config) return;

  const requestedId = new URLSearchParams(window.location.search).get(config.queryKey || "task");
  if (requestedId) localStorage.setItem(config.storageKey, requestedId);
  let latestJobs = [];
  let activeRenameSession = null;
  let refreshEpoch = 0;
  let lastRenderSignature = "";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function statusLabel(status) {
    if (String(status || "") === "finalizing") return "拼接回传中";
    if (String(status || "") === "editing") return "修改中";
    return ({ queued: "排队中", auditing: "拆解中", preparing_history_remake: "复用模板中", awaiting_configuration: "待配置", preparing_mapping: "映射中", awaiting_mapping_confirmation: "待确认映射", preparing_assets: "准备资产", regenerating_image_candidates: "二轮生图中", resuming_interrupted_stage: "恢复中", awaiting_asset_confirmation: "待确认资产", creating_task_canvas: "创建画布", generating: "生成中", generating_video: "视频生成中", quality_retrying: "生成第2轮", archiving_result: "归档中", awaiting_manual_review: "待人工质检", generating_first_frame: "生成首帧", awaiting_first_frame: "提取完成", awaiting_first_frame_selection: "待确认首帧", first_frame_failed: "首帧失败", ready: "素材已就绪", ready_to_generate: "待生成视频", generation_started: "视频生成中", video_completed: "视频已完成", voiceover_verified: "口播已核验", awaiting_approval: "待确认", awaiting_review: "待审核方案", quality_checking: "AI参考检查中", compliance_deferred: "合规待继续", running: "生成中", downloading: "下载中", completed: "已完成", success: "已完成", partial: "部分完成", partial_success: "部分完成", partial_failure: "部分失败", failed: "失败", interrupted: "已中断", review_required: "待人工处理", cancelled: "已取消", saved: "已保存", draft: "草稿" })[String(status || "")] || "状态待更新";
  }

  function taskState(job) {
    return String(job.taskCenterStatus || job.status || "saved");
  }

  function taskStateClass(status) {
    return status === "video_completed" ? "success" : status;
  }

  function taskStatusLabel(job, status) {
    if (config.match === "product-studio.html") {
      if (status === "video_completed") return `视频已完成，数量：${Number(job.completedVideoCount || 0)}`;
      if (["failed", "interrupted", "partial_failure"].includes(status)) return "生成失败";
      if (status === "ready") return "素材已就绪";
    }
    return statusLabel(status);
  }

  function candidateProgress(job) {
    if (job.status === "draft") return job.referenceImageName ? "等待确认提示词" : "等待上传参考图";
    const candidates = Array.isArray(job.candidates) ? job.candidates : [];
    const completed = candidates.filter((item) => ["success", "failed"].includes(item.status)).length;
    let snapshot = null;
    try { snapshot = JSON.parse(localStorage.getItem("ai-product-studio-task-state-v1") || "null")?.jobs?.[job.id]; } catch {}
    const localLanes = Object.values(snapshot?.lanes || {});
    const serverLanes = Array.isArray(job.generatedVideos) ? job.generatedVideos : [];
    const videosDone = serverLanes.length ? serverLanes.filter((lane) => lane.hasOutput || ["failed", "interrupted"].includes(lane.status)).length : localLanes.filter((lane) => lane.outputUrl || lane.error).length;
    const videosActive = serverLanes.length || localLanes.filter((lane) => lane.jobId).length;
    const sceneText = candidates.length ? `${completed}/${Math.max(3, candidates.length)} 张场景图` : "场景图 0/3";
    return videosActive ? `${sceneText} · 视频 ${videosDone}/${videosActive}` : sceneText;
  }

  function replacementProgress(job) {
    if (job.status === "draft") return job.referenceVideoName ? "等待提交分析" : "等待上传参考视频";
    if (job.generatedJob) return genericProgress(job.generatedJob);
    const frames = Array.isArray(job.firstFrameCandidates) ? job.firstFrameCandidates : [];
    const completed = frames.filter((item) => ["success", "failed"].includes(item.status)).length;
    if (job.status === "first_frame_failed") return "首帧生成失败，可打开后重试";
    if (job.status === "review_required") return "结果需要人工复核";
    if (job.status === "generation_started") return "视频任务已提交";
    return frames.length ? `${completed}/${frames.length} 张首帧` : "参考视频已保存";
  }

  function genericProgress(job) {
    const tasks = Array.isArray(job.tasks) ? job.tasks : [];
    const completed = tasks.filter((item) => ["success", "completed"].includes(item.status)).length;
    if (tasks.length) return `${completed}/${tasks.length} 个结果`;
    const summaryTotal = Number(job.summary?.total || job.videoCount || 0);
    const summaryDone = Number(job.summary?.success || job.summary?.ready || 0) + Number(job.summary?.failed || 0);
    if (summaryTotal) return `${summaryDone}/${summaryTotal} 个结果`;
    const current = Number(job.progress?.completed ?? job.completed ?? 0);
    const total = Number(job.progress?.total ?? job.total ?? 0);
    return total ? `${current}/${total} 个结果` : statusLabel(job.status);
  }

  function remakeProgress(job) {
    const targets = Array.isArray(job.targets) ? job.targets : [];
    if (!targets.length) return `${Math.round(Number(job.progress || 0))}% · ${statusLabel(job.status)}`;
    const done = targets.filter((item) => item.status === "success").length;
    return `${Math.round(Number(job.progress || 0))}% · ${done}/${targets.length} 个 SKU · ${statusLabel(job.status)}`;
  }

  function dateLabel(value) {
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return "时间未知";
    const parts = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value || "";
    return `${part("month")}/${part("day")} ${part("hour")}:${part("minute")}`;
  }

  function currentId() { return localStorage.getItem(config.storageKey) || ""; }

  async function writeClipboardText(value) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch {
        // 浏览器在标签页刚切换、失焦或剪贴板权限受限时可能拒绝异步 API，
        // 继续使用兼容复制，避免用户只能看到原生英文错误。
      }
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("浏览器未允许复制，请手动选择任务标题");
  }

  async function copyTaskTitle(title, button) {
    const taskName = String(title || "").trim();
    if (!taskName) return taskMessage("任务标题为空，无法复制", true);
    button.disabled = true;
    try {
      await writeClipboardText(taskName);
      button.classList.add("copied");
      button.setAttribute("aria-label", `已复制任务标题：${taskName}`);
      taskMessage(`已复制任务标题：${taskName}`);
      window.setTimeout(() => {
        if (!button.isConnected) return;
        button.classList.remove("copied");
        button.setAttribute("aria-label", `复制任务标题：${taskName}`);
      }, 1400);
    } catch (error) {
      taskMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  function localDraftHasContent() {
    try {
      if (config.match === "product-studio.html") {
        const snapshot = JSON.parse(localStorage.getItem("ai-product-studio-task-state-v1") || "null")?.jobs?.[currentId()] || {};
        const creative = JSON.parse(localStorage.getItem("creative-instruction-showcase-draft-v2") || "null") || {};
        return Boolean(
          snapshot.reference?.path
          || String(snapshot.prompt || "").trim()
          || snapshot.customCreative?.scene?.path
          || snapshot.customCreative?.jobId
          || creative.sceneAsset?.path
          || (creative.productAssets || []).length
          || String(creative.instruction || "").trim()
          || creative.job?.id
        );
      }
      if (config.match === "replace-product.html") {
        const snapshot = JSON.parse(localStorage.getItem(config.draftKey) || "null") || {};
        if (snapshot.taskId && snapshot.taskId !== currentId()) return false;
        return Boolean(snapshot.referenceUpload?.path || (snapshot.selectedAssetIds || []).length || (snapshot.temporaryAssets || []).length || String(snapshot.lockedScript || "").trim());
      }
    } catch {}
    return false;
  }

  function insertPanel() {
    if (document.querySelector("#moduleTaskCenter")) return null;
    const section = document.createElement("section");
    section.id = "moduleTaskCenter";
    section.className = config.inlineLanding ? "module-task-center module-task-center-inline" : "module-task-center";
    const personalScopeNote = config.personalScope
      ? '<span class="module-task-private-note">仅当前飞书账号可见，不同账号的任务、草稿和生成结果互不共享。</span>'
      : "";
    const concurrentTaskNote = config.supportsConcurrentNewTasks
      ? "当前任务运行中也可继续新建，多个任务独立并发处理。"
      : "";
    section.innerHTML = `<div class="module-task-head"><div><small>任务中心</small><h2>${escapeHtml(config.title)}</h2><p>任务会在后台持续运行，点击记录可恢复进度。${escapeHtml(concurrentTaskNote)}${personalScopeNote}</p></div><button class="module-task-collapse" id="moduleTaskCollapse" type="button" aria-label="收起任务中心" title="收起任务中心">‹</button></div><div class="module-task-actions"><span id="moduleTaskCount">正在读取</span><button id="moduleTaskRefresh" type="button">刷新</button><button class="primary" id="moduleTaskNew" type="button"${config.supportsConcurrentNewTasks ? ' title="不停止当前任务，打开新的 URL 和 TaskID 输入区"' : ""}>＋ 新建任务</button></div><p class="module-task-message" id="moduleTaskMessage" role="status" hidden></p><div class="module-task-list" id="moduleTaskList"><p class="module-task-empty">正在读取任务…</p></div>`;
    const inlineHost = config.inlineLanding ? document.querySelector(config.inlineLanding) : null;
    (inlineHost || document.body).append(section);
    if (!config.inlineLanding) {
      document.body.classList.add("module-task-fixed");
      section.querySelector("#moduleTaskCollapse").addEventListener("click", () => {
        const collapsed = section.classList.toggle("collapsed");
        section.querySelector("#moduleTaskCollapse").textContent = collapsed ? "›" : "‹";
        section.querySelector("#moduleTaskCollapse").setAttribute("aria-label", collapsed ? "展开任务中心" : "收起任务中心");
        document.body.classList.toggle("module-task-collapsed", collapsed);
      });
    } else {
      section.querySelector("#moduleTaskCollapse").hidden = true;
    }
    section.querySelector("#moduleTaskRefresh").addEventListener("click", refresh);
    section.querySelector("#moduleTaskNew").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      taskMessage(config.createDraftEndpoint ? "正在创建新任务草稿…" : "正在打开新任务…");
      try {
        let newTaskId = "";
        if (config.createDraftEndpoint) {
          const response = await fetch(config.createDraftEndpoint, {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ reuseDraftId: currentId(), forceNew: localDraftHasContent(), ...(config.createDraftPayload?.() || {}) })
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload.job?.id) throw new Error(payload.error || "任务草稿创建失败");
          newTaskId = payload.job.id;
        }
        window.dispatchEvent(new CustomEvent("module-task-new", { detail: { module: config.match, id: newTaskId } }));
        localStorage.removeItem(config.storageKey);
        (config.additionalStorageKeys || []).forEach((key) => localStorage.removeItem(key));
        localStorage.removeItem(config.draftKey);
        if (newTaskId) localStorage.setItem(config.storageKey, newTaskId);
        const url = new URL(window.location.href);
        url.searchParams.delete("new");
        if (newTaskId) url.searchParams.set(config.queryKey || "task", newTaskId);
        else url.searchParams.delete(config.queryKey || "task");
        if (config.inlineSwitch) {
          window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
          window.dispatchEvent(new CustomEvent("module-task-open", { detail: { module: config.match, id: newTaskId } }));
          await refresh();
          taskMessage(config.supportsConcurrentNewTasks ? "新任务输入区已打开，原任务继续在后台运行。" : "");
        } else {
          window.location.href = `${url.pathname}${url.search}${url.hash}`;
        }
      } catch (error) {
        taskMessage(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    return section;
  }

  function openTask(id) {
    localStorage.setItem(config.storageKey, id);
    const url = new URL(window.location.href);
    url.searchParams.set(config.queryKey || "task", id);
    if (config.inlineSwitch) {
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      window.dispatchEvent(new CustomEvent("module-task-open", { detail: { module: config.match, id } }));
      render(latestJobs);
      return;
    }
    window.location.href = `${url.pathname}${url.search}${url.hash}`;
  }

  function taskMessage(message, error = false) {
    const element = document.querySelector("#moduleTaskMessage");
    if (!element) return;
    element.hidden = !message;
    element.textContent = message || "";
    element.classList.toggle("error", error);
  }

  async function deleteTask(job, button) {
    if (!config.deleteEndpoint) return;
    const label = config.details(job);
    if (!window.confirm(`确定删除任务“${label}”吗？\n只删除任务记录，已生成的图片和视频文件会继续保留。`)) return;
    button.disabled = true;
    taskMessage("正在删除任务记录…");
    try {
      const response = await fetch(config.deleteEndpoint(job), { method: "DELETE", headers: { Accept: "application/json" } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "任务删除失败");
      window.dispatchEvent(new CustomEvent("module-task-deleted", { detail: { module: config.match, id: job.id } }));
      if (job.id === currentId()) {
        localStorage.removeItem(config.storageKey);
        const url = new URL(window.location.href);
        url.searchParams.delete(config.queryKey || "task");
        if (config.inlineSwitch) {
          window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
          window.dispatchEvent(new CustomEvent("module-task-open", { detail: { module: config.match, id: "" } }));
        } else {
          window.location.href = `${url.pathname}${url.search}${url.hash}`;
          return;
        }
      }
      taskMessage(payload.message || "任务记录已删除");
      await refresh();
    } catch (error) {
      taskMessage(error.message, true);
      button.disabled = false;
    }
  }

  async function renameTask(job, input, button) {
    if (activeRenameSession?.saving) return;
    const taskName = String(input.value || "").trim();
    if (!taskName) {
      input.focus();
      return taskMessage("任务名称不能为空", true);
    }
    activeRenameSession = { jobId: job.id, taskName, saving: true };
    button.disabled = true;
    input.disabled = true;
    try {
      const response = await fetch(config.renameEndpoint(job), {
        method: "PATCH",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ taskName })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "任务名称修改失败");
      if (!payload.job?.id) throw new Error("任务名称已提交，但服务端没有返回更新后的任务");
      const updatedJob = { ...job, ...payload.job };
      latestJobs = latestJobs.map((item) => item.id === updatedJob.id ? { ...item, ...updatedJob } : item);
      activeRenameSession = null;
      refreshEpoch += 1;
      render(latestJobs);
      taskMessage("任务名称已更新");
    } catch (error) {
      taskMessage(error.message, true);
      activeRenameSession = { jobId: job.id, taskName: String(input.value || ""), saving: false };
      button.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  function beginTaskRename(job, button) {
    if (activeRenameSession) return;
    const titleLine = button.closest(".module-task-title-line");
    if (!titleLine) return;
    const originalName = config.details(job);
    activeRenameSession = { jobId: job.id, taskName: originalName, saving: false };
    refreshEpoch += 1;
    titleLine.classList.add("editing");
    titleLine.innerHTML = `<input class="module-task-name-input" maxlength="40" value="${escapeHtml(originalName)}" aria-label="任务名称" autocomplete="off" /><button class="module-task-name-save" type="button" aria-label="保存任务名称">✓</button><button class="module-task-name-cancel" type="button" aria-label="取消修改">×</button>`;
    const input = titleLine.querySelector(".module-task-name-input");
    const saveButton = titleLine.querySelector(".module-task-name-save");
    let isComposing = false;
    let saveAfterComposition = false;
    saveButton.addEventListener("click", (event) => {
      event.stopPropagation();
      renameTask(job, input, saveButton);
    });
    titleLine.querySelector(".module-task-name-cancel").addEventListener("click", (event) => {
      event.stopPropagation();
      activeRenameSession = null;
      refreshEpoch += 1;
      render(latestJobs);
    });
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("input", () => {
      if (activeRenameSession?.jobId === job.id) activeRenameSession.taskName = input.value;
    });
    input.addEventListener("compositionstart", () => { isComposing = true; });
    input.addEventListener("compositionend", () => {
      isComposing = false;
      if (!saveAfterComposition) return;
      saveAfterComposition = false;
      window.setTimeout(() => renameTask(job, input, saveButton), 0);
    });
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        if (isComposing || event.isComposing || event.keyCode === 229) {
          saveAfterComposition = true;
          return;
        }
        event.preventDefault();
        renameTask(job, input, saveButton);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        activeRenameSession = null;
        refreshEpoch += 1;
        render(latestJobs);
      }
    });
    input.focus();
    input.select();
  }

  function beginLocalDraftRename(draft, button) {
    if (activeRenameSession) return;
    const titleLine = button.closest(".module-task-title-line");
    if (!titleLine) return;
    const originalName = String(draft.taskName || draft.uploads?.reference?.name || "已上传素材");
    activeRenameSession = { jobId: "local-draft", taskName: originalName, saving: false };
    refreshEpoch += 1;
    titleLine.classList.add("editing");
    titleLine.innerHTML = `<input class="module-task-name-input" maxlength="40" value="${escapeHtml(originalName)}" aria-label="草稿任务名称" autocomplete="off" /><button class="module-task-name-save" type="button" aria-label="保存草稿任务名称">✓</button><button class="module-task-name-cancel" type="button" aria-label="取消修改">×</button>`;
    const input = titleLine.querySelector(".module-task-name-input");
    const saveButton = titleLine.querySelector(".module-task-name-save");
    const save = () => {
      const taskName = String(input.value || "").trim();
      if (!taskName) return taskMessage("任务名称不能为空", true);
      const latestDraft = (() => {
        try { return JSON.parse(localStorage.getItem(config.draftKey) || "null") || draft; } catch { return draft; }
      })();
      latestDraft.taskName = taskName;
      latestDraft.updatedAt = new Date().toISOString();
      localStorage.setItem(config.draftKey, JSON.stringify(latestDraft));
      activeRenameSession = null;
      refreshEpoch += 1;
      window.dispatchEvent(new CustomEvent("module-task-local-draft-renamed", { detail: { module: config.match, taskName } }));
      render(latestJobs);
      taskMessage("任务名称已更新");
    };
    saveButton.addEventListener("click", (event) => { event.stopPropagation(); save(); });
    titleLine.querySelector(".module-task-name-cancel").addEventListener("click", (event) => {
      event.stopPropagation();
      activeRenameSession = null;
      refreshEpoch += 1;
      render(latestJobs);
    });
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        save();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        activeRenameSession = null;
        refreshEpoch += 1;
        render(latestJobs);
      }
    });
    input.focus();
    input.select();
  }

  function deleteLocalDraft() {
    if (!window.confirm("确定删除当前草稿吗？\n已上传但尚未提交的素材会一并清理。")) return;
    const event = new CustomEvent("module-task-local-draft-delete", {
      cancelable: true,
      detail: { module: config.match, draftKey: config.draftKey }
    });
    if (!window.dispatchEvent(event)) return;
    localStorage.removeItem(config.draftKey);
    window.location.reload();
  }

  async function persistTaskOrder(list) {
    const jobIds = [...list.querySelectorAll("[data-module-task-row-id]")].map((row) => row.dataset.moduleTaskRowId);
    if (!jobIds.length) return;
    taskMessage("正在保存任务排序…");
    try {
      const response = await fetch(config.reorderEndpoint, {
        method: "PATCH",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "任务排序保存失败");
      taskMessage("任务排序已保存");
      await refresh();
    } catch (error) {
      taskMessage(error.message, true);
      await refresh();
    }
  }

  function bindTaskOrdering(list) {
    if (!config.reorderEndpoint) return;
    let draggedRow = null;
    list.querySelectorAll("[data-module-task-drag]").forEach((handle) => {
      handle.addEventListener("dragstart", (event) => {
        draggedRow = handle.closest("[data-module-task-row-id]");
        if (!draggedRow) return event.preventDefault();
        draggedRow.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedRow.dataset.moduleTaskRowId);
      });
      handle.addEventListener("dragend", () => {
        draggedRow?.classList.remove("dragging");
        draggedRow = null;
      });
    });
    list.addEventListener("dragover", (event) => {
      if (!draggedRow) return;
      event.preventDefault();
      const target = event.target.closest("[data-module-task-row-id]");
      if (!target || target === draggedRow) return;
      const before = event.clientY < target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
      list.insertBefore(draggedRow, before ? target : target.nextSibling);
    });
    list.addEventListener("drop", (event) => {
      if (!draggedRow) return;
      event.preventDefault();
      draggedRow.classList.remove("dragging");
      draggedRow = null;
      persistTaskOrder(list);
    });
  }

  function render(jobs) {
    const list = document.querySelector("#moduleTaskList");
    const count = document.querySelector("#moduleTaskCount");
    if (!list || !count) return;
    latestJobs = Array.isArray(jobs) ? jobs : [];
    lastRenderSignature = JSON.stringify(latestJobs.map((job) => [job.id, job.taskName, job.status, job.progress, job.updatedAt, (job.targets || []).map((target) => [target.id, target.status, target.generationAttempt])]));
    const activeId = currentId();
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(config.draftKey) || "null"); } catch {}
    count.textContent = `${jobs.length} 个历史任务`;
    const rows = jobs.map((job) => {
      const isCurrent = job.id === activeId;
      const displayStatus = taskState(job);
      const displayStatusClass = taskStateClass(displayStatus);
      const metadata = [config.meta?.(job), config.progress(job), dateLabel(job.updatedAt || job.createdAt)].filter(Boolean).join(" · ");
      if (!config.deleteEndpoint) {
        return `<button class="module-task-row ${isCurrent ? "current" : ""}" type="button" data-module-task-id="${escapeHtml(job.id)}"><span class="module-task-state ${escapeHtml(displayStatusClass)}">${escapeHtml(taskStatusLabel(job, displayStatus))}</span><span class="module-task-copy"><b title="${escapeHtml(config.details(job))}">${escapeHtml(config.details(job))}</b><small>${escapeHtml(metadata)}</small></span><span class="module-task-open">${isCurrent ? "当前任务" : "打开"} →</span></button>`;
      }
      const deleteButton = config.deleteEndpoint
        ? `<button class="module-task-delete" type="button" data-module-task-delete="${escapeHtml(job.id)}" aria-label="删除任务 ${escapeHtml(config.details(job))}" title="删除任务">×</button>`
        : "";
      const dragHandle = config.reorderEndpoint ? `<span class="module-task-drag" draggable="true" data-module-task-drag title="拖动调整任务顺序" aria-label="拖动调整任务顺序">⋮⋮</span>` : "";
      const taskTitle = config.details(job);
      const editButton = config.renameEndpoint ? `<button class="module-task-edit" type="button" data-module-task-edit="${escapeHtml(job.id)}" aria-label="修改任务名称" title="修改任务名称"><span class="module-task-pencil" aria-hidden="true"></span></button>` : "";
      const copyButton = `<button class="module-task-copy-title" type="button" data-module-task-copy-title="${escapeHtml(job.id)}" aria-label="复制任务标题：${escapeHtml(taskTitle)}" title="复制任务标题"><span aria-hidden="true"></span></button>`;
      return `<div class="module-task-row module-task-row-with-delete ${config.reorderEndpoint ? "sortable" : ""} ${isCurrent ? "current" : ""}" data-module-task-row-id="${escapeHtml(job.id)}">${dragHandle}<div class="module-task-main" role="button" tabindex="0" data-module-task-id="${escapeHtml(job.id)}"><span class="module-task-state ${escapeHtml(displayStatusClass)}">${escapeHtml(taskStatusLabel(job, displayStatus))}</span><span class="module-task-copy"><span class="module-task-title-line">${editButton}<b title="${escapeHtml(taskTitle)}">${escapeHtml(taskTitle)}</b>${copyButton}</span><small>${escapeHtml(metadata)}</small></span><span class="module-task-open">${isCurrent ? "当前任务" : "打开"} →</span></div>${deleteButton}</div>`;
    });
    if (draft && !activeId) {
      const draftName = draft.taskName || draft.reference?.name || draft.referenceUpload?.name || draft.uploads?.reference?.name || "已上传素材";
      if (config.localDraftControls) {
        rows.unshift(`<div class="module-task-row module-task-row-with-delete draft"><div class="module-task-main"><span class="module-task-state saved">草稿</span><span class="module-task-copy"><span class="module-task-title-line"><button class="module-task-edit" type="button" data-module-draft-edit aria-label="修改草稿任务名称" title="修改任务名称"><span class="module-task-pencil" aria-hidden="true"></span></button><b title="${escapeHtml(draftName)}">${escapeHtml(draftName)}</b><button class="module-task-copy-title" type="button" data-module-draft-copy-title aria-label="复制任务标题：${escapeHtml(draftName)}" title="复制任务标题"><span aria-hidden="true"></span></button></span><small>已自动保存，可继续填写</small></span><span class="module-task-open">当前草稿</span></div><button class="module-task-delete" type="button" data-module-draft-delete aria-label="删除当前草稿" title="删除任务">×</button></div>`);
      } else {
        rows.unshift(`<div class="module-task-row draft"><span class="module-task-state saved">草稿</span><span class="module-task-copy"><b>${escapeHtml(draftName)}</b><small>已自动保存，可继续填写</small></span><span class="module-task-open">当前草稿</span></div>`);
      }
    }
    list.innerHTML = rows.join("") || '<p class="module-task-empty">还没有历史任务。上传素材后会自动保存草稿，提交后会出现在这里。</p>';
    list.querySelectorAll("[data-module-task-id]").forEach((button) => {
      button.addEventListener("click", () => openTask(button.dataset.moduleTaskId));
      button.addEventListener("keydown", (event) => {
        if (["Enter", " "].includes(event.key) && event.target === button) openTask(button.dataset.moduleTaskId);
      });
    });
    list.querySelectorAll("[data-module-task-edit]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      const job = jobs.find((item) => item.id === button.dataset.moduleTaskEdit);
      if (job) beginTaskRename(job, button);
    }));
    list.querySelectorAll("[data-module-task-copy-title]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      const job = jobs.find((item) => item.id === button.dataset.moduleTaskCopyTitle);
      if (job) copyTaskTitle(config.details(job), button);
    }));
    list.querySelectorAll("[data-module-task-delete]").forEach((button) => button.addEventListener("click", () => {
      const job = jobs.find((item) => item.id === button.dataset.moduleTaskDelete);
      if (job) deleteTask(job, button);
    }));
    list.querySelector("[data-module-draft-edit]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      beginLocalDraftRename(draft, event.currentTarget);
    });
    list.querySelector("[data-module-draft-copy-title]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      const title = draft?.taskName || draft?.reference?.name || draft?.referenceUpload?.name || draft?.uploads?.reference?.name || "已上传素材";
      copyTaskTitle(title, event.currentTarget);
    });
    list.querySelector("[data-module-draft-delete]")?.addEventListener("click", deleteLocalDraft);
    bindTaskOrdering(list);
  }

  async function refresh() {
    if (activeRenameSession) return;
    const requestedEpoch = refreshEpoch;
    const button = document.querySelector("#moduleTaskRefresh");
    if (button) button.disabled = true;
    try {
      const response = await fetch(config.endpoint, { headers: { Accept: "application/json" } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "任务列表读取失败");
      if (activeRenameSession || requestedEpoch !== refreshEpoch) return;
      const jobs = config.unwrap(payload);
      const nextSignature = JSON.stringify(jobs.map((job) => [job.id, job.taskName, job.status, job.progress, job.updatedAt, (job.targets || []).map((target) => [target.id, target.status, target.generationAttempt])]));
      if (nextSignature !== lastRenderSignature) render(jobs);
    } catch (error) {
      if (activeRenameSession || requestedEpoch !== refreshEpoch) return;
      const list = document.querySelector("#moduleTaskList");
      if (list) list.innerHTML = `<p class="module-task-empty error">${escapeHtml(error.message)}</p>`;
    } finally { if (button) button.disabled = false; }
  }

  function start() {
    if (!insertPanel()) return;
    refresh();
    window.addEventListener("module-task-updated", refresh);
    window.setInterval(refresh, 10000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
