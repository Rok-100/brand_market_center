"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");

const WORKBENCH_LAYOUT_VERSION = 2;
const stateFlights = new Map();
const WORKBENCH_MODULES = Object.freeze({
  "ai-product-showcase": Object.freeze({ key: "ai-product-showcase", label: "AI产品镜" }),
  "creative-instruction-showcase": Object.freeze({ key: "creative-instruction-showcase", label: "备用创意通道" }),
  "one-click-replacement": Object.freeze({ key: "one-click-replacement", label: "一键换品" }),
  "ai-koc": Object.freeze({ key: "ai-koc", label: "AIKOC" }),
  "video-variation": Object.freeze({ key: "video-variation", label: "单视频批量裂变" }),
  "ai-person": Object.freeze({ key: "ai-person", label: "AI明星画面" })
});

function shanghaiDate(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("任务创建日期无效");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function sanitizeLibtvName(value, fallback = "未命名任务", maxLength = 80) {
  const text = String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim()
    .replace(/^[.-]+|[.-]+$/g, "");
  return (text || fallback).slice(0, Math.max(1, Number(maxLength) || 80));
}

function normalizeWorkstation(input = {}) {
  const rawId = String(input.workstationId || input.id || "").trim().toLowerCase();
  const workstationId = rawId.replace(/[^a-z0-9-]/g, "").slice(0, 80);
  const compactId = workstationId.replace(/[^a-z0-9]/g, "");
  if (compactId.length < 16) throw new Error("当前页面缺少本机工作台标识，请刷新页面后重新提交");
  const shortId = compactId.slice(-8).toUpperCase();
  const requestedLabel = sanitizeLibtvName(input.workstationLabel || input.label || "电脑", "电脑", 22);
  const workstationLabel = requestedLabel.toUpperCase().includes(shortId)
    ? requestedLabel
    : `${requestedLabel}-${shortId}`;
  return { workstationId, workstationLabel, shortId };
}

function normalizeModule(value) {
  const key = typeof value === "object" ? value?.key : value;
  if (WORKBENCH_MODULES[String(key || "").trim()]) return WORKBENCH_MODULES[String(key).trim()];
  const label = sanitizeLibtvName(value?.label || key, "视频", 24);
  const normalizedKey = String(key || label).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!normalizedKey) throw new Error("缺少视频平台项目标识");
  return { key: normalizedKey, label };
}

function workspaceDisplayName(moduleValue, workstationValue) {
  const module = normalizeModule(moduleValue);
  const workstation = normalizeWorkstation(workstationValue);
  return sanitizeLibtvName(`${module.label}工作台-${workstation.workstationLabel}`, `${module.label}工作台`);
}

function canvasDisplayName(taskDate, taskName) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(taskDate || "")) ? String(taskDate) : shanghaiDate(taskDate);
  return sanitizeLibtvName(`${date}-${sanitizeLibtvName(taskName, "任务一", 60)}`, `${date}-任务一`);
}

function shortHash(value, length = 24) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function bindingMarker(kind, bindingKey) {
  return `WIS-WORKBENCH-V${WORKBENCH_LAYOUT_VERSION}:${String(kind).toUpperCase()}:${shortHash(bindingKey, 20)}`;
}

function itemsFrom(payload, keys) {
  const containers = [payload, payload?.data, payload?.result].filter((item) => item && typeof item === "object");
  return containers.flatMap((container) => keys.flatMap((key) => Array.isArray(container[key]) ? container[key] : []));
}

function workspaceItems(payload = {}) {
  return itemsFrom(payload, ["workspaceMetaList", "workspaceList", "projectSpaceMetaList", "folderMetaList", "folderList", "folderEntries", "folders", "items", "list"]);
}

function projectItems(payload = {}) {
  return itemsFrom(payload, ["projectMetaList", "projectList", "projects", "items", "list"]);
}

function workspaceId(item = {}) {
  const value = Number(item?.workspaceId ?? item?.folderId ?? item?.spaceId ?? item?.id ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function projectId(item = {}) {
  return String(item?.uuid || item?.projectUuid || item?.projectId || item?.id || "").trim();
}

function descriptionOf(item = {}) {
  return String(item?.description || item?.desc || item?.remark || "");
}

function newestFirst(left, right) {
  const timestamp = (item) => {
    const numeric = Number(item?.updatedAtMs || item?.createdAtMs || item?.createAt || 0);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(String(item?.updatedAt || item?.createdAt || item?.createAt || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return timestamp(right) - timestamp(left);
}

function findWorkspace(payload, { name, teamId, marker, expectedId = 0 } = {}) {
  return workspaceItems(payload)
    .filter((item) => !expectedId || workspaceId(item) === Number(expectedId))
    .filter((item) => !name || String(item?.name || item?.title || "") === String(name))
    .filter((item) => teamId === undefined || item?.teamId === undefined || item?.teamId === null || Number(item.teamId || 0) === Number(teamId || 0))
    .filter((item) => !marker || descriptionOf(item).includes(marker))
    .sort(newestFirst)[0] || null;
}

function findProject(payload, { name, teamId, marker, expectedId = "" } = {}) {
  return projectItems(payload)
    .filter((item) => !expectedId || projectId(item) === String(expectedId))
    .filter((item) => !name || String(item?.name || item?.title || "") === String(name))
    .filter((item) => teamId === undefined || item?.teamId === undefined || item?.teamId === null || Number(item.teamId || 0) === Number(teamId || 0))
    .filter((item) => !marker || descriptionOf(item).includes(marker))
    .sort(newestFirst)[0] || null;
}

function createdWorkspaceId(payload = {}) {
  return workspaceId(payload?.workspaceMeta || payload?.data?.workspaceMeta || payload?.data || payload);
}

function createdProjectId(payload = {}) {
  return projectId(payload?.projectMeta || payload?.data?.projectMeta || payload?.data || payload);
}

function serialize(key, operation) {
  const previous = stateFlights.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  stateFlights.set(key, current);
  current.finally(() => {
    if (stateFlights.get(key) === current) stateFlights.delete(key);
  }).catch(() => {});
  return current;
}

async function readState(filePath) {
  try {
    const value = JSON.parse(await fsp.readFile(filePath, "utf8"));
    return Number(value?.version) === WORKBENCH_LAYOUT_VERSION ? value : null;
  } catch {
    return null;
  }
}

async function writeState(filePath, state) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fsp.writeFile(tempPath, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  await fsp.rename(tempPath, filePath);
}

function createWorkbenchLibtvManager({ runLibtv, getScope, parseJson = JSON.parse } = {}) {
  if (typeof runLibtv !== "function") throw new Error("runLibtv is required");
  if (typeof getScope !== "function") throw new Error("getScope is required");

  const runJson = async (args, failureMessage) => {
    const result = await runLibtv(args);
    if (Number(result?.code || 0) !== 0) {
      const detail = String(result?.stderr || result?.stdout || "").trim();
      throw new Error(detail ? `${failureMessage}：${detail}` : failureMessage);
    }
    let payload = null;
    try { payload = parseJson(result?.stdout || ""); } catch {}
    return { result, payload: payload || {} };
  };

  async function ensureTaskCanvas(input = {}) {
    const scope = getScope();
    if (!scope?.key || !scope?.configDir) throw new Error("当前任务没有绑定视频平台用户");
    const module = normalizeModule(input.module);
    const workstation = normalizeWorkstation(input.workstation || input);
    const ownerKey = String(input.ownerKey || scope.key).trim().toLowerCase();
    const accountKey = String(input.accountKey || "active-account").trim().toLowerCase();
    const teamId = Math.max(0, Math.trunc(Number(input.teamId || 0) || 0));
    const taskId = String(input.taskId || "").trim();
    if (!taskId) throw new Error("缺少业务任务ID，无法安全复用LibTV画布");
    const taskDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.taskDate || ""))
      ? String(input.taskDate)
      : shanghaiDate(input.taskCreatedAt || new Date());
    const taskName = sanitizeLibtvName(input.taskName, "任务一", 60);
    const workspaceName = workspaceDisplayName(module, workstation);
    const canvasName = canvasDisplayName(taskDate, taskName);
    const workspaceKey = ["workspace-v2", ownerKey, accountKey, `team-${teamId}`, workstation.workstationId, module.key].join("|");
    const canvasKey = [workspaceKey, `task-${taskId}`].join("|");
    const workspaceMarker = bindingMarker("workspace", workspaceKey);
    const canvasMarker = bindingMarker("canvas", canvasKey);
    const statePath = path.join(scope.configDir, `workbench-layout-v2-${module.key}.json`);

    return serialize(statePath, async () => {
      const state = await readState(statePath) || { version: WORKBENCH_LAYOUT_VERSION, workspaces: {}, canvases: {}, updatedAt: "" };
      state.workspaces ||= {};
      state.canvases ||= {};
      let workspaceBinding = state.workspaces[workspaceKey] || null;
      let resolvedWorkspaceId = Number(workspaceBinding?.workspaceId || 0);
      let workspaceReused = resolvedWorkspaceId > 0;

      if (!resolvedWorkspaceId) {
        const listArgs = ["workspace", "list", "--name", workspaceName, "--team-id", String(teamId), "-s", "50"];
        const listed = await runJson(listArgs, "读取LibTV视频项目失败");
        let meta = findWorkspace(listed.payload, { name: workspaceName, teamId, marker: workspaceMarker });
        resolvedWorkspaceId = workspaceId(meta);
        if (!resolvedWorkspaceId) {
          const description = `${workspaceMarker}；视频工作台自动管理，请勿修改绑定标记`;
          const created = await runJson(["workspace", "create", workspaceName, "-d", description, "--team-id", String(teamId)], "创建LibTV视频项目失败");
          resolvedWorkspaceId = createdWorkspaceId(created.payload);
          if (!resolvedWorkspaceId) {
            const refreshed = await runJson(listArgs, "复查LibTV视频项目失败");
            meta = findWorkspace(refreshed.payload, { name: workspaceName, teamId, marker: workspaceMarker })
              || findWorkspace(refreshed.payload, { name: workspaceName, teamId });
            resolvedWorkspaceId = workspaceId(meta);
          }
          workspaceReused = false;
        }
        if (!resolvedWorkspaceId) throw new Error(`LibTV视频项目已创建，但没有取得项目ID：${workspaceName}`);
        workspaceBinding = { workspaceId: resolvedWorkspaceId, workspaceName, marker: workspaceMarker, teamId, createdAt: new Date().toISOString() };
        state.workspaces[workspaceKey] = workspaceBinding;
      }

      let canvasBinding = state.canvases[canvasKey] || null;
      let resolvedProjectId = String(canvasBinding?.projectId || "").trim();
      let canvasReused = Boolean(resolvedProjectId);
      if (!resolvedProjectId) {
        const listArgs = ["project", "list", "--name", canvasName, "--team-id", String(teamId), "-w", String(resolvedWorkspaceId), "-s", "50"];
        const listed = await runJson(listArgs, "读取LibTV任务画布失败");
        let meta = findProject(listed.payload, { name: canvasName, teamId, marker: canvasMarker });
        resolvedProjectId = projectId(meta);
        if (!resolvedProjectId) {
          const description = `${canvasMarker}；业务任务ID=${taskId}；同一任务的多次生成均在此画布创建节点`;
          const created = await runJson(["project", "create", canvasName, "-d", description, "--team-id", String(teamId), "-w", String(resolvedWorkspaceId)], "创建LibTV任务画布失败");
          resolvedProjectId = createdProjectId(created.payload);
          if (!resolvedProjectId) {
            const refreshed = await runJson(listArgs, "复查LibTV任务画布失败");
            meta = findProject(refreshed.payload, { name: canvasName, teamId, marker: canvasMarker })
              || findProject(refreshed.payload, { name: canvasName, teamId });
            resolvedProjectId = projectId(meta);
          }
          canvasReused = false;
        }
        if (!resolvedProjectId) throw new Error(`LibTV任务画布已创建，但没有取得画布ID：${canvasName}`);
        canvasBinding = {
          projectId: resolvedProjectId,
          canvasName,
          workspaceId: resolvedWorkspaceId,
          marker: canvasMarker,
          taskId,
          taskDate,
          taskName,
          nextRunSlot: 0,
          runs: {},
          createdAt: new Date().toISOString()
        };
        state.canvases[canvasKey] = canvasBinding;
      }

      canvasBinding.runs ||= {};
      const runId = String(input.runId || taskId).trim();
      let runSlot = Number(canvasBinding.runs[runId]);
      if (!Number.isInteger(runSlot) || runSlot < 0) {
        runSlot = Math.max(0, Math.trunc(Number(canvasBinding.nextRunSlot || 0) || 0));
        canvasBinding.runs[runId] = runSlot;
        canvasBinding.nextRunSlot = runSlot + 1;
      }
      canvasBinding.taskName = taskName;
      canvasBinding.lastRequestedCanvasName = canvasName;
      canvasBinding.updatedAt = new Date().toISOString();
      state.updatedAt = canvasBinding.updatedAt;
      await writeState(statePath, state);

      return {
        version: WORKBENCH_LAYOUT_VERSION,
        moduleKey: module.key,
        workspaceKey,
        canvasKey,
        workspaceId: resolvedWorkspaceId,
        workspaceName: String(workspaceBinding.workspaceName || workspaceName),
        projectId: resolvedProjectId,
        canvasName: String(canvasBinding.canvasName || canvasName),
        requestedCanvasName: canvasName,
        canvasUrl: `https://www.liblib.tv/canvas?spaceId=${resolvedWorkspaceId}&projectId=${encodeURIComponent(resolvedProjectId)}`,
        teamId,
        taskId,
        taskDate,
        taskName,
        runSlot,
        workspaceReused,
        canvasReused,
        workstation
      };
    });
  }

  return { ensureTaskCanvas };
}

module.exports = {
  WORKBENCH_LAYOUT_VERSION,
  WORKBENCH_MODULES,
  bindingMarker,
  canvasDisplayName,
  createWorkbenchLibtvManager,
  findProject,
  findWorkspace,
  normalizeModule,
  normalizeWorkstation,
  projectId,
  sanitizeLibtvName,
  shanghaiDate,
  workspaceDisplayName,
  workspaceId
};
