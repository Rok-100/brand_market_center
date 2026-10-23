"use strict";

const $ = (selector) => document.querySelector(selector);
const PROXY_SAFE_UPLOAD_CHUNK_BYTES = 768 * 1024;
const CURRENT_JOB_KEY = "video-prompt-reverse-current-job-v1";
const state = {
  session: `prompt-reverse-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  upload: null,
  duration: 0,
  currentJobId: new URLSearchParams(location.search).has("new") ? "" : (new URLSearchParams(location.search).get("task") || localStorage.getItem(CURRENT_JOB_KEY) || ""),
  pollTimer: null
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body && !(options.body instanceof Blob) ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers
  });
  const type = response.headers.get("content-type") || "";
  const data = type.includes("json") ? await response.json() : await response.text();
  if (response.status === 401 && data?.loginRequired) location.href = "./login.html";
  if (response.status === 403 && data?.permissionRequired) location.href = "./access-denied.html?reason=permission";
  if (!response.ok) throw new Error(data?.error || data?.detail || data || `请求失败 ${response.status}`);
  return data;
}

function getMediaDuration(file) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => { const value = Number(video.duration || 0); URL.revokeObjectURL(url); resolve(Number.isFinite(value) ? value : 0); };
    video.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    video.src = url;
  });
}

function setUploadProgress(value) {
  const percent = Math.max(0, Math.min(100, Number(value || 0)));
  $("#reverseUploadProgress").hidden = percent <= 0 || percent >= 100;
  $("#reverseUploadBar").style.width = `${percent}%`;
}

async function uploadVideo(file) {
  if (!file) return;
  $("#reverseFormBadge").textContent = "上传中";
  $("#reverseSubmit").disabled = true;
  const params = new URLSearchParams({ kind: "prompt-reverse-video", name: file.name, session: state.session });
  let result;
  if (file.size <= PROXY_SAFE_UPLOAD_CHUNK_BYTES) {
    const response = await fetch(`./api/upload?${params}`, { method: "POST", body: file });
    result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "视频上传失败");
  } else {
    const uploadId = globalThis.crypto?.randomUUID?.() || `chunk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const totalChunks = Math.ceil(file.size / PROXY_SAFE_UPLOAD_CHUNK_BYTES);
    for (let index = 0; index < totalChunks; index += 1) {
      const query = new URLSearchParams({ ...Object.fromEntries(params), uploadId, index: String(index), totalChunks: String(totalChunks), totalSize: String(file.size) });
      const body = file.slice(index * PROXY_SAFE_UPLOAD_CHUNK_BYTES, Math.min(file.size, (index + 1) * PROXY_SAFE_UPLOAD_CHUNK_BYTES));
      const response = await fetch(`./api/upload/chunk?${query}`, { method: "POST", body });
      result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `视频分片上传失败（${index + 1}/${totalChunks}）`);
      setUploadProgress(((index + 1) / totalChunks) * 100);
    }
  }
  state.duration = await getMediaDuration(file);
  state.upload = { ...result, name: file.name };
  $("#reverseSourcePreview").innerHTML = `<video src="./api/file?path=${encodeURIComponent(result.path)}" controls preload="metadata"></video><div><b>${escapeHtml(file.name)}</b><span>${state.duration ? `${state.duration.toFixed(1)}秒 · ` : ""}${(file.size / 1024 / 1024).toFixed(1)}MB</span></div>`;
  $("#reverseFormBadge").textContent = "已上传";
  $("#reverseSubmit").disabled = false;
  setUploadProgress(100);
}

function renderSteps(job = {}) {
  const logs = (job.logs || []).map((item) => String(item.message || ""));
  const sourceDone = Boolean(job.outputDir) || logs.some((line) => line.includes("原片读取完成"));
  const analysisDone = Boolean(job.analysis) || logs.some((line) => line.includes("提示词逆推完成"));
  const promptDone = job.status === "success";
  const failed = job.status === "failed";
  const values = [sourceDone, analysisDone, promptDone];
  [...$("#reverseSteps").children].forEach((item, index) => {
    item.classList.toggle("done", values[index]);
    item.classList.toggle("active", !failed && !values[index] && (index === 0 || values[index - 1]));
    item.querySelector("em").textContent = values[index] ? "完成" : failed ? "停止" : item.classList.contains("active") ? "进行中" : "等待";
  });
}

function renderResult(job) {
  const result = job.reversePrompt;
  $("#reverseResult").hidden = !result;
  if (!result) return;
  $("#reverseResultMeta").textContent = `${result.originalShotCount || result.shotPrompts?.length || 0}个镜头 · ${job.analysisProvider?.provider || "AI多模态"} · 不调用LibTV`;
  $("#reverseSummary").textContent = result.summary || "已完成原片结构分析";
  $("#reverseMasterPrompt").value = result.masterPrompt || "";
  $("#reverseNegativePrompt").value = result.negativePrompt || "";
  const shots = Array.isArray(result.shotPrompts) ? result.shotPrompts : [];
  $("#reverseShotCount").textContent = `${shots.length}个结构镜头`;
  $("#reverseShotGrid").innerHTML = shots.map((shot) => `<article><header><b>${String(shot.index).padStart(2, "0")}</b><span>${Number(shot.start).toFixed(1)}-${Number(shot.end).toFixed(1)}秒</span></header><h4>${escapeHtml(shot.title)}</h4><p><b>镜头</b>${escapeHtml(shot.camera)}</p><p><b>动作</b>${escapeHtml(shot.action)}</p><p><b>产品</b>${escapeHtml(shot.product)}</p><p><b>衔接</b>${escapeHtml(shot.continuity)}</p></article>`).join("");
  if (job.files?.promptPath) {
    $("#reverseDownload").href = `./api/file?path=${encodeURIComponent(job.files.promptPath)}`;
    $("#reverseDownload").hidden = false;
  }
}

function renderJob(job) {
  const labels = { queued: "排队中", preparing: "分析中", success: "已完成", failed: "失败" };
  $("#reverseJobStatus").textContent = labels[job.status] || job.status || "等待";
  $("#reverseJobMessage").textContent = job.error || job.actionRequired || job.logs?.at(-1)?.message || "正在准备";
  $("#reverseProgressBar").style.width = job.status === "success" ? "100%" : job.status === "preparing" ? (job.analysis ? "82%" : job.outputDir ? "46%" : "18%") : job.status === "failed" ? "100%" : "8%";
  $("#reverseProgressBar").classList.toggle("failed", job.status === "failed");
  $("#reverseLogBox").textContent = (job.logs || []).map((row) => `[${new Date(row.at).toLocaleTimeString("zh-CN", { hour12: false })}] ${row.message}`).join("\n") || "暂无日志";
  renderSteps(job);
  renderResult(job);
}

async function pollJob() {
  clearTimeout(state.pollTimer);
  if (!state.currentJobId) return;
  try {
    const job = await api(`./api/video-prompt-reverse/jobs/${encodeURIComponent(state.currentJobId)}`);
    renderJob(job);
    if (["queued", "preparing"].includes(job.status)) state.pollTimer = setTimeout(pollJob, 2200);
    else await refreshHistory();
  } catch (error) {
    $("#reverseJobMessage").textContent = error.message;
  }
}

async function refreshHistory() {
  try {
    const rows = await api("./api/video-prompt-reverse/jobs?limit=8");
    $("#reverseHistoryList").innerHTML = rows.length ? rows.map((job) => `<button type="button" data-job="${escapeHtml(job.id)}"><b>${escapeHtml(job.taskName || "视频提示词逆推")}</b><span>${new Date(job.createdAt).toLocaleString("zh-CN", { hour12: false })} · ${escapeHtml(job.status)}</span></button>`).join("") : "<p>还没有逆推任务</p>";
    $("#reverseHistoryList").querySelectorAll("[data-job]").forEach((button) => button.addEventListener("click", () => {
      state.currentJobId = button.dataset.job;
      localStorage.setItem(CURRENT_JOB_KEY, state.currentJobId);
      pollJob();
      $("#reverseRunPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  } catch (error) {
    $("#reverseHistoryList").innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
}

async function initialize() {
  try {
    const credential = await api("./api/provider-credential/status");
    if (credential?.valid) {
      $("#reverseHealth").textContent = "个人 FanDo 模型授权可用 · Qwen 3.7 多模态";
    } else {
      $("#reverseHealth").innerHTML = '尚未导入可用的个人 FanDo 模型授权；<a href="./login.html">前往登录与授权</a>';
    }
  } catch (error) {
    $("#reverseHealth").textContent = error.message;
  }
  await refreshHistory();
  if (state.currentJobId) await pollJob();
}

$("#reverseVideoInput").addEventListener("change", async (event) => {
  try { await uploadVideo(event.target.files?.[0]); } catch (error) { $("#reverseFormBadge").textContent = "上传失败"; alert(error.message); }
  finally { event.target.value = ""; }
});
const dropZone = $("#reverseDropZone");
["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add("dragging"); }));
["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); }));
dropZone.addEventListener("drop", async (event) => { try { await uploadVideo(event.dataTransfer?.files?.[0]); } catch (error) { alert(error.message); } });
$("#reverseForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.upload) return alert("请先上传参考视频");
  $("#reverseSubmit").disabled = true;
  $("#reverseSubmit").textContent = "正在创建分析任务…";
  try {
    const workstation = window.WorkbenchWorkstation.identity();
    const result = await api("./api/video-prompt-reverse/jobs", { method: "POST", body: JSON.stringify({
      workstationId: workstation.id,
      workstationLabel: workstation.label,
      referenceVideoPath: state.upload.path,
      referenceVideoName: state.upload.name,
      sourceDuration: state.duration,
      focus: $("#reverseFocus").value.trim()
    }) });
    state.currentJobId = result.id;
    localStorage.setItem(CURRENT_JOB_KEY, result.id);
    await pollJob();
    $("#reverseRunPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) { alert(error.message); }
  finally { $("#reverseSubmit").disabled = false; $("#reverseSubmit").textContent = "开始逆推提示词"; }
});
$("#reverseCopy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("#reverseMasterPrompt").value); $("#reverseCopy").textContent = "已复制"; setTimeout(() => { $("#reverseCopy").textContent = "复制母提示词"; }, 1600); }
  catch { $("#reverseMasterPrompt").select(); document.execCommand("copy"); }
});
$("#reverseHistoryRefresh").addEventListener("click", refreshHistory);
initialize();
