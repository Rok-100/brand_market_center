const $ = (selector) => document.querySelector(selector);
const integratedHubMatch = window.location.pathname.match(/^\/(yxb|fd-026222)\/wis-marketing-hub\/modules\/material-workbench\//);
if (integratedHubMatch) {
  document.querySelectorAll('a[href="./"]').forEach((link) => {
    link.href = `/${integratedHubMatch[1]}/wis-marketing-hub/`;
    link.target = "_top";
  });
}
const state = {
  snapshot: null,
  clips: [],
  currentPlan: null,
  lastClipKey: "",
  lastOutputKey: "",
  clipView: "all",
  clipPage: 1,
  clipPageSize: 8,
  clipGridCollapsed: false,
  outputPage: 1,
  outputPageSize: 6,
  draggedPlanClipId: "",
  materialStatus: null,
  materialAssets: [],
  materialPage: 1,
  materialPages: 1,
  materialTotal: 0,
  materialTasks: [],
  publishQueueExpanded: false,
  outputListExpanded: false,
  selectedMaterialIds: new Set(),
  selectedOutputJobIds: new Set(),
  selectedOutputVariantIds: new Set(),
  activeTab: "material-center",
  classicMode: false,
  variantSource: "local_upload",
  draftPromptHandled: false,
  sharedIndexRefreshed: false,
  provider: null,
  qianchuan: null,
  qianchuanAccounts: [],
  qianchuanPlans: [],
  selectedQianchuanBatchAccountIds: new Set(),
  outputPublishBusy: false
};

const REMIX_TABS = ["material-center", "clip-library", "planning", "outputs"];
const REMIX_STORAGE_TTL = 7 * 24 * 60 * 60 * 1000;
const REMIX_STORAGE_KEYS = {
  draft: "remix-draft",
  filters: "remix-filters",
  activeTab: "remix-active-tab",
  outputSelections: "remix-output-selections"
};
const REMIX_FILTER_IDS = [
  "materialLibraryFilter", "materialKeyword", "materialProductFilter", "materialSourceFilter", "materialEffectiveFilter",
  "clipKeywordFilter", "clipProductFilter", "clipStageFilter",
  "planProduct", "planFramework", "planDuration", "planAudioMode"
];

function writeWorkspaceValue(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify({ value, savedAt: Date.now(), expiresAt: Date.now() + REMIX_STORAGE_TTL }));
  } catch {}
}

function readWorkspaceValue(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    if (!parsed || Number(parsed.expiresAt || 0) < Date.now()) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

function clearWorkspaceDraft() {
  Object.values(REMIX_STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
}

function hasPersistedWorkspaceDraft() {
  const draft = readWorkspaceValue(REMIX_STORAGE_KEYS.draft);
  const selections = readWorkspaceValue(REMIX_STORAGE_KEYS.outputSelections) || {};
  const filters = readWorkspaceValue(REMIX_STORAGE_KEYS.filters) || {};
  return Boolean(
    draft?.planId
    || (selections.jobIds || []).length
    || (selections.variantIds || []).length
    || String(filters.materialKeyword || "").trim()
    || String(filters.clipKeywordFilter || "").trim()
  );
}

function persistedFilters() {
  return Object.fromEntries(REMIX_FILTER_IDS.map((id) => {
    const node = document.getElementById(id);
    return [id, node?.value ?? ""];
  }));
}

function persistWorkspace() {
  writeWorkspaceValue(REMIX_STORAGE_KEYS.activeTab, state.activeTab);
  writeWorkspaceValue(REMIX_STORAGE_KEYS.filters, persistedFilters());
  writeWorkspaceValue(REMIX_STORAGE_KEYS.draft, state.currentPlan ? { planId: state.currentPlan.id, updatedAt: Date.now() } : null);
  writeWorkspaceValue(REMIX_STORAGE_KEYS.outputSelections, {
    jobIds: [...state.selectedOutputJobIds],
    variantIds: [...state.selectedOutputVariantIds]
  });
}

function restoreFilterControls() {
  const filters = readWorkspaceValue(REMIX_STORAGE_KEYS.filters) || {};
  Object.entries(filters).forEach(([id, value]) => {
    const node = document.getElementById(id);
    if (node && value !== undefined) node.value = value;
  });
  const selections = readWorkspaceValue(REMIX_STORAGE_KEYS.outputSelections) || {};
  state.selectedOutputJobIds = new Set((selections.jobIds || []).map(String));
  state.selectedOutputVariantIds = new Set((selections.variantIds || []).map(String));
}

function requestedInitialTab() {
  const query = new URLSearchParams(location.search).get("tab");
  if (query) {
    const index = Number(query);
    if (Number.isInteger(index) && REMIX_TABS[index - 1]) return REMIX_TABS[index - 1];
    if (REMIX_TABS.includes(query)) return query;
  }
  const saved = readWorkspaceValue(REMIX_STORAGE_KEYS.activeTab);
  return REMIX_TABS.includes(saved) ? saved : REMIX_TABS[0];
}

function switchRemixTab(tabId, options = {}) {
  const next = REMIX_TABS.includes(tabId) ? tabId : REMIX_TABS[0];
  state.activeTab = next;
  document.querySelectorAll("[data-remix-tab]").forEach((button) => {
    const active = button.dataset.remixTab === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll("[data-remix-panel]").forEach((panel) => {
    panel.hidden = !state.classicMode && panel.dataset.remixPanel !== next;
  });
  if (options.syncUrl !== false) {
    const url = new URL(location.href);
    url.searchParams.set("tab", String(REMIX_TABS.indexOf(next) + 1));
    history.replaceState(null, "", url);
  }
  if (options.persist !== false) persistWorkspace();
  if (options.focus === true) document.querySelector(`[data-remix-panel="${next}"]`)?.scrollIntoView({ block: "start" });
}

function setClassicMode(enabled) {
  state.classicMode = Boolean(enabled);
  document.querySelector(".remix-stage-nav")?.classList.toggle("classic", state.classicMode);
  $("#classicModeButton").textContent = state.classicMode ? "返回分步" : "经典长页";
  document.querySelectorAll("[data-remix-panel]").forEach((panel) => {
    panel.hidden = !state.classicMode && panel.dataset.remixPanel !== state.activeTab;
  });
}

function resetWorkspaceDraft() {
  clearWorkspaceDraft();
  state.currentPlan = null;
  state.selectedOutputJobIds.clear();
  state.selectedOutputVariantIds.clear();
  $("#planForm")?.reset();
  for (const id of REMIX_FILTER_IDS) {
    const node = document.getElementById(id);
    if (!node) continue;
    if (node.matches('input[type="search"]')) node.value = "";
    else if (node.options?.length) node.selectedIndex = 0;
  }
  $("#planPreview").innerHTML = '<div class="remix-empty">选择产品和框架后生成方案，这里会展示片段顺序与来源。</div>';
  state.lastOutputKey = "";
  switchRemixTab("material-center", { persist: false, focus: true });
  renderOutputs(state.snapshot || {});
  updateRemixTabCounts();
}

function updateRemixTabCounts() {
  const snapshot = state.snapshot || {};
  const pendingClips = Math.max(0, Number(snapshot.counts?.clips || 0) - Number(snapshot.counts?.approvedClips || 0));
  $("#tabMaterialCount").textContent = String(Number(state.materialTotal || snapshot.counts?.selectedVideos || 0));
  $("#tabClipCount").textContent = pendingClips ? `${snapshot.counts?.clips || 0} · 待审${pendingClips}` : String(snapshot.counts?.clips || 0);
  $("#tabPlanStatus").textContent = state.currentPlan ? `${state.currentPlan.clips?.length || 0}段` : "未编排";
  $("#tabOutputCount").textContent = String((snapshot.composeJobs || []).filter((job) => job.status === "success").length);
  document.querySelector('[data-remix-tab="clip-library"]')?.classList.toggle("warning", pendingClips > 0);
}

const STAGE_LABELS = {
  hook: "开头钩子",
  problem: "人群/痛点",
  product: "产品/方案",
  proof: "使用/证据",
  cta: "行动引导",
  ending: "结尾落版"
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mediaUrl(filePath) {
  if (/^https?:\/\//i.test(String(filePath || ""))) return filePath;
  return `./api/file?path=${encodeURIComponent(filePath || "")}`;
}

function imageUrl(filePath) {
  if (/^https?:\/\//i.test(String(filePath || ""))) return filePath;
  return `./api/image?path=${encodeURIComponent(filePath || "")}`;
}

function formatDuration(value) {
  const seconds = Number(value || 0);
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function showToast(message, kind = "info") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.dataset.kind = kind;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3500);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers,
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "操作未完成");
  return data;
}

function isoDate(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function renderQianchuan(status = {}) {
  state.qianchuan = status;
  const credentialsConfigured = Boolean(status.credentialsConfigured);
  const authorized = Boolean(status.authorized);
  const reauthorizationRequired = Boolean(status.reauthorizationRequired);
  const panel = $("#qianchuanConnector");
  panel.dataset.status = authorized ? "ready" : (reauthorizationRequired ? "error" : (credentialsConfigured ? "pending" : "idle"));
  $("#qianchuanTitle").textContent = authorized
    ? "千川官方API已授权"
    : (reauthorizationRequired ? "千川授权需要更新" : (credentialsConfigured ? "API凭证已保存，等待账户授权" : "尚未连接千川"));
  $("#qianchuanBadge").textContent = authorized ? "已授权" : (reauthorizationRequired ? "需重授权" : (credentialsConfigured ? "待授权" : "未连接"));
  $("#qianchuanMessage").textContent = authorized
    ? `官方OAuth令牌已加密保存；已授权${Number(status.accountCount || 0)}个账户，最近验证 ${formatDate(status.lastVerifiedAt)}`
    : (reauthorizationRequired
      ? "授权令牌已过期或权限范围发生变化，请点击“授权千川账户”重新授权；不需要再次填写 App Secret。"
      : (credentialsConfigured
      ? "点击“授权千川账户”进入巨量引擎官方授权页；无需再复制Cookie。"
      : "填写开放平台App Secret后，可通过官方API授权并上传成片到千川素材库。"));
  $("#qianchuanAppId").value = status.appId || "1871927445201475";
  const callbackNode = $("#qianchuanCallbackUrl");
  if (callbackNode) callbackNode.textContent = status.callbackUrl || "尚未配置";
  $("#qianchuanAuthorizeButton").disabled = !credentialsConfigured;
  $("#qianchuanLoadAccountsButton").disabled = !authorized;
  $("#qianchuanLoadPlansButton").disabled = !authorized || !$("#qianchuanAccount").value;
  $("#qianchuanSyncButton").disabled = !authorized;
  $("#qianchuanCheckButton").disabled = !authorized;
  $("#qianchuanDisconnectButton").disabled = !authorized;
  const authBadge = document.querySelector(".material-auth-badge");
  if (authBadge) authBadge.textContent = authorized ? "官方API已授权" : "等待API授权";
  const last = status.lastSync;
  if (last) {
    const summary = $("#qianchuanSummary");
    summary.hidden = false;
    summary.innerHTML = `
      <span>最近同步 <b>${escapeHtml(formatDate(last.syncedAt))}</b></span>
      <span>账户 <b>${escapeHtml(last.account?.advertiserName || "—")}</b></span>
      <span>计划 <b>${Number(last.totals?.plans || 0)}</b></span>
      <span>素材 <b>${Number(last.totals?.materials || 0)}</b></span>
      <span>消耗 <b>¥${Number(last.totals?.cost || 0).toFixed(2)}</b></span>
      <span>成交金额 <b>¥${Number(last.totals?.gmv || 0).toFixed(2)}</b></span>
      <span>成交订单 <b>${Number(last.totals?.orders || 0)}</b></span>
      <span>支付ROI <b>${Number(last.totals?.roi || 0).toFixed(2)}</b></span>
    `;
  }
  renderKpis();
  if (state.materialTasks?.length) renderPublishTasks(state.materialTasks);
  updateOutputPushToolbar();
}

async function loadQianchuanStatus() {
  try {
    renderQianchuan(await api("./api/qianchuan/status"));
  } catch (error) {
    $("#qianchuanConnector").dataset.status = "error";
    $("#qianchuanMessage").textContent = error.message;
  }
}

function selectedQianchuanAccount() {
  const advertiserId = $("#qianchuanAccount")?.value || "";
  return state.qianchuanAccounts.find((item) => item.advertiserId === advertiserId) || null;
}

function selectedQianchuanBatchAccountIds() {
  return [...state.selectedQianchuanBatchAccountIds];
}

function selectedQianchuanPlan() {
  if (!$("#qianchuanPlanSettings")?.open) return null;
  const key = $("#qianchuanPlan")?.value || "";
  return state.qianchuanPlans.find((item) => `${item.planType}:${item.planId}` === key) || null;
}

function renderQianchuanChoiceDetails() {
  const account = selectedQianchuanAccount();
  const plan = selectedQianchuanPlan();
  $("#qianchuanAccountDetail").innerHTML = account
    ? `<strong>${escapeHtml(account.advertiserName)}</strong><span>ID ${escapeHtml(account.advertiserId)} · ${escapeHtml(account.accountTypeLabel || account.accountType || "千川账户")} · ${escapeHtml(account.statusLabel || "授权有效")}${account.sourceEnterpriseId ? ` · 企业组织 ${escapeHtml(account.sourceEnterpriseId)}` : ""}</span>`
    : "尚未选择广告账户。";
  $("#qianchuanPlanDetail").innerHTML = plan
    ? `<strong>${escapeHtml(plan.planName)}</strong><span>ID ${escapeHtml(plan.planId)} · ${escapeHtml(plan.planTypeLabel)} · ${escapeHtml(plan.marketingGoalLabel || "")} · ${escapeHtml(plan.statusLabel || "")}</span><small>${escapeHtml(plan.attachHint || "")}</small>`
    : "未关联计划，将只上传到素材库。";
  $("#qianchuanLoadPlansButton").disabled = !state.qianchuan?.authorized || !account;
  renderPublishTasks(state.materialTasks || []);
  state.lastOutputKey = "";
  renderOutputs(state.snapshot || {});
  updateOutputPushToolbar();
}

function renderQianchuanAccounts() {
  const select = $("#qianchuanAccount");
  const previous = select.value;
  const checked = state.selectedQianchuanBatchAccountIds;
  const keyword = $("#qianchuanAccountKeyword").value.trim().toLowerCase();
  const matching = state.qianchuanAccounts.filter((item) => [
    item.advertiserName,
    item.advertiserId,
    item.accountTypeLabel,
    item.accountType
  ].some((value) => String(value || "").toLowerCase().includes(keyword)));
  // Keep every authorized account selectable. Search narrows the list without
  // silently discarding accounts returned later by the official API.
  const visible = matching;
  const previousItem = matching.find((item) => item.advertiserId === previous);
  if (previousItem && !visible.some((item) => item.advertiserId === previous)) visible.unshift(previousItem);
  select.innerHTML = visible.length
    ? visible.map((item) => `
      <option value="${escapeHtml(item.advertiserId)}">
        ${escapeHtml(item.advertiserName)} · …${escapeHtml(String(item.advertiserId).slice(-4))}
      </option>`).join("")
    : '<option value="">没有符合条件的已授权账户</option>';
  if (previous && visible.some((item) => item.advertiserId === previous)) select.value = previous;
  $("#qianchuanAccountCount").textContent = state.qianchuanAccounts.length
    ? `已读取 ${state.qianchuanAccounts.length} 个授权账户 · 当前显示 ${matching.length} 个`
    : "尚未读取账户";
  const batchList = $("#qianchuanBatchAccounts");
  const batchVisible = matching;
  batchList.innerHTML = batchVisible.length
    ? batchVisible.map((item) => `
      <label>
        <input type="checkbox" value="${escapeHtml(item.advertiserId)}" ${checked.has(item.advertiserId) ? "checked" : ""} />
        <span><strong>${escapeHtml(item.advertiserName)}</strong><small>ID ${escapeHtml(item.advertiserId)} · ${escapeHtml(item.accountTypeLabel || "千川账户")}</small></span>
      </label>`).join("")
    : "<small>当前筛选下没有可选账户</small>";
  renderQianchuanChoiceDetails();
}

function planMatchesFilter(plan) {
  const type = $("#qianchuanPlanType").value;
  const keyword = $("#qianchuanPlanKeyword").value.trim().toLowerCase();
  const typeMatch = type === "all"
    || (type === "attachable" && plan.canAttachVideo)
    || (type === "standard" && !plan.canAttachVideo);
  const textMatch = !keyword || [
    plan.planName,
    plan.planId,
    plan.planTypeLabel,
    plan.statusLabel,
    plan.productNames?.join(" ")
  ].some((value) => String(value || "").toLowerCase().includes(keyword));
  return typeMatch && textMatch;
}

function renderQianchuanPlans() {
  const select = $("#qianchuanPlan");
  const previous = select.value;
  const matching = state.qianchuanPlans.filter(planMatchesFilter);
  const visible = matching.slice(0, 30);
  const previousItem = matching.find((item) => `${item.planType}:${item.planId}` === previous);
  if (previousItem && !visible.some((item) => `${item.planType}:${item.planId}` === previous)) visible.unshift(previousItem);
  select.innerHTML = visible.length
    ? visible.map((item) => `
      <option value="${escapeHtml(`${item.planType}:${item.planId}`)}">
        ${escapeHtml(item.planName)} · …${escapeHtml(String(item.planId).slice(-4))} · ${escapeHtml(item.planTypeLabel)}
      </option>`).join("")
    : '<option value="">当前筛选下没有可选计划</option>';
  if (previous && visible.some((item) => `${item.planType}:${item.planId}` === previous)) select.value = previous;
  renderQianchuanChoiceDetails();
}

function qianchuanPushSelection() {
  const account = selectedQianchuanAccount();
  const plan = selectedQianchuanPlan();
  if (!account) throw new Error("请先读取并选择千川广告账户");
  const attachablePlan = plan?.canAttachVideo ? plan : null;
  return {
    advertiserId: account.advertiserId,
    planId: attachablePlan?.planId || "",
    planName: attachablePlan?.planName || "",
    planType: attachablePlan?.planType || "",
    planTypeLabel: attachablePlan?.planTypeLabel || "",
    marketingGoal: attachablePlan?.marketingGoal || "",
    marketingGoalLabel: attachablePlan?.marketingGoalLabel || ""
  };
}

function updateOutputPushToolbar() {
  const count = state.selectedOutputJobIds.size + state.selectedOutputVariantIds.size;
  $("#selectedOutputCount").textContent = `已选 ${count} 条`;
  const batchMode = Boolean($("#qianchuanBatchSettings")?.open);
  const batchReady = Boolean(batchMode && state.qianchuan?.authorized && count && selectedQianchuanBatchAccountIds().length && !state.outputPublishBusy);
  let ready = Boolean(state.qianchuan?.authorized && count && !state.outputPublishBusy);
  let selection = null;
  try {
    selection = qianchuanPushSelection();
  } catch {
    ready = false;
  }
  $("#batchPushOutputsButton").disabled = !ready;
  $("#batchPushOutputsButton").textContent = state.outputPublishBusy
    ? "正在上传"
    : (selection?.planId ? "批量上传并关联所选计划" : "批量上传到所选账户素材库");
  $("#batchUploadOutputsButton").hidden = !batchMode;
  $("#batchUploadOutputsButton").disabled = !batchReady;
  $("#batchUploadOutputsButton").textContent = state.outputPublishBusy ? "正在上传" : "批量上传到多账户素材库";
}

function selectedOutputTargets(jobIds = null) {
  const mainIds = jobIds === null ? [...state.selectedOutputJobIds] : (jobIds || []);
  const targets = mainIds.map((jobId) => ({ jobId: String(jobId), variantId: "" }));
  if (jobIds === null) {
    for (const variantId of state.selectedOutputVariantIds) {
      const variant = (Array.isArray(state.snapshot?.outputVariants) ? state.snapshot.outputVariants : [])
        .find((item) => item && String(item.id) === String(variantId));
      if (variant) targets.push({ jobId: String(variant.outputId), variantId: String(variant.id) });
    }
  }
  return targets;
}

function renderProvider(provider) {
  state.provider = provider || {};
  const ready = provider?.libtv?.ready;
  $("#providerCard").classList.toggle("ready", Boolean(ready));
  $("#providerTitle").textContent = ready ? `AI理解：${provider.activeProvider}` : "本地切片可用，AI理解待连接";
  $("#providerText").textContent = ready
    ? `可批量识别完整语句、镜头类型与成交角色；${provider?.localSpeech?.label || "使用AI语句边界"}`
    : "首页连接LibTV后可补齐AI标签；当前不影响导入和切片";
  const active = ["preparing", "running"].includes(state.snapshot?.analysisJob?.status);
  const needsLocalResegment = Number(state.snapshot?.counts?.sentenceCutVideos || 0)
    < Number(state.snapshot?.counts?.readyVideos || 0);
  $("#analyzeButton").disabled = active
    || (!ready && !needsLocalResegment)
    || Number(state.snapshot?.counts?.readyVideos || 0) < 1;
  if (state.snapshot) renderImport(state.snapshot);
}

async function loadProvider() {
  try {
    renderProvider(await api("./api/remix/provider-status"));
  } catch (error) {
    $("#providerTitle").textContent = "视频理解状态暂未读取";
    $("#providerText").textContent = error.message;
  }
}

function renderMaterialStatus(status) {
  state.materialStatus = status;
  const catalogReady = Boolean(status.connected || status.cacheReady || status.catalogReady);
  const ossOption = $("#materialLibraryFilter option[value='oss']");
  if (ossOption) {
    ossOption.textContent = status.cacheReady && !status.connected
      ? "WIS部门素材缓存"
      : "阿里云OSS全部库";
  }
  const banner = $("#materialStorageBanner");
  banner.dataset.status = catalogReady ? "ready" : "error";
  $("#materialStorageIcon").textContent = status.connected ? "DB" : (status.cacheReady ? "OSS" : "!");
  $("#materialStorageTitle").textContent = status.connected
    ? (status.objectStorageReady ? "阿里云OSS素材索引已连接" : "公司素材数据库已连接")
    : status.cacheReady
      ? "部门WIS素材缓存已连接"
      : "公司素材中心暂未连接";
  $("#materialStorageText").textContent = status.connected
    ? (status.objectStorageReady
      ? `可直接查询和预览 ${status.objectStorageDomain || "公司OSS"} 中的素材；新增上传需单独的OSS写入授权。`
      : `当前只能读取工作库元数据，视频对象存储尚未接通。`)
    : status.cacheReady
      ? `可直接查询和预览公司OSS中的WIS素材；当前为只读缓存${status.cacheGeneratedAt ? `，更新于${formatDate(status.cacheGeneratedAt)}` : ""}。`
      : (status.error || status.message || "连接失败");
  $("#materialStorageBadge").textContent = status.connected
    ? (status.objectStorageReady ? "OSS可查询" : "数据库可用")
    : status.cacheReady ? "只读可用" : "未连接";
  $("#syncMaterialButton").disabled = !status.connected;
  $("#syncMaterialButton").title = status.connected
    ? "把本机已整理的混剪素材同步到部门数据库"
    : "同事端使用部门只读缓存，无需重复同步；管理员主机连接数据库后可执行同步";
  $("#toggleMaterialUploadButton").disabled = !status.objectStorageWriteReady;
  $("#toggleMaterialUploadButton").title = status.objectStorageWriteReady
    ? "上传新素材到公司阿里云OSS"
    : "已有OSS素材可查询；新增上传需要Bucket与RAM写入授权";
  renderKpis();
}

async function loadMaterialStatus() {
  try {
    renderMaterialStatus(await api("./api/material-center/status"));
  } catch (error) {
    renderMaterialStatus({
      connected: false,
      message: "素材中心状态未读取",
      error: error.message,
      storageBackend: "local",
      summary: {}
    });
  }
}

function materialCard(asset) {
  const tags = [...(asset.tags || [])];
  if (asset.isEffective && !tags.includes("历史有效成片")) tags.unshift("历史有效成片");
  if (asset.hasPerformance && !tags.includes("有投放数据")) tags.unshift("有投放数据");
  const sourceLabels = {
    qianchuan: "千川素材",
    chanmama: "蝉妈妈素材",
    wechat_channel: "视频号素材",
    direct: "直接入库",
    feishu: "飞书历史库",
    upload: "部门上传",
    team_shared: "部门共享"
  };
  const videoSource = asset.filePath ? mediaUrl(asset.filePath) : "";
  const coverSource = asset.coverUrl ? imageUrl(asset.coverUrl) : "";
  const cover = videoSource
    ? `<video class="material-cover-video" src="${escapeHtml(videoSource)}" ${coverSource ? `poster="${escapeHtml(coverSource)}"` : ""} muted playsinline preload="metadata" aria-hidden="true"></video>`
    : coverSource
      ? `<img src="${escapeHtml(coverSource)}" alt="" loading="lazy" />`
      : `<div class="material-cover-placeholder" aria-hidden="true">等待视频封面</div>`;
  return `
    <article class="material-card ${state.selectedMaterialIds.has(asset.id) ? "selected" : ""}" data-material-id="${escapeHtml(asset.id)}">
      <label class="material-select" title="选择后加入共享切片库">
        <input type="checkbox" data-select-material="${escapeHtml(asset.id)}" ${state.selectedMaterialIds.has(asset.id) ? "checked" : ""} />
        <span>选入切片</span>
      </label>
      <div class="material-card-media">
        ${cover}
        <button type="button" data-play-material="${escapeHtml(asset.id)}" aria-label="播放素材">▶</button>
        <span>${asset.duration ? formatDuration(asset.duration) : "OSS"}</span>
      </div>
      <div class="material-card-body">
        <div class="material-card-title">
          <strong>${escapeHtml(asset.title || asset.fileName || "未命名素材")}</strong>
          <small>${escapeHtml(asset.productName || "暂未归品牌")} · ${escapeHtml(sourceLabels[asset.sourceType] || asset.sourceType || "素材库")}</small>
        </div>
        <div class="material-card-tags">
          ${tags.slice(0, 4).map((tag) => `<span class="${["历史有效成片", "有投放数据"].includes(tag) ? "effective" : ""}">${escapeHtml(tag)}</span>`).join("") || "<span>待补标签</span>"}
        </div>
        <div class="material-card-meta">
          <span><b>${Number(asset.clipCount || 0)}</b>片段</span>
          <span><b>${asset.performance?.roi ? Number(asset.performance.roi).toFixed(2) : "—"}</b>ROI</span>
          <span><b>${escapeHtml(asset.performance?.grade || (asset.width && asset.height ? `${asset.width}×${asset.height}` : "—"))}</b>${asset.performance?.grade ? "评级" : "画幅"}</span>
        </div>
        <div class="material-card-actions">
          <button type="button" data-play-material="${escapeHtml(asset.id)}">页面播放</button>
          <button type="button" data-cut-material="${escapeHtml(asset.id)}">加入切片库</button>
          <button type="button" data-queue-material="${escapeHtml(asset.id)}" ${state.materialStatus?.connected && asset.sourceType !== "team_shared" ? "" : "disabled"}>${asset.sourceType === "team_shared" ? "共享素材" : state.materialStatus?.connected ? "加入千川队列" : "只读素材"}</button>
        </div>
      </div>
    </article>
  `;
}

function renderMaterialPagination(page, pages) {
  const holder = $("#materialPagination");
  if (pages <= 1) {
    holder.innerHTML = "";
    return;
  }
  const candidates = [...new Set([1, page - 1, page, page + 1, pages])]
    .filter((item) => item >= 1 && item <= pages)
    .sort((a, b) => a - b);
  holder.innerHTML = `
    <button type="button" data-material-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>‹</button>
    ${candidates.map((item) => `<button type="button" data-material-page="${item}" class="${item === page ? "current" : ""}">${item}</button>`).join("")}
    <button type="button" data-material-page="${page + 1}" ${page >= pages ? "disabled" : ""}>›</button>
  `;
}

function renderMaterials(data) {
  state.materialAssets = data.items || [];
  state.materialPage = Number(data.page || 1);
  state.materialPages = Number(data.pages || 1);
  state.materialTotal = Number(data.total || 0);
  updateRemixTabCounts();
  const libraryLabel = data.library === "team"
    ? "部门共享有效成片"
    : data.library === "oss" ? "阿里云OSS素材" : "混剪工作库素材";
  $("#materialResultHint").textContent = `共 ${state.materialTotal} 条${libraryLabel} · 第 ${state.materialPage}/${state.materialPages} 页`;
  $("#materialGrid").innerHTML = state.materialAssets.length
    ? state.materialAssets.map(materialCard).join("")
    : `<div class="remix-empty">${state.materialStatus?.cacheReady && data.library !== "oss"
      ? "同事端的历史混剪工作库由管理员统一维护；请切换到“阿里云OSS全部库”查询WIS素材。"
      : "当前条件下没有素材。可以调整筛选条件后重试。"}</div>`;
  document.querySelectorAll(".material-cover-video").forEach((video) => {
    video.addEventListener("loadedmetadata", () => {
      try {
        if (Number(video.duration || 0) > 0.12) video.currentTime = 0.12;
      } catch {
        // 浏览器不允许定位首帧时仍会显示原始视频首帧。
      }
    }, { once: true });
  });
  renderMaterialPagination(state.materialPage, state.materialPages);
  renderMaterialSelection();
}

function renderMaterialSelection() {
  const count = state.selectedMaterialIds.size;
  const button = $("#addSelectedToClipsButton");
  button.disabled = count < 1;
  button.textContent = `加入切片库（${count}）`;
}

function selectClipView(view = "all") {
  state.clipView = view;
  document.querySelectorAll("[data-clip-view]").forEach((item) => {
    const active = item.dataset.clipView === view;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", active ? "true" : "false");
  });
}

async function addMaterialsToClipping(assetIds, triggerButton = null) {
  const ids = [...new Set((assetIds || []).filter(Boolean))];
  if (!ids.length) return;
  const button = $("#addSelectedToClipsButton");
  const perCardButton = triggerButton?.matches?.("[data-cut-material]") ? triggerButton : null;
  button.disabled = true;
  button.textContent = `正在下载并切片 0/${ids.length}`;
  if (perCardButton) {
    perCardButton.disabled = true;
    perCardButton.textContent = "正在切片…";
  }
  $("#clipFilterHint").textContent = `正在把 ${ids.length} 条素材加入共享切片库，请保持工作台开启。`;
  try {
    const sharedIds = ids.filter((id) => id.startsWith("feishu-asset:"));
    const materialIds = ids.filter((id) => !id.startsWith("feishu-asset:"));
    const completed = [];
    const failed = [];
    if (materialIds.length) {
      const result = await api("./api/material-center/add-to-clipping", {
        method: "POST",
        body: JSON.stringify({ assetIds: materialIds })
      });
      completed.push(...(result.completed || []).map((item) => item.assetId));
      failed.push(...(result.failed || []));
    }
    for (let index = 0; index < sharedIds.length; index += 1) {
      button.textContent = `正在恢复共享切片 ${index + 1}/${sharedIds.length}`;
      try {
        await api("./api/team-workbench/import-source", {
          method: "POST",
          body: JSON.stringify({ recordKey: sharedIds[index] })
        });
        completed.push(sharedIds[index]);
      } catch (error) {
        failed.push({ assetId: sharedIds[index], error: error.message });
      }
    }
    for (const assetId of completed) state.selectedMaterialIds.delete(assetId);
    selectClipView("all");
    state.clipPage = 1;
    showToast(
      failed.length
        ? `已完成${completed.length}条，${failed.length}条需要重试；已切换到全部片段`
        : `已把${completed.length}条素材加入共享切片库；已切换到全部片段`,
      failed.length ? "info" : "success"
    );
    await loadState();
    await loadClips(true);
    await loadMaterials(state.materialPage);
    switchRemixTab("clip-library", { focus: true });
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    if (perCardButton?.isConnected) {
      perCardButton.disabled = false;
      perCardButton.textContent = "加入切片库";
    }
    renderMaterialSelection();
  }
}

async function loadMaterials(page = state.materialPage || 1) {
  try {
    const library = $("#materialLibraryFilter").value;
    if (library === "team") {
      const query = new URLSearchParams({
        type: "source_asset",
        keyword: $("#materialKeyword").value.trim(),
        page: String(page),
        pageSize: "12"
      });
      const shared = await api(`./api/team-workbench/resources?${query}`);
      renderMaterials({
        ...shared,
        library: "team",
        items: (Array.isArray(shared.items) ? shared.items : [])
          .filter((item) => item && typeof item === "object")
          .filter((item) => !$("#materialProductFilter").value || String(item.productName || "").includes($("#materialProductFilter").value))
          .map((item) => ({
            id: item.recordKey,
            title: item.title,
            productName: item.productName,
            sourceType: "team_shared",
            sourceUrl: item.sourceUrl,
            filePath: item.storageUrl,
            storageUrl: item.storageUrl,
            duration: Number(item.metadata?.duration || 0),
            width: Number(item.metadata?.width || 0),
            height: Number(item.metadata?.height || 0),
            clipCount: Number(item.metadata?.clipCount || 0),
            isEffective: item.approved === true,
            tags: [
              "飞书首批50条",
              item.metadata?.effectiveLabel || "历史有效成片",
              item.metadata?.sharedStorageReady ? "云端可用" : "等待云端上传"
            ].filter(Boolean),
            performance: {}
          }))
      });
      return;
    }
    const query = new URLSearchParams({
      library,
      keyword: $("#materialKeyword").value.trim(),
      brand: $("#materialProductFilter").value,
      sourceType: $("#materialSourceFilter").value,
      hasPerformance: $("#materialEffectiveFilter").value,
      page: String(page),
      pageSize: "12"
    });
    renderMaterials(await api(`./api/material-center/assets?${query}`));
  } catch (error) {
    $("#materialResultHint").textContent = "素材查询未完成";
    $("#materialGrid").innerHTML = `<div class="remix-empty">${escapeHtml(error.message)}</div>`;
  }
}

function renderPublishTasks(tasks) {
  state.materialTasks = tasks || [];
  updateRemixTabCounts();
  const authorized = Boolean(state.qianchuan?.authorized);
  const advertiserId = $("#qianchuanAccount")?.value || "";
  const selectedPlan = selectedQianchuanPlan();
  const batchMode = Boolean($("#qianchuanBatchSettings")?.open);
  const batchAccountIds = selectedQianchuanBatchAccountIds();
  const statusLabels = {
    waiting_auth: "等待API授权",
    queued: "待推送",
    pushing: "正在上传",
    partial: "部分账户已上传",
    success: "已上传完成",
    failed: "上传或关联失败"
  };
  const collapsedLimit = 5;
  const hiddenCount = Math.max(0, state.materialTasks.length - collapsedLimit);
  const visibleTasks = state.publishQueueExpanded ? state.materialTasks : state.materialTasks.slice(0, collapsedLimit);
  const publishToggle = $("#publishQueueToggle");
  if (publishToggle) {
    publishToggle.hidden = state.materialTasks.length <= collapsedLimit;
    publishToggle.textContent = state.publishQueueExpanded ? "收起队列" : `展开全部 ${state.materialTasks.length} 条`;
  }
  $("#materialPublishList").innerHTML = state.materialTasks.length
    ? visibleTasks.map((task) => {
      const deliveries = Array.isArray(task.payload?.deliveries) ? task.payload.deliveries : [];
      const deliverySuccess = deliveries.filter((item) => item.status === "success").length;
      const deliveryFailed = deliveries.filter((item) => item.status === "failed").length;
      const performance = task.payload?.performance || null;
      const alreadyAttached = Boolean(task.payload?.attachedAt && task.payload?.planId);
      const canRunPrimaryUpload = task.status !== "success" || (selectedPlan?.canAttachVideo && !alreadyAttached);
      const primaryUploadLabel = selectedPlan?.canAttachVideo
        ? (task.status === "success" ? "关联到所选计划" : (task.status === "failed" ? "重试上传并关联" : "上传并关联所选计划"))
        : (task.status === "failed" ? "重新上传到素材库" : "上传到所选账户素材库");
      return `
      <article class="material-publish-item">
        <div>
          <strong>${escapeHtml(task.title || "未命名素材")}</strong>
          <small>${escapeHtml(task.productName || "暂未归产品")} · ${formatDate(task.requestedAt)} · ${escapeHtml(task.platform || "qianchuan")}</small>
          ${(task.planName || task.payload?.planName) ? `<small>目标计划：${escapeHtml(task.planName || task.payload?.planName)} · ${escapeHtml(task.planId || task.payload?.planId || "")}</small>` : ""}
          ${task.externalMaterialId ? `<small>千川素材ID：${escapeHtml(task.externalMaterialId)}</small>` : ""}
          ${deliveries.length ? `<small>多账户上传：成功 ${deliverySuccess}/${deliveries.length}${deliveryFailed ? ` · 失败 ${deliveryFailed}` : ""}</small>` : ""}
          ${performance ? `<small>投放回流：消耗 ¥${Number(performance.cost || 0).toFixed(2)} · 成交 ¥${Number(performance.gmv || 0).toFixed(2)} · 订单 ${Number(performance.orders || 0)} · ROI ${Number(performance.roi || 0).toFixed(2)}</small>` : ""}
          ${task.payload?.attachWarning ? `<small class="warning-text">${escapeHtml(task.payload.attachWarning)}</small>` : ""}
          ${task.errorMessage ? `<small class="error-text">${escapeHtml(task.errorMessage)}</small>` : ""}
        </div>
        <div class="material-publish-actions">
          <span>${escapeHtml(statusLabels[task.status] || task.status)}</span>
          ${batchMode && (task.status !== "success" || !deliveries.length) ? `
            <button class="secondary-button" type="button" data-upload-task="${escapeHtml(task.id)}"
              ${!authorized || !batchAccountIds.length || task.status === "pushing" ? "disabled" : ""}>
              ${task.status === "partial" || task.status === "failed" ? "重试多账户上传" : "上传到多个账户素材库"}
            </button>` : ""}
          ${canRunPrimaryUpload ? `
            <button class="secondary-button" type="button" data-push-task="${escapeHtml(task.id)}"
              ${!authorized || !advertiserId || task.status === "pushing" ? "disabled" : ""}>
              ${primaryUploadLabel}
            </button>` : ""}
        </div>
      </article>
    `; }).join("") + (!state.publishQueueExpanded && hiddenCount
      ? `<button class="queue-more-button" type="button" data-expand-publish-queue>还有 ${hiddenCount} 条，仅显示当前登录人的最近记录，点击展开</button>`
      : "")
    : '<div class="remix-empty">还没有待推送任务。</div>';
}

async function loadPublishTasks() {
  try {
    const data = await api("./api/material-center/publish-tasks");
    renderPublishTasks(data.tasks || []);
  } catch (error) {
    $("#materialPublishList").innerHTML = `<div class="remix-empty">${escapeHtml(error.message)}</div>`;
  }
}

function renderKpis() {
  const summary = state.materialStatus?.summary || {};
  $("#materialAssetCount").textContent = Number(summary.externalAssets || summary.assets || 0).toLocaleString("zh-CN");
  $("#materialEffectiveCount").textContent = `有投放数据 ${Number(summary.performanceAssets || 0).toLocaleString("zh-CN")}`;
  $("#materialClipCount").textContent = Number(summary.clips || 0);
  $("#materialDatabaseStatus").textContent = state.materialStatus?.connected
    ? "公司MySQL已连接"
    : state.materialStatus?.cacheReady ? "部门只读缓存可用" : "素材中心暂未连接";
  $("#materialStorageSize").textContent = Number(summary.wisAssets || 0).toLocaleString("zh-CN");
  $("#materialStorageStatus").textContent = state.materialStatus?.objectStorageReady ? "OSS视频可直接预览" : "OSS索引未连接";
  $("#materialPublishCount").textContent = Number(summary.pendingPublish || 0);
  $("#materialPublishStatus").textContent = state.qianchuan?.authorized ? "千川官方API已授权，可人工推送" : "等待API授权";
}

function renderImport(snapshot) {
  const job = snapshot.importJob || {};
  const percent = Math.max(0, Math.min(100, Number(job.percent || 0)));
  $("#importStatus").textContent = job.status === "success" ? "导入与切片已完成" : (job.message || "尚未导入");
  $("#importPercent").textContent = `${percent}%`;
  $("#importProgressBar").style.width = `${percent}%`;
  $("#importMessage").textContent = job.error || job.message || "点击上方按钮开始；素材不会自动删除。";
  $("#importProgress").dataset.status = job.status || "idle";
  const active = ["preparing", "running"].includes(job.status);
  const importReady = state.provider?.feishuImport?.ready !== false;
  $("#importButton").disabled = active || !importReady;
  $("#importButton").textContent = active
    ? `处理中 ${job.current || 0}/${job.total || 50}`
    : !importReady ? "由管理员统一导入" : job.status === "success" ? "重新检查并继续" : "导入并自动切片";
  if (!importReady && job.status !== "success") {
    $("#importStatus").textContent = "首批素材已由管理员统一维护";
    $("#importMessage").textContent = state.provider?.feishuImport?.message || "同事端请直接使用上方部门素材中心，无需重复导入。";
    $("#importProgress").dataset.status = "success";
  }
}

function elapsedLabel(job) {
  if (!job?.startedAt) return "耗时 0分钟";
  const end = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.floor((end - new Date(job.startedAt).getTime()) / 1000));
  if (seconds < 60) return `耗时 ${seconds}秒`;
  return `耗时 ${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

function analysisStatusLabel(job, snapshot) {
  const labels = {
    idle: "尚未运行AI理解",
    interrupted: "上次识别被中断",
    running: "AI视频理解正在运行",
    preparing: "正在准备AI视频理解",
    success: Number(snapshot?.counts?.sentenceCertifiedVideos || 0) >= Number(snapshot?.counts?.readyVideos || 0)
      ? "AI理解与完整语句切片已完成"
      : Number(snapshot?.counts?.sentenceCutVideos || 0) >= Number(snapshot?.counts?.readyVideos || 0)
        ? "AI语义边界切片已完成"
        : "AI理解已完成，等待语义边界重切",
    partial: "AI理解已完成，部分素材需重试",
    failed: "AI视频理解未完成"
  };
  return labels[job?.status] || job?.message || "AI视频理解";
}

function renderAnalysis(snapshot) {
  const job = snapshot.analysisJob || {};
  const active = ["preparing", "running"].includes(job.status);
  const percent = Math.max(0, Math.min(100, Number(job.percent || 0)));
  const lastUpdate = job.lastUpdatedAt ? new Date(job.lastUpdatedAt).getTime() : Date.now();
  const stalled = active && Date.now() - lastUpdate > 180000;
  $("#analysisProgress").dataset.status = stalled ? "stalled" : (job.status || "idle");
  $("#analysisStatus").textContent = stalled ? "当前步骤耗时较长，仍在等待模型返回" : analysisStatusLabel(job, snapshot);
  $("#analysisMessage").textContent = job.message || "运行后会显示正在上传、识别、写标签和按完整语句重切的真实进度。";
  $("#analysisPercent").textContent = `${percent}%`;
  $("#analysisProgressBar").style.width = `${percent}%`;
  $("#analysisCurrent").textContent = job.currentItem
    ? `${job.current || 0}/${job.total || 0} · ${job.currentItem}`
    : `${job.current || 0}/${job.total || 0}`;
  const succeeded = Number.isFinite(Number(job.succeeded))
    ? Number(job.succeeded)
    : Number(snapshot.counts?.aiAnalyzedVideos || 0);
  const failed = Number.isFinite(Number(job.failed)) ? Number(job.failed) : 0;
  $("#analysisCounts").textContent = `成功 ${succeeded} · 失败 ${failed}`;
  $("#analysisElapsed").textContent = elapsedLabel(job);
  $("#analysisError").hidden = !job.error;
  $("#analysisError").textContent = job.error || "";
  $("#analyzeButton").disabled = active || Number(snapshot.counts?.readyVideos || 0) < 1;
  $("#analyzeButton").textContent = active
    ? `${job.phase === "segmenting" ? "安全重切中" : "AI识别中"} ${job.current || 0}/${job.total || 0}`
    : job.status === "partial" || job.status === "failed" || job.status === "interrupted"
      ? "重试未完成素材"
      : Number(snapshot.counts?.sentenceCutVideos || 0) < Number(snapshot.counts?.readyVideos || 0)
        ? "按AI语义边界重新切片"
        : Number(snapshot.counts?.sentenceCertifiedVideos || 0) < Number(snapshot.counts?.readyVideos || 0)
          ? "升级完整语句边界"
          : "重新检查AI视频理解";
}

function renderStageCounts(snapshot) {
  $("#stageCounts").innerHTML = Object.entries(STAGE_LABELS).map(([key, label]) => `
    <button type="button" data-stage-filter="${key}">
      <span>${escapeHtml(label)}</span>
      <strong>${Number(snapshot.stageCounts?.[key] || 0)}</strong>
    </button>
  `).join("");
}

function renderFrameworks(snapshot) {
  const select = $("#planFramework");
  const current = select.value;
  select.innerHTML = (snapshot.frameworks || []).map((framework) => `
    <option value="${escapeHtml(framework.id)}">${escapeHtml(framework.name)}</option>
  `).join("");
  if (current && [...select.options].some((option) => option.value === current)) select.value = current;
}

function renderClipViewCounts(snapshot) {
  const total = Number(snapshot.counts?.clips || 0);
  const approved = Number(snapshot.counts?.approvedClips || 0);
  $("#allClipTabCount").textContent = total;
  $("#pendingClipTabCount").textContent = Math.max(0, total - approved);
  $("#approvedClipTabCount").textContent = approved;
}

function renderOutputPagination(total) {
  const holder = $("#outputPagination");
  const pages = Math.max(1, Math.ceil(total / state.outputPageSize));
  state.outputPage = Math.max(1, Math.min(state.outputPage, pages));
  if (total <= state.outputPageSize) {
    holder.innerHTML = "";
    return;
  }
  const candidates = Array.from(new Set([
    1,
    state.outputPage - 1,
    state.outputPage,
    state.outputPage + 1,
    pages
  ].filter((page) => page >= 1 && page <= pages))).sort((a, b) => a - b);
  holder.innerHTML = `
    <span>共 ${total} 条 · 每页最多6条</span>
    <div>
      <button type="button" data-output-page="${state.outputPage - 1}" ${state.outputPage <= 1 ? "disabled" : ""}>上一页</button>
      ${candidates.map((page) => `<button type="button" data-output-page="${page}" class="${page === state.outputPage ? "current" : ""}">${page}</button>`).join("")}
      <button type="button" data-output-page="${state.outputPage + 1}" ${state.outputPage >= pages ? "disabled" : ""}>下一页</button>
    </div>
  `;
}

const VARIANT_TYPE_LABELS = {
  no_audio: "无声版本",
  landscape: "横版版本",
  digital_human: "数字人版本",
  custom: "自定义版本"
};

function outputVariantsFor(jobId, snapshot = state.snapshot || {}) {
  return (Array.isArray(snapshot.outputVariants) ? snapshot.outputVariants : [])
    .filter((item) => item && typeof item === "object")
    .filter((item) => String(item.outputId) === String(jobId));
}

function variantPlaybackPath(variant) {
  return variant?.storageUrl || variant?.filePath || "";
}

function primaryVariantFor(job, snapshot = state.snapshot || {}) {
  if (!job?.primaryVariantId) return null;
  return outputVariantsFor(job.id, snapshot)
    .find((variant) => String(variant.id) === String(job.primaryVariantId)) || null;
}

function primaryOutputPath(job, snapshot = state.snapshot || {}) {
  return variantPlaybackPath(primaryVariantFor(job, snapshot)) || job?.outputPath || "";
}

function renderOutputVariants(job, snapshot) {
  const variants = outputVariantsFor(job.id, snapshot);
  return `
    <details class="remix-output-variants" ${variants.length ? "" : "open"}>
      <summary><span>附加版本 ${variants.length}/5</span><small>可独立播放、推送或替换主版</small></summary>
      ${variants.length ? `<div class="variant-list">${variants.map((variant) => {
        const primary = String(job.primaryVariantId || "") === String(variant.id);
        const path = variantPlaybackPath(variant);
        return `
          <article class="variant-card ${primary ? "primary" : ""}">
            <button class="variant-thumb" type="button" data-play-variant="${escapeHtml(variant.id)}" aria-label="播放${escapeHtml(variant.title)}">
              <video src="${escapeHtml(mediaUrl(path))}#t=0.2" muted playsinline preload="metadata"></video>
            </button>
            <div class="variant-info">
              <label class="variant-select"><input type="checkbox" data-select-variant="${escapeHtml(variant.id)}" ${state.selectedOutputVariantIds.has(variant.id) ? "checked" : ""} />选择推送</label>
              <strong>${escapeHtml(variant.title || VARIANT_TYPE_LABELS[variant.type] || "附加版本")}</strong>
              <small>${primary ? "当前主版 · " : ""}${escapeHtml(VARIANT_TYPE_LABELS[variant.type] || "自定义版本")} · ${escapeHtml(variant.source === "oss_pull" ? "OSS" : variant.source === "ai_generated" ? "AI成片" : "本地上传")}</small>
              <div class="variant-actions">
                <button type="button" data-play-variant="${escapeHtml(variant.id)}">播放</button>
                ${primary
                  ? `<button type="button" data-primary-main="${escapeHtml(job.id)}">恢复原主版</button>`
                  : `<button type="button" data-primary-variant="${escapeHtml(variant.id)}" data-output-id="${escapeHtml(job.id)}">设为主版</button>`}
                <button class="danger" type="button" data-delete-variant="${escapeHtml(variant.id)}">删除</button>
              </div>
            </div>
          </article>`;
      }).join("")}</div>` : '<div class="remix-empty">还没有附加版本。</div>'}
      ${variants.length < 5 ? `<button class="variant-add-button" type="button" data-add-variant="${escapeHtml(job.id)}">＋ 添加附加版本</button>` : ""}
    </details>`;
}

function renderOutputs(snapshot) {
  const jobs = snapshot.composeJobs || [];
  const outputKey = JSON.stringify(jobs.map((job) => [
    job.id, job.status, job.percent, job.current, job.message, job.error,
    job.outputPath, job.outputDir, job.audioMode, job.primaryVariantId
  ]).concat([
    (Array.isArray(snapshot.outputVariants) ? snapshot.outputVariants : [])
      .filter((item) => item && typeof item === "object")
      .map((item) => [item.id, item.outputId, item.title, item.type, item.source, item.filePath, item.storageUrl]),
    state.outputPage,
    Boolean(state.outputListExpanded),
    [...state.selectedOutputJobIds].sort(),
    [...state.selectedOutputVariantIds].sort(),
    selectedQianchuanBatchAccountIds().sort(),
    Boolean($("#qianchuanBatchSettings")?.open),
    Boolean($("#qianchuanPlanSettings")?.open),
    $("#qianchuanAccount")?.value || "",
    $("#qianchuanPlan")?.value || ""
  ]));
  if (outputKey === state.lastOutputKey) return;
  state.lastOutputKey = outputKey;
  if (!jobs.length) {
    $("#outputList").innerHTML = '<div class="remix-empty">还没有混剪合成任务。</div>';
    $("#outputPagination").innerHTML = "";
    const outputToggle = $("#outputListToggle");
    if (outputToggle) outputToggle.hidden = true;
    return;
  }
  const pages = Math.max(1, Math.ceil(jobs.length / state.outputPageSize));
  state.outputPage = Math.max(1, Math.min(state.outputPage, pages));
  const start = (state.outputPage - 1) * state.outputPageSize;
  const pageJobs = jobs.slice(start, start + state.outputPageSize);
  const outputCollapsedLimit = 2;
  const visibleJobs = state.outputListExpanded ? pageJobs : pageJobs.slice(0, outputCollapsedLimit);
  const outputToggle = $("#outputListToggle");
  if (outputToggle) {
    outputToggle.hidden = pageJobs.length <= outputCollapsedLimit;
    outputToggle.textContent = state.outputListExpanded ? "收起本页" : `展开本页 ${pageJobs.length} 条`;
  }
  let pushSelection = null;
  try {
    pushSelection = qianchuanPushSelection();
  } catch {}
  const pushReady = Boolean(state.qianchuan?.authorized && pushSelection);
  const singlePushLabel = pushSelection?.planId ? "上传并关联所选计划" : "上传到所选账户素材库";
  const batchMode = Boolean($("#qianchuanBatchSettings")?.open);
  const batchUploadReady = Boolean(batchMode && state.qianchuan?.authorized && selectedQianchuanBatchAccountIds().length);
  $("#outputList").innerHTML = visibleJobs.map((job) => {
    const currentOutputPath = primaryOutputPath(job, snapshot);
    return `
    <article class="remix-output-card" data-status="${escapeHtml(job.status)}">
      <div>
        ${job.outputPath && job.status === "success" ? `
          <label class="remix-output-select">
            <input type="checkbox" data-select-output="${escapeHtml(job.id)}" ${state.selectedOutputJobIds.has(job.id) ? "checked" : ""} />
            <span>选择推送</span>
          </label>` : ""}
        <span>${escapeHtml(job.productName || "AI智能混剪")}${job.primaryVariantId ? " · 已替换主版" : " · 原主版"}</span>
        <strong>${escapeHtml(job.message || job.status)}</strong>
        <small>${job.error ? escapeHtml(job.error) : `${Number(job.percent || 0)}% · ${job.current || 0}/${job.total || 0}个片段 · ${escapeHtml(job.audioModeLabel || "人声优先")}`}</small>
      </div>
      ${currentOutputPath ? `
        <div class="remix-output-preview">
          <video class="remix-output-video-preview" src="${escapeHtml(mediaUrl(currentOutputPath))}#t=0.2" muted playsinline preload="metadata"></video>
          <button class="remix-output-play" type="button" data-play-output="${escapeHtml(job.id)}" aria-label="单独播放这条成片">▶</button>
          <small>${job.metadata?.duration ? formatDuration(job.metadata.duration) : "成片已生成"}</small>
        </div>
        <div class="remix-output-actions">
          <button type="button" data-play-output="${escapeHtml(job.id)}">在页面单独播放</button>
          <button type="button" data-open-file="${escapeHtml(job.id)}">用系统播放器打开</button>
          ${job.outputDir ? `<button type="button" data-open-output="${escapeHtml(job.id)}">打开所在文件夹</button>` : ""}
          ${job.status === "success" && batchMode ? `<button class="qianchuan-upload-button" type="button" data-upload-output="${escapeHtml(job.id)}" ${!batchUploadReady || state.outputPublishBusy ? "disabled" : ""}>上传到多账户素材库</button>` : ""}
          ${job.status === "success" ? `<button class="qianchuan-push-button" type="button" data-push-output="${escapeHtml(job.id)}" ${!pushReady || state.outputPublishBusy ? "disabled" : ""}>${singlePushLabel}</button>` : ""}
          <button class="danger-button" type="button" data-delete-output="${escapeHtml(job.id)}">删除无效成片</button>
        </div>
      ` : `
        <div class="remix-output-actions">
          <button class="danger-button" type="button" data-delete-output="${escapeHtml(job.id)}">移除无效记录</button>
        </div>
      `}
      ${job.status === "success" ? renderOutputVariants(job, snapshot) : ""}
    </article>
  `;
  }).join("");
  renderOutputPagination(jobs.length);
  updateOutputPushToolbar();
}

function renderSnapshot(snapshot) {
  state.snapshot = snapshot;
  const draft = readWorkspaceValue(REMIX_STORAGE_KEYS.draft);
  if (!state.currentPlan && draft?.planId) {
    const savedPlan = (snapshot.plans || []).find((item) => String(item.id) === String(draft.planId));
    if (savedPlan) renderPlan(savedPlan);
  }
  renderKpis(snapshot);
  renderImport(snapshot);
  renderAnalysis(snapshot);
  renderStageCounts(snapshot);
  renderFrameworks(snapshot);
  renderClipViewCounts(snapshot);
  renderOutputs(snapshot);
  updateRemixTabCounts();
}

async function loadState() {
  try {
    const snapshot = await api("./api/remix/state");
    const oldCount = Number(state.snapshot?.counts?.clips || 0);
    renderSnapshot(snapshot);
    const newCount = Number(snapshot.counts?.clips || 0);
    if (newCount !== oldCount && newCount > 0) await loadClips(true);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function clipCard(clip) {
  const stageOptions = Object.entries(STAGE_LABELS).map(([key, label]) => `
    <option value="${key}" ${clip.stage === key ? "selected" : ""}>${escapeHtml(label)}</option>
  `).join("");
  return `
    <article class="remix-clip-card" data-clip-id="${escapeHtml(clip.id)}">
      <div class="remix-clip-media">
        ${clip.thumbnailPath
          ? `<img src="${imageUrl(clip.thumbnailPath)}" alt="${escapeHtml(clip.stageLabel || "片段缩略图")}" loading="lazy" />`
          : `<video src="${mediaUrl(clip.filePath)}#t=0.2" muted preload="metadata" playsinline aria-label="${escapeHtml(clip.stageLabel || "共享片段")}"></video>`}
        <button type="button" data-play-clip="${escapeHtml(clip.id)}">▶</button>
        <span>${formatDuration(clip.duration)}</span>
      </div>
      <div class="remix-clip-content">
        <div class="remix-clip-source">
          <strong>${escapeHtml(clip.productName)}</strong>
          <small>来源第${clip.sourceRank}条 · ${Number(clip.start || 0).toFixed(1)}–${Number(clip.end || 0).toFixed(1)}秒</small>
        </div>
        <label>片段角色
          <select data-clip-stage="${escapeHtml(clip.id)}">${stageOptions}</select>
        </label>
        <label>画面类型
          <input data-clip-visual="${escapeHtml(clip.id)}" value="${escapeHtml(clip.visualType || "")}" placeholder="KOC / 产品镜 / 明星 / 资产" />
        </label>
        <p title="${escapeHtml(clip.transcript || "")}">${escapeHtml(clip.transcript || "暂无逐字稿；连接模型后识别，或人工补录。")}</p>
        <div class="remix-approval-chips" aria-label="片段审核标签">
          <label class="remix-approve">
            <input type="checkbox" data-clip-preserve="${escapeHtml(clip.id)}" ${clip.preserveWhole ? "checked" : ""} />
            <span>完整保留${clip.preserveWhole ? " · 语义段" : ""}</span>
          </label>
          <label class="remix-approve">
            <input type="checkbox" data-clip-resplit="${escapeHtml(clip.id)}" ${clip.allowResplit ? "checked" : ""} />
            <span>允许重切</span>
          </label>
          <label class="remix-approve">
            <input type="checkbox" data-clip-approved="${escapeHtml(clip.id)}" ${clip.approved ? "checked" : ""} />
            <span>标签可用</span>
          </label>
        </div>
      </div>
    </article>
  `;
}

function renderClips(clips) {
  if (!clips.length) {
    const emptyText = state.clipView === "approved"
      ? "还没有符合条件的已人工确认片段。勾选“人工确认标签可用”后会自动出现在这里。"
      : state.clipView === "pending"
        ? "当前筛选条件下没有待确认片段。"
        : "当前筛选条件下没有片段。";
    $("#clipGrid").innerHTML = `<div class="remix-empty">${emptyText}</div>`;
    $("#clipFilterHint").textContent = emptyText;
    $("#clipPagination").innerHTML = "";
    return;
  }
  const pages = Math.max(1, Math.ceil(clips.length / state.clipPageSize));
  state.clipPage = Math.min(Math.max(1, state.clipPage), pages);
  const start = (state.clipPage - 1) * state.clipPageSize;
  const visible = clips.slice(start, start + state.clipPageSize);
  $("#clipGrid").innerHTML = visible.map(clipCard).join("");
  const viewLabel = state.clipView === "approved" ? "已人工确认" : state.clipView === "pending" ? "待人工确认" : "全部";
  $("#clipFilterHint").textContent = `${viewLabel}共 ${clips.length} 条 · 第 ${state.clipPage}/${pages} 页；修改或确认后自动保存`;
  const candidates = [...new Set([1, state.clipPage - 1, state.clipPage, state.clipPage + 1, pages])]
    .filter((item) => item >= 1 && item <= pages)
    .sort((a, b) => a - b);
  $("#clipPagination").innerHTML = `
    <button type="button" data-clip-page="${state.clipPage - 1}" ${state.clipPage <= 1 ? "disabled" : ""}>‹</button>
    ${candidates.map((page) => `<button type="button" data-clip-page="${page}" class="${page === state.clipPage ? "current" : ""}">${page}</button>`).join("")}
    <button type="button" data-clip-page="${state.clipPage + 1}" ${state.clipPage >= pages ? "disabled" : ""}>›</button>
    <label class="remix-page-jump">跳至
      <input type="number" min="1" max="${pages}" value="${state.clipPage}" inputmode="numeric" aria-label="输入片段页码" data-clip-page-input />
      <button type="button" data-clip-page-go>跳转</button>
    </label>
  `;
}

async function loadClips(force = false, resetPage = force) {
  const productId = $("#clipProductFilter").value;
  const stage = $("#clipStageFilter").value;
  const queryText = $("#clipKeywordFilter").value.trim();
  const approval = state.clipView === "approved" ? "approved" : state.clipView === "pending" ? "pending" : "";
  const key = `${productId}|${stage}|${approval}|${queryText}|${state.snapshot?.updatedAt || ""}`;
  if (!force && key === state.lastClipKey) return;
  try {
    const query = new URLSearchParams({
      productId,
      stage,
      approval,
      query: queryText,
      limit: "2000"
    });
    if (!state.sharedIndexRefreshed) query.set("refreshShared", "1");
    const data = await api(`./api/remix/clips?${query}`);
    state.sharedIndexRefreshed = true;
    state.lastClipKey = key;
    state.clips = data.clips || [];
    if (resetPage) state.clipPage = 1;
    renderClips(state.clips);
    if (data.sharedSync?.warning) showToast(data.sharedSync.warning);
  } catch (error) {
    state.lastClipKey = "";
    showToast(error.message, "error");
  }
}

function renderPlan(plan) {
  state.currentPlan = plan;
  const warnings = Array.isArray(plan.validationWarnings)
    ? plan.validationWarnings.filter(Boolean)
    : plan.validationError ? [plan.validationError] : [];
  $("#planPreview").innerHTML = `
    <header>
      <div>
        <span>${escapeHtml(plan.productName)}</span>
        <strong>${escapeHtml(plan.frameworkName)}</strong>
        ${plan.knowledgeFramework?.originalText ? '<small class="plan-valid">已按选中文案完整原文匹配结构与片段顺序</small>' : ""}
        <small>预计 ${formatDuration(plan.actualDuration)} · ${plan.clips.length}个已确认片段 · ${escapeHtml(plan.audioModeLabel || "人声优先")}</small>
        <small class="${warnings.length ? "plan-warning" : "plan-valid"}">${warnings.length ? `结构提醒：${escapeHtml(warnings.join("；"))}。仍可按当前顺序合成。` : "当前顺序可直接合成，也可自由拖动调整"}</small>
      </div>
      <button class="primary-button" type="button" data-compose-plan="${escapeHtml(plan.id)}">确认并本地合成</button>
    </header>
    <ol class="remix-plan-timeline">
      ${plan.clips.map((clip, index) => `
        <li draggable="true" data-plan-clip-id="${escapeHtml(clip.id)}">
          <button class="remix-drag-handle" type="button" title="按住拖动排序" aria-label="拖动第${index + 1}段">⋮⋮</button>
          <b>${String(index + 1).padStart(2, "0")}</b>
          <span class="remix-plan-thumb">
            ${clip.thumbnailPath
              ? `<img src="${imageUrl(clip.thumbnailPath)}" alt="${escapeHtml(STAGE_LABELS[clip.stage] || clip.stageLabel || "片段预览")}" data-plan-thumb-image data-fallback-video="${escapeHtml(mediaUrl(clip.filePath))}" />`
              : `<video src="${escapeHtml(mediaUrl(clip.filePath))}#t=0.2" muted preload="metadata" playsinline aria-label="${escapeHtml(STAGE_LABELS[clip.stage] || clip.stageLabel || "片段预览")}"></video>`}
          </span>
          <div>
            <strong>${escapeHtml(STAGE_LABELS[clip.stage] || clip.stageLabel)}</strong>
            <span>来源第${clip.sourceRank}条 · ${Number(clip.start).toFixed(1)}–${Number(clip.end).toFixed(1)}秒</span>
          </div>
          <em>${formatDuration(clip.duration)}</em>
          <div class="remix-plan-order-buttons">
            <button type="button" data-move-plan-clip="${escapeHtml(clip.id)}" data-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="上移">↑</button>
            <button type="button" data-move-plan-clip="${escapeHtml(clip.id)}" data-direction="1" ${index === plan.clips.length - 1 ? "disabled" : ""} aria-label="下移">↓</button>
          </div>
        </li>
      `).join("")}
    </ol>
  `;
  $("#planPreview").querySelectorAll("[data-plan-thumb-image]").forEach((image) => {
    image.addEventListener("error", () => {
      const video = document.createElement("video");
      video.src = `${image.dataset.fallbackVideo || ""}#t=0.2`;
      video.muted = true;
      video.preload = "metadata";
      video.playsInline = true;
      image.replaceWith(video);
    }, { once: true });
  });
  persistWorkspace();
  updateRemixTabCounts();
}

async function persistPlanOrder(clipIds) {
  const plan = state.currentPlan;
  if (!plan) return;
  try {
    const updated = await api(`./api/remix/plans/${encodeURIComponent(plan.id)}/reorder`, {
      method: "POST",
      body: JSON.stringify({ clipIds })
    });
    renderPlan(updated);
    const warnings = Array.isArray(updated.validationWarnings) ? updated.validationWarnings.filter(Boolean) : [];
    showToast(warnings.length ? `顺序已保存；${warnings.join("；")}（仅提醒，不阻止合成）` : "编排顺序已保存");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function movePlanClip(clipId, direction) {
  const order = (state.currentPlan?.clips || []).map((clip) => String(clip.id));
  const current = order.indexOf(String(clipId));
  const target = current + Number(direction || 0);
  if (current < 0 || target < 0 || target >= order.length) return;
  const [moved] = order.splice(current, 1);
  order.splice(target, 0, moved);
  persistPlanOrder(order);
}

async function saveClip(clipId) {
  const card = document.querySelector(`[data-clip-id="${CSS.escape(clipId)}"]`);
  if (!card) return;
  const payload = {
    stage: card.querySelector("[data-clip-stage]").value,
    visualType: card.querySelector("[data-clip-visual]").value,
    preserveWhole: card.querySelector("[data-clip-preserve]").checked,
    allowResplit: card.querySelector("[data-clip-resplit]").checked,
    approved: card.querySelector("[data-clip-approved]").checked
  };
  try {
    await api(`./api/remix/clips/${encodeURIComponent(clipId)}`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    card.classList.add("saved");
    setTimeout(() => card.classList.remove("saved"), 900);
    await loadState();
    await loadClips(true, false);
  } catch (error) {
    showToast(error.message, "error");
  }
}

$("#toggleMaterialUploadButton").addEventListener("click", () => {
  const panel = $("#materialUploadPanel");
  panel.hidden = !panel.hidden;
  $("#toggleMaterialUploadButton").textContent = panel.hidden ? "上传新素材到OSS" : "收起上传";
});

$("#materialFiles").addEventListener("change", () => {
  const count = $("#materialFiles").files?.length || 0;
  $("#materialUploadStatus").textContent = count ? `已选择 ${count} 个视频` : "等待选择文件";
  $("#materialUploadHint").textContent = count
    ? "确认产品和标签后上传；系统会按文件哈希自动去重。"
    : "上传后可继续运行AI识别和自动切片。";
});

$("#materialUploadPanel").addEventListener("submit", async (event) => {
  event.preventDefault();
  const files = [...($("#materialFiles").files || [])];
  if (!files.length) {
    showToast("请先选择要上传的视频", "error");
    return;
  }
  const productSelect = $("#materialUploadProduct");
  const selectedProduct = productSelect.selectedOptions[0];
  const productId = productSelect.value;
  const productName = selectedProduct?.dataset.name || "";
  const tags = $("#materialUploadTags").value.trim();
  const isEffective = $("#materialUploadEffective").checked;
  const button = $("#materialUploadButton");
  button.disabled = true;
  let succeeded = 0;
  let duplicates = 0;
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const percent = Math.floor(index / files.length * 100);
      $("#materialUploadProgress").style.width = `${percent}%`;
      $("#materialUploadStatus").textContent = `正在上传 ${index + 1}/${files.length}`;
      $("#materialUploadHint").textContent = file.name;
      const query = new URLSearchParams({
        name: file.name,
        title: file.name.replace(/\.[^.]+$/, ""),
        productId,
        productName,
        tags,
        isEffective: String(isEffective),
        effectiveLabel: isEffective ? "历史有效成片" : "",
        approvalRisk: $("#materialUploadRisk").value
      });
      const result = await api(`./api/material-center/upload?${query}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file
      });
      if (result.duplicate) duplicates += 1;
      else succeeded += 1;
    }
    $("#materialUploadProgress").style.width = "100%";
    $("#materialUploadStatus").textContent = `上传完成：新增 ${succeeded} · 重复 ${duplicates}`;
    $("#materialUploadHint").textContent = "素材已经进入部门素材中心，可继续查询、切片或加入投放队列。";
    showToast(`素材上传完成：新增 ${succeeded} 条，重复 ${duplicates} 条`);
    await Promise.all([loadMaterialStatus(), loadMaterials(1)]);
  } catch (error) {
    $("#materialUploadStatus").textContent = "上传未完成";
    $("#materialUploadHint").textContent = error.message;
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

$("#syncMaterialButton").addEventListener("click", async () => {
  const button = $("#syncMaterialButton");
  button.disabled = true;
  button.textContent = "正在同步";
  try {
    const result = await api("./api/material-center/sync-remix", { method: "POST" });
    showToast(`已同步 ${result.assetCount} 条成片和 ${result.clipCount} 个片段`);
    await Promise.all([loadMaterialStatus(), loadMaterials(1)]);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "同步已有混剪素材";
  }
});

$("#syncSharedLibraryButton").addEventListener("click", async () => {
  const button = $("#syncSharedLibraryButton");
  button.disabled = true;
  button.textContent = "正在同步50条与切片";
  try {
    const result = await api("./api/team-workbench/sync-remix", { method: "POST" });
    showToast(`部门共享库已同步：${result.sources}条原片、${result.clips}个切片`);
    await loadMaterials(1);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "同步部门共享库";
  }
});

$("#materialSearchButton").addEventListener("click", () => loadMaterials(1));
$("#materialLibraryFilter").addEventListener("change", () => loadMaterials(1));
$("#materialProductFilter").addEventListener("change", () => loadMaterials(1));
$("#materialSourceFilter").addEventListener("change", () => loadMaterials(1));
$("#materialEffectiveFilter").addEventListener("change", () => loadMaterials(1));
$("#materialKeyword").addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadMaterials(1);
});

$("#materialPagination").addEventListener("click", (event) => {
  const button = event.target.closest("[data-material-page]");
  if (!button || button.disabled) return;
  loadMaterials(Number(button.dataset.materialPage || 1));
});

$("#materialGrid").addEventListener("click", async (event) => {
  const cutButton = event.target.closest("[data-cut-material]");
  if (cutButton) {
    await addMaterialsToClipping([cutButton.dataset.cutMaterial], cutButton);
    return;
  }
  const playButton = event.target.closest("[data-play-material]");
  if (playButton) {
    const asset = state.materialAssets.find((item) => item.id === playButton.dataset.playMaterial);
    if (!asset) return;
    if (!asset.filePath) {
      showToast("这条共享原片仍在云端上传，请稍后刷新重试。", "info");
      return;
    }
    openVideoPlayer(asset.title || asset.fileName || "部门素材", asset.filePath, "9:16素材预览");
    return;
  }
  const queueButton = event.target.closest("[data-queue-material]");
  if (!queueButton) return;
  if (!state.materialStatus?.connected) {
    showToast("当前为部门素材只读缓存；投放队列由管理员主机统一维护。");
    return;
  }
  queueButton.disabled = true;
  try {
    const task = await api("./api/material-center/publish-tasks", {
      method: "POST",
      body: JSON.stringify({
        assetId: queueButton.dataset.queueMaterial,
        platform: "qianchuan",
        advertiserId: $("#qianchuanAccount")?.value || ""
      })
    });
    showToast(task.message || "已加入千川待推送队列");
    await Promise.all([loadPublishTasks(), loadMaterialStatus()]);
    switchRemixTab("outputs", { focus: true });
  } catch (error) {
    showToast(error.message, "error");
    queueButton.disabled = false;
  }
});

$("#materialGrid").addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-select-material]");
  if (!checkbox) return;
  if (checkbox.checked) state.selectedMaterialIds.add(checkbox.dataset.selectMaterial);
  else state.selectedMaterialIds.delete(checkbox.dataset.selectMaterial);
  checkbox.closest(".material-card")?.classList.toggle("selected", checkbox.checked);
  renderMaterialSelection();
});

$("#addSelectedToClipsButton").addEventListener("click", () => {
  addMaterialsToClipping([...state.selectedMaterialIds]);
});

$("#importButton").addEventListener("click", async () => {
  if (state.provider?.feishuImport?.ready === false) {
    showToast(state.provider.feishuImport.message || "同事端无需重复导入飞书素材。");
    return;
  }
  try {
    await api("./api/remix/import-feishu", { method: "POST" });
    showToast("已开始读取飞书并自动切片");
    await loadState();
  } catch (error) {
    showToast(error.message, "error");
  }
});

$("#analyzeButton").addEventListener("click", async () => {
  try {
    const job = state.snapshot?.analysisJob || {};
    const allSentenceCut = Number(state.snapshot?.counts?.sentenceCutVideos || 0)
      >= Number(state.snapshot?.counts?.readyVideos || 0);
    await api("./api/remix/analyze", {
      method: "POST",
      body: JSON.stringify({
        retryFailedOnly: ["partial", "failed", "interrupted"].includes(job.status),
        forceReanalyze: job.status === "success" && allSentenceCut
      })
    });
    showToast("AI视频理解已开始，页面会持续显示每条素材的真实进度");
    await loadState();
  } catch (error) {
    showToast(error.message, "error");
  }
});

$("#clipProductFilter").addEventListener("change", () => loadClips(true));
$("#clipStageFilter").addEventListener("change", () => loadClips(true));
$("#refreshClipsButton").addEventListener("click", () => {
  state.sharedIndexRefreshed = false;
  loadClips(true);
});
$("#clipKeywordFilter").addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadClips(true);
});

$("#clipViewTabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-clip-view]");
  if (!button) return;
  selectClipView(button.dataset.clipView || "all");
  loadClips(true);
});

$("#stageCounts").addEventListener("click", (event) => {
  const button = event.target.closest("[data-stage-filter]");
  if (!button) return;
  $("#clipStageFilter").value = button.dataset.stageFilter;
  loadClips(true);
});

$("#clipGrid").addEventListener("click", (event) => {
  const play = event.target.closest("[data-play-clip]");
  if (!play) return;
  const clip = state.clips.find((item) => item.id === play.dataset.playClip);
  if (!clip) return;
  openVideoPlayer(`${clip.productName || "共享片段"} · ${STAGE_LABELS[clip.stage] || clip.stageLabel || "片段"}`, clip.filePath, "共享片段预览");
});

$("#clipPagination").addEventListener("click", (event) => {
  const go = event.target.closest("[data-clip-page-go]");
  if (go) {
    const input = $("#clipPagination").querySelector("[data-clip-page-input]");
    const pages = Math.max(1, Math.ceil(state.clips.length / state.clipPageSize));
    state.clipPage = Math.min(pages, Math.max(1, Number(input?.value || state.clipPage)));
    renderClips(state.clips);
    switchRemixTab("clip-library", { focus: true });
    return;
  }
  const button = event.target.closest("[data-clip-page]");
  if (!button || button.disabled) return;
  state.clipPage = Math.max(1, Number(button.dataset.clipPage || 1));
  renderClips(state.clips);
  switchRemixTab("clip-library", { focus: true });
});

$("#clipPagination").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !event.target.closest("[data-clip-page-input]")) return;
  event.preventDefault();
  $("#clipPagination").querySelector("[data-clip-page-go]")?.click();
});

$("#toggleClipGridButton").addEventListener("click", () => {
  state.clipGridCollapsed = !state.clipGridCollapsed;
  $("#clipLibraryBody").hidden = state.clipGridCollapsed;
  $("#clipPagination").hidden = state.clipGridCollapsed;
  $("#toggleClipGridButton").textContent = state.clipGridCollapsed ? "展开片段列表" : "收起片段列表";
  showToast(state.clipGridCollapsed ? "片段列表已收起，可以直接进入编排" : "片段列表已展开");
});

$("#clipGrid").addEventListener("change", (event) => {
  const target = event.target.closest("[data-clip-stage], [data-clip-visual], [data-clip-preserve], [data-clip-resplit], [data-clip-approved]");
  if (!target) return;
  const clipId = target.dataset.clipStage || target.dataset.clipVisual || target.dataset.clipPreserve || target.dataset.clipResplit || target.dataset.clipApproved;
  saveClip(clipId);
});

$("#planForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const plan = await api("./api/remix/plans", {
      method: "POST",
      body: JSON.stringify({
        productId: $("#planProduct").value,
        frameworkId: $("#planFramework").value,
        targetDuration: Number($("#planDuration").value),
        audioMode: $("#planAudioMode").value,
        knowledgeFramework: window.WorkbenchKnowledge.read()
      })
    });
    renderPlan(plan);
    window.WorkbenchKnowledge.record("generation_started", plan.id, { mode: "remix", planId: plan.id });
    showToast("编排方案已生成，可自由调整顺序后合成");
  } catch (error) {
    showToast(error.message, "error");
  }
});

$("#planPreview").addEventListener("click", async (event) => {
  const moveButton = event.target.closest("[data-move-plan-clip]");
  if (moveButton) {
    movePlanClip(moveButton.dataset.movePlanClip, Number(moveButton.dataset.direction || 0));
    return;
  }
  const button = event.target.closest("[data-compose-plan]");
  if (!button) return;
  button.disabled = true;
  try {
    await api("./api/remix/compose", {
      method: "POST",
      body: JSON.stringify({ planId: button.dataset.composePlan })
    });
    showToast("已进入本地合成队列");
    await loadState();
    switchRemixTab("outputs", { focus: true });
  } catch (error) {
    button.disabled = false;
    showToast(error.message, "error");
  }
});

$("#planPreview").addEventListener("dragstart", (event) => {
  const item = event.target.closest("[data-plan-clip-id]");
  if (!item) return;
  state.draggedPlanClipId = item.dataset.planClipId || "";
  item.classList.add("dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", state.draggedPlanClipId);
  }
});

$("#planPreview").addEventListener("dragover", (event) => {
  const item = event.target.closest("[data-plan-clip-id]");
  if (!item || !state.draggedPlanClipId || item.dataset.planClipId === state.draggedPlanClipId) return;
  event.preventDefault();
  document.querySelectorAll(".remix-plan-timeline li.drag-over").forEach((entry) => entry.classList.remove("drag-over"));
  item.classList.add("drag-over");
});

$("#planPreview").addEventListener("drop", (event) => {
  const target = event.target.closest("[data-plan-clip-id]");
  if (!target || !state.draggedPlanClipId) return;
  event.preventDefault();
  const order = (state.currentPlan?.clips || []).map((clip) => String(clip.id));
  const from = order.indexOf(String(state.draggedPlanClipId));
  const to = order.indexOf(String(target.dataset.planClipId));
  if (from >= 0 && to >= 0 && from !== to) {
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    persistPlanOrder(order);
  }
  state.draggedPlanClipId = "";
});

$("#planPreview").addEventListener("dragend", () => {
  state.draggedPlanClipId = "";
  document.querySelectorAll(".remix-plan-timeline li.dragging, .remix-plan-timeline li.drag-over")
    .forEach((item) => item.classList.remove("dragging", "drag-over"));
});

async function pushPublishTask(taskId, selection) {
  return api(`./api/material-center/publish-tasks/${encodeURIComponent(taskId)}/push`, {
    method: "POST",
    body: JSON.stringify({ ...selection, isAigc: true })
  });
}

async function uploadPublishTaskBatch(taskId, advertiserIds) {
  return api(`./api/material-center/publish-tasks/${encodeURIComponent(taskId)}/upload-batch`, {
    method: "POST",
    body: JSON.stringify({ advertiserIds, isAigc: true })
  });
}

async function uploadOutputJobs(requestedTargets) {
  if (state.outputPublishBusy) return;
  const advertiserIds = selectedQianchuanBatchAccountIds();
  if (!advertiserIds.length) return showToast("请先勾选至少一个批量上传账户", "error");
  const targets = (requestedTargets || []).map((item) => typeof item === "string"
    ? { jobId: item, variantId: "" }
    : { jobId: String(item?.jobId || ""), variantId: String(item?.variantId || "") })
    .filter((item) => item.jobId);
  if (!targets.length) return showToast("请先选择要上传的主版或附加版本", "error");
  state.outputPublishBusy = true;
  state.lastOutputKey = "";
  renderOutputs(state.snapshot || {});
  updateOutputPushToolbar();
  try {
    const queued = await api("./api/remix/outputs/publish-tasks", {
      method: "POST",
      body: JSON.stringify({ targets, advertiserId: advertiserIds[0] })
    });
    const created = queued.completed || [];
    if (!created.length) throw new Error(queued.failed?.[0]?.error || "审核成片未能加入千川队列");
    const completed = [];
    const failed = [...(queued.failed || [])];
    for (let index = 0; index < created.length; index += 2) {
      const batch = created.slice(index, index + 2);
      const results = await Promise.allSettled(batch.map((item) => uploadPublishTaskBatch(item.task.id, advertiserIds)));
      results.forEach((result, resultIndex) => {
        const item = batch[resultIndex];
        if (result.status === "fulfilled") {
          completed.push({ jobId: item.jobId, variantId: item.variantId, result: result.value });
          if (item.variantId) state.selectedOutputVariantIds.delete(item.variantId);
          else state.selectedOutputJobIds.delete(item.jobId);
        } else {
          failed.push({ jobId: item.jobId, error: result.reason?.message || String(result.reason) });
        }
      });
    }
    showToast(failed.length
      ? `已完成${completed.length}条成片的多账户上传，${failed.length}条可在队列中重试`
      : `已将${completed.length}条成片上传到${advertiserIds.length}个账户素材库；未启动投放`,
    failed.length ? "error" : "info");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.outputPublishBusy = false;
    state.lastOutputKey = "";
    await Promise.all([loadPublishTasks(), loadMaterialStatus()]);
    renderOutputs(state.snapshot || {});
    updateOutputPushToolbar();
  }
}

async function pushOutputJobs(requestedTargets) {
  if (state.outputPublishBusy) return;
  let selection;
  try {
    selection = qianchuanPushSelection();
  } catch (error) {
    showToast(error.message, "error");
    return;
  }
  const targets = (requestedTargets || []).map((item) => typeof item === "string"
    ? { jobId: item, variantId: "" }
    : { jobId: String(item?.jobId || ""), variantId: String(item?.variantId || "") })
    .filter((item) => item.jobId);
  if (!targets.length) return showToast("请先选择要推送的主版或附加版本", "error");
  state.outputPublishBusy = true;
  state.lastOutputKey = "";
  renderOutputs(state.snapshot || {});
  updateOutputPushToolbar();
  try {
    const queued = await api("./api/remix/outputs/publish-tasks", {
      method: "POST",
      body: JSON.stringify({ targets, ...selection })
    });
    const created = queued.completed || [];
    if (!created.length) throw new Error(queued.failed?.[0]?.error || "审核成片未能加入千川队列");
    const pushed = [];
    const failed = [...(queued.failed || [])];
    for (let index = 0; index < created.length; index += 2) {
      const batch = created.slice(index, index + 2);
      const results = await Promise.allSettled(batch.map((item) => pushPublishTask(item.task.id, selection)));
      results.forEach((result, resultIndex) => {
        const item = batch[resultIndex];
        if (result.status === "fulfilled") {
          pushed.push({ jobId: item.jobId, variantId: item.variantId, result: result.value });
          if (item.variantId) state.selectedOutputVariantIds.delete(item.variantId);
          else state.selectedOutputJobIds.delete(item.jobId);
        } else {
          failed.push({ jobId: item.jobId, error: result.reason?.message || String(result.reason) });
        }
      });
    }
    showToast(failed.length
      ? `已完成${pushed.length}条上传，${failed.length}条可在队列中重试`
      : (selection.planId
        ? `已将${pushed.length}条成片上传并关联到“${selection.planName}”；未启动投放`
        : `已将${pushed.length}条成片上传到所选账户素材库；未关联计划，也未启动投放`),
    failed.length ? "error" : "info");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.outputPublishBusy = false;
    state.lastOutputKey = "";
    await Promise.all([loadPublishTasks(), loadMaterialStatus()]);
    renderOutputs(state.snapshot || {});
    updateOutputPushToolbar();
  }
}

function setVariantSource(source) {
  state.variantSource = ["local_upload", "oss_pull", "ai_generated"].includes(source) ? source : "local_upload";
  document.querySelectorAll("[data-variant-source]").forEach((button) => {
    button.classList.toggle("active", button.dataset.variantSource === state.variantSource);
  });
  document.querySelectorAll("[data-variant-source-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.variantSourcePanel !== state.variantSource;
  });
}

function openVariantDialog(outputId) {
  const job = (state.snapshot?.composeJobs || []).find((item) => String(item.id) === String(outputId));
  if (!job) return showToast("没有找到这条主版成片", "error");
  $("#variantOutputId").value = job.id;
  $("#variantUploaderTitle").textContent = `${job.productName || "AI智能混剪"} · 添加附加版本`;
  $("#variantTitle").value = "";
  $("#variantFile").value = "";
  $("#variantOssUrl").value = "";
  $("#variantUploadProgress").hidden = true;
  $("#variantAiJob").innerHTML = '<option value="">选择一条已完成成片</option>' + (state.snapshot?.composeJobs || [])
    .filter((item) => item.status === "success" && item.outputPath && String(item.id) !== String(outputId))
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.productName || "AI成片")} · ${escapeHtml(formatDate(item.finishedAt || item.createdAt))}</option>`)
    .join("");
  setVariantSource("local_upload");
  $("#variantUploaderDialog").showModal();
}

document.querySelectorAll("[data-variant-source]").forEach((button) => {
  button.addEventListener("click", () => setVariantSource(button.dataset.variantSource));
});

document.querySelector("[data-close-variant-dialog]")?.addEventListener("click", () => $("#variantUploaderDialog").close());

$("#variantUploaderForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const outputId = $("#variantOutputId").value;
  const type = $("#variantType").value;
  const title = $("#variantTitle").value.trim() || VARIANT_TYPE_LABELS[type] || "附加版本";
  const button = $("#variantSubmitButton");
  button.disabled = true;
  $("#variantUploadProgress").hidden = false;
  try {
    let result;
    if (state.variantSource === "local_upload") {
      const file = $("#variantFile").files?.[0];
      if (!file) throw new Error("请选择要上传的视频");
      if (file.size > 220 * 1024 * 1024) throw new Error("附加版本不能超过220MB");
      const query = new URLSearchParams({
        source: "local_upload",
        type,
        title,
        filename: file.name
      });
      const response = await fetch(`./api/v1/remix/output/${encodeURIComponent(outputId)}/variants?${query}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": file.type || "video/mp4" },
        body: file
      });
      result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "附加版本上传失败");
    } else {
      const payload = { source: state.variantSource, type, title };
      if (state.variantSource === "oss_pull") payload.sourceUrl = $("#variantOssUrl").value.trim();
      if (state.variantSource === "ai_generated") payload.aiJobId = $("#variantAiJob").value;
      result = await api(`./api/v1/remix/output/${encodeURIComponent(outputId)}/variants`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
    }
    $("#variantUploaderDialog").close();
    state.lastOutputKey = "";
    showToast(`已添加“${result.item?.title || title}”`);
    await loadState();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    $("#variantUploadProgress").hidden = true;
  }
});

$("#outputList").addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-select-output]");
  const variantCheckbox = event.target.closest("[data-select-variant]");
  if (!checkbox && !variantCheckbox) return;
  if (checkbox) {
    if (checkbox.checked) state.selectedOutputJobIds.add(checkbox.dataset.selectOutput);
    else state.selectedOutputJobIds.delete(checkbox.dataset.selectOutput);
  }
  if (variantCheckbox) {
    if (variantCheckbox.checked) state.selectedOutputVariantIds.add(variantCheckbox.dataset.selectVariant);
    else state.selectedOutputVariantIds.delete(variantCheckbox.dataset.selectVariant);
  }
  persistWorkspace();
  state.lastOutputKey = "";
  renderOutputs(state.snapshot || {});
});

$("#outputList").addEventListener("click", async (event) => {
  const uploadButton = event.target.closest("[data-upload-output]");
  if (uploadButton) {
    await uploadOutputJobs([uploadButton.dataset.uploadOutput]);
    return;
  }
  const pushButton = event.target.closest("[data-push-output]");
  if (pushButton) {
    await pushOutputJobs([pushButton.dataset.pushOutput]);
    return;
  }
  const addVariantButton = event.target.closest("[data-add-variant]");
  if (addVariantButton) {
    openVariantDialog(addVariantButton.dataset.addVariant);
    return;
  }
  const playVariantButton = event.target.closest("[data-play-variant]");
  if (playVariantButton) {
    const variant = (Array.isArray(state.snapshot?.outputVariants) ? state.snapshot.outputVariants : [])
      .find((item) => item && item.id === playVariantButton.dataset.playVariant);
    if (!variant) return;
    openVideoPlayer(variant.title || "附加版本", variantPlaybackPath(variant), "附加版本预览");
    return;
  }
  const primaryVariantButton = event.target.closest("[data-primary-variant]");
  if (primaryVariantButton) {
    primaryVariantButton.disabled = true;
    try {
      await api(`./api/v1/remix/output/${encodeURIComponent(primaryVariantButton.dataset.outputId)}/primary`, {
        method: "PATCH",
        body: JSON.stringify({ variantId: primaryVariantButton.dataset.primaryVariant })
      });
      showToast("已将附加版本设为当前主版");
      state.lastOutputKey = "";
      await loadState();
    } catch (error) {
      primaryVariantButton.disabled = false;
      showToast(error.message, "error");
    }
    return;
  }
  const primaryMainButton = event.target.closest("[data-primary-main]");
  if (primaryMainButton) {
    primaryMainButton.disabled = true;
    try {
      await api(`./api/v1/remix/output/${encodeURIComponent(primaryMainButton.dataset.primaryMain)}/primary`, {
        method: "PATCH",
        body: JSON.stringify({ variantId: "" })
      });
      showToast("已恢复原始成片为主版");
      state.lastOutputKey = "";
      await loadState();
    } catch (error) {
      primaryMainButton.disabled = false;
      showToast(error.message, "error");
    }
    return;
  }
  const deleteVariantButton = event.target.closest("[data-delete-variant]");
  if (deleteVariantButton) {
    deleteVariantButton.disabled = true;
    try {
      await api(`./api/v1/remix/output/variants/${encodeURIComponent(deleteVariantButton.dataset.deleteVariant)}`, { method: "DELETE" });
      state.selectedOutputVariantIds.delete(deleteVariantButton.dataset.deleteVariant);
      persistWorkspace();
      state.lastOutputKey = "";
      showToast("附加版本已删除");
      await loadState();
    } catch (error) {
      deleteVariantButton.disabled = false;
      showToast(error.message, "error");
    }
    return;
  }
  const play = event.target.closest("[data-play-output]");
  if (play) {
    const job = (state.snapshot?.composeJobs || []).find((item) => item.id === play.dataset.playOutput);
    const outputPath = primaryOutputPath(job);
    if (!outputPath) return;
    openVideoPlayer(job.productName || "AI智能混剪", outputPath, "单条成片预览");
    return;
  }
  const deleteButton = event.target.closest("[data-delete-output]");
  if (deleteButton) {
    deleteButton.disabled = true;
    try {
      const result = await api(`./api/remix/compose/${encodeURIComponent(deleteButton.dataset.deleteOutput)}`, {
        method: "DELETE"
      });
      state.lastOutputKey = "";
      showToast(result.message || "无效成片已移入回收目录");
      await loadState();
    } catch (error) {
      deleteButton.disabled = false;
      showToast(error.message, "error");
    }
    return;
  }
  const openFileButton = event.target.closest("[data-open-file]");
  if (openFileButton) {
    try {
      await api(`./api/remix/compose/${encodeURIComponent(openFileButton.dataset.openFile)}/open-file`, { method: "POST" });
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }
  const button = event.target.closest("[data-open-output]");
  if (!button) return;
  try {
    await api(`./api/remix/compose/${encodeURIComponent(button.dataset.openOutput)}/open-output`, { method: "POST" });
  } catch (error) {
    showToast(error.message, "error");
  }
});

$("#batchPushOutputsButton").addEventListener("click", () => {
  pushOutputJobs(selectedOutputTargets());
});

$("#batchUploadOutputsButton").addEventListener("click", () => {
  uploadOutputJobs(selectedOutputTargets());
});

$("#outputListToggle")?.addEventListener("click", () => {
  state.outputListExpanded = !state.outputListExpanded;
  state.lastOutputKey = "";
  renderOutputs(state.snapshot || {});
});

$("#outputPagination").addEventListener("click", (event) => {
  const button = event.target.closest("[data-output-page]");
  if (!button || button.disabled) return;
  state.outputPage = Math.max(1, Number(button.dataset.outputPage || 1));
  state.lastOutputKey = "";
  renderOutputs(state.snapshot || {});
  switchRemixTab("outputs", { focus: true });
});

function closeOutputPlayer() {
  const video = $("#outputPlayerVideo");
  video.pause();
  video.removeAttribute("src");
  video.load();
  $("#outputPlayerModal").hidden = true;
}

function openVideoPlayer(title, filePath, kind = "视频预览") {
  const video = $("#outputPlayerVideo");
  video.pause();
  video.removeAttribute("src");
  video.load();
  $("#outputPlayerTitle").textContent = title || "视频预览";
  $("#outputPlayerKind").textContent = kind;
  video.src = mediaUrl(filePath);
  $("#outputPlayerModal").hidden = false;
  video.play().catch(() => {});
}

$("#outputPlayerModal").addEventListener("click", (event) => {
  if (event.target === $("#outputPlayerModal") || event.target.closest("[data-close-output-player]")) {
    closeOutputPlayer();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#outputPlayerModal").hidden) closeOutputPlayer();
});

const today = new Date();
const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
$("#qianchuanStartDate").value = isoDate(yesterday);
$("#qianchuanEndDate").value = isoDate(yesterday);

function qianchuanQuery() {
  return {
    startDate: $("#qianchuanStartDate").value,
    endDate: $("#qianchuanEndDate").value,
    goal: $("#qianchuanGoal").value,
    advertiserId: $("#qianchuanAccount").value
  };
}

async function loadQianchuanPlans() {
  const button = $("#qianchuanLoadPlansButton");
  const query = qianchuanQuery();
  if (!query.advertiserId) {
    state.qianchuanPlans = [];
    renderQianchuanPlans();
    return showToast("请先读取并选择千川广告账户", "error");
  }
  button.disabled = true;
  button.textContent = "正在读取计划";
  try {
    const params = new URLSearchParams(query);
    const data = await api(`./api/qianchuan/plans?${params}`);
    state.qianchuanPlans = data.items || [];
    if (data.accountUnavailable) {
      state.qianchuanAccounts = state.qianchuanAccounts.filter((item) => item.advertiserId !== query.advertiserId);
      state.selectedQianchuanBatchAccountIds.delete(query.advertiserId);
      renderQianchuanAccounts();
    }
    renderQianchuanPlans();
    if (data.reauthorizationRequired) {
      $("#qianchuanSettings").open = true;
      await loadQianchuanStatus();
      showToast(data.actionRequired || "千川权限需要更新，请重新授权后再读取计划", "error");
      return;
    }
    const warning = data.warnings?.length ? `；${data.warnings.join("；")}` : "";
    showToast(`已读取${data.counts?.total || 0}个计划，其中${data.counts?.attachable || 0}个可直接关联素材${warning}`);
  } catch (error) {
    state.qianchuanPlans = [];
    renderQianchuanPlans();
    showToast(error.message, "error");
  } finally {
    button.disabled = !state.qianchuan?.authorized || !$("#qianchuanAccount").value;
    button.textContent = "读取计划";
  }
}

$("#qianchuanSaveCredentialsButton").addEventListener("click", async () => {
  const button = $("#qianchuanSaveCredentialsButton");
  const appId = $("#qianchuanAppId").value.trim();
  const secret = $("#qianchuanSecret").value.trim();
  if (!appId) return showToast("请填写千川开放平台 App ID", "error");
  button.disabled = true;
  button.textContent = "正在加密保存";
  try {
    renderQianchuan(await api("./api/qianchuan/configure", {
      method: "POST",
      body: JSON.stringify({ appId, secret })
    }));
    $("#qianchuanSecret").value = "";
    showToast("千川API凭证已由工作站服务端加密保存");
  } catch (error) {
    $("#qianchuanConnector").dataset.status = "error";
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "保存API凭证";
  }
});

$("#qianchuanAuthorizeButton").addEventListener("click", async () => {
  const button = $("#qianchuanAuthorizeButton");
  const popup = window.open("about:blank", "_blank");
  button.disabled = true;
  button.textContent = "正在发起授权";
  try {
    const data = await api("./api/qianchuan/authorize", { method: "POST" });
    if (popup) popup.location.href = data.authorizeUrl;
    else window.location.href = data.authorizeUrl;
    showToast("已打开巨量引擎官方授权页，完成后会自动返回工作站");
  } catch (error) {
    if (popup) popup.close();
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "授权千川账户";
  }
});

$("#qianchuanCheckButton").addEventListener("click", async () => {
  try {
    renderQianchuan(await api("./api/qianchuan/check", { method: "POST" }));
    showToast("千川官方API授权有效");
  } catch (error) {
    $("#qianchuanConnector").dataset.status = "error";
    showToast(error.message, "error");
  }
});

$("#qianchuanDisconnectButton").addEventListener("click", async () => {
  if (!window.confirm("确认解除当前电脑保存的千川访问令牌吗？App ID、加密Secret和历史同步摘要会保留。")) return;
  renderQianchuan(await api("./api/qianchuan/disconnect", { method: "POST" }));
  showToast("已解除当前电脑的千川授权令牌");
});

$("#qianchuanLoadAccountsButton").addEventListener("click", async () => {
  const button = $("#qianchuanLoadAccountsButton");
  button.disabled = true;
  button.textContent = "正在读取";
  try {
    const data = await api("./api/qianchuan/accounts");
    state.qianchuanAccounts = data.items || [];
    state.selectedQianchuanBatchAccountIds = new Set(
      [...state.selectedQianchuanBatchAccountIds]
        .filter((id) => state.qianchuanAccounts.some((item) => item.advertiserId === id))
    );
    state.qianchuanPlans = [];
    renderQianchuanAccounts();
    if (!state.qianchuanAccounts.length && data.reauthorizationRequired) {
      $("#qianchuanSettings").open = true;
      showToast(data.authorizationHint || "没有读取到可用账户，请重新授权并勾选账户", "error");
      return;
    }
    const warning = data.warnings?.length ? `；${data.warnings.join("；")}` : "";
    showToast(`已读取 ${data.items?.length || 0} 个已授权账户；默认可直接上传素材库${warning}`, data.warnings?.length ? "error" : "info");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "读取账户";
  }
});

$("#qianchuanLoadPlansButton").addEventListener("click", loadQianchuanPlans);
$("#qianchuanAccountKeyword").addEventListener("input", renderQianchuanAccounts);
$("#qianchuanPlanKeyword").addEventListener("input", renderQianchuanPlans);
$("#qianchuanPlanType").addEventListener("change", renderQianchuanPlans);
$("#qianchuanPlan").addEventListener("change", renderQianchuanChoiceDetails);
$("#qianchuanGoal").addEventListener("change", () => {
  state.qianchuanPlans = [];
  renderQianchuanPlans();
});

$("#qianchuanSyncButton").addEventListener("click", async () => {
  const button = $("#qianchuanSyncButton");
  button.disabled = true;
  button.textContent = "正在同步";
  try {
    const data = await api("./api/qianchuan/sync", {
      method: "POST",
      body: JSON.stringify(qianchuanQuery())
    });
    await loadQianchuanStatus();
    await loadPublishTasks();
    const warning = data.warnings?.length ? `；${data.warnings.join("；")}` : "";
    showToast(`同步完成：${data.totals?.materials || 0}条素材，消耗 ¥${Number(data.totals?.cost || 0).toFixed(2)}，成交 ¥${Number(data.totals?.gmv || 0).toFixed(2)}，回写 ${Number(data.feedbackUpdated || 0)} 条任务${warning}`, data.warnings?.length ? "error" : "info");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "同步素材与投放数据";
  }
});

$("#qianchuanAccount").addEventListener("change", () => {
  state.qianchuanPlans = [];
  renderQianchuanChoiceDetails();
  renderQianchuanPlans();
});

$("#qianchuanPlanSettings").addEventListener("toggle", () => {
  renderQianchuanChoiceDetails();
});

$("#qianchuanBatchSettings").addEventListener("toggle", () => {
  state.lastOutputKey = "";
  renderPublishTasks(state.materialTasks || []);
  renderOutputs(state.snapshot || {});
  updateOutputPushToolbar();
});

$("#qianchuanBatchAccounts").addEventListener("change", (event) => {
  const checkbox = event.target.closest('input[type="checkbox"]');
  if (checkbox) {
    if (checkbox.checked) state.selectedQianchuanBatchAccountIds.add(checkbox.value);
    else state.selectedQianchuanBatchAccountIds.delete(checkbox.value);
  }
  state.lastOutputKey = "";
  renderPublishTasks(state.materialTasks || []);
  renderOutputs(state.snapshot || {});
  updateOutputPushToolbar();
});

$("#publishQueueToggle")?.addEventListener("click", () => {
  state.publishQueueExpanded = !state.publishQueueExpanded;
  renderPublishTasks(state.materialTasks || []);
});

$("#materialPublishList").addEventListener("click", async (event) => {
  if (event.target.closest("[data-expand-publish-queue]")) {
    state.publishQueueExpanded = true;
    renderPublishTasks(state.materialTasks || []);
    return;
  }
  const uploadButton = event.target.closest("[data-upload-task]");
  if (uploadButton) {
    const advertiserIds = selectedQianchuanBatchAccountIds();
    if (!advertiserIds.length) return showToast("请先勾选至少一个批量上传账户", "error");
    uploadButton.disabled = true;
    uploadButton.textContent = "正在批量上传";
    try {
      const result = await uploadPublishTaskBatch(uploadButton.dataset.uploadTask, advertiserIds);
      showToast(result.message || "多账户上传完成");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      await Promise.all([loadPublishTasks(), loadMaterialStatus()]);
    }
    return;
  }
  const button = event.target.closest("[data-push-task]");
  if (!button) return;
  let selection;
  try {
    selection = qianchuanPushSelection();
  } catch (error) {
    return showToast(error.message, "error");
  }
  button.disabled = true;
  button.textContent = selection.planId ? "正在上传并关联" : "正在上传到素材库";
  try {
    const result = await pushPublishTask(button.dataset.pushTask, selection);
    showToast(result.message || (selection.planId ? "视频已上传并关联到所选计划" : "视频已上传到所选账户素材库"));
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    await Promise.all([loadPublishTasks(), loadMaterialStatus()]);
  }
});

document.querySelectorAll("[data-remix-tab]").forEach((button) => {
  button.addEventListener("click", () => switchRemixTab(button.dataset.remixTab, { focus: true }));
});

$("#classicModeButton")?.addEventListener("click", () => setClassicMode(!state.classicMode));
$("#directPlanningButton")?.addEventListener("click", () => switchRemixTab("planning", { focus: true }));

let workspacePersistTimer = null;
for (const id of REMIX_FILTER_IDS) {
  const node = document.getElementById(id);
  if (!node) continue;
  const persistSoon = () => {
    clearTimeout(workspacePersistTimer);
    workspacePersistTimer = setTimeout(persistWorkspace, 180);
  };
  node.addEventListener("input", persistSoon);
  node.addEventListener("change", persistSoon);
}

document.addEventListener("keydown", (event) => {
  if (!event.altKey || !/^[1-4]$/.test(event.key)) return;
  event.preventDefault();
  switchRemixTab(REMIX_TABS[Number(event.key) - 1], { focus: true });
});

$("#remixDraftDialog")?.addEventListener("close", () => {
  if ($("#remixDraftDialog").returnValue === "reset") {
    resetWorkspaceDraft();
    showToast("已重置上次方案");
  } else {
    persistWorkspace();
    showToast("已保留上次方案");
  }
});

const shouldPromptForDraft = hasPersistedWorkspaceDraft();
restoreFilterControls();
switchRemixTab(requestedInitialTab(), { syncUrl: true, persist: false });

Promise.allSettled([
  loadState(),
  loadProvider(),
  loadMaterialStatus(),
  loadMaterials(1),
  loadPublishTasks(),
  loadQianchuanStatus()
]).then(async () => {
  await loadClips(true);
  if (shouldPromptForDraft && !state.draftPromptHandled) {
    state.draftPromptHandled = true;
    $("#remixDraftDialog")?.showModal();
  }
});
setInterval(loadState, 2000);
setInterval(loadProvider, 15000);
setInterval(loadMaterialStatus, 15000);
setInterval(loadPublishTasks, 15000);
setInterval(loadQianchuanStatus, 10000);
