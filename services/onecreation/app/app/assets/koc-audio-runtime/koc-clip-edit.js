"use strict";
const ACTIVE = new Set(["queued", "preparing", "validating", "running", "finalizing", "quality_checking"]);
function editKocClipList(job, index, restore, reconstructScript) {
  if (ACTIVE.has(job.status)) throw Object.assign(new Error("任务处理中，完成后才能删除或恢复分镜"), { statusCode: 409 });
  const tasks = [...(job.tasks || [])];
  const removed = [...(job.removedKocTasks || [])];
  if (restore) {
    const at = removed.findIndex(row => Number(row.task.index) === Number(index));
    if (at < 0) throw Object.assign(new Error("已删除的分镜不存在"), { statusCode: 404 });
    tasks.push(removed.splice(at, 1)[0].task);
  } else {
    const at = tasks.findIndex(task => Number(task.index) === Number(index));
    if (at < 0) throw Object.assign(new Error("分镜不存在"), { statusCode: 404 });
    removed.push({ task: tasks.splice(at, 1)[0], removedAt: new Date().toISOString() });
  }
  tasks.sort((a, b) => a.index - b.index);
  const oldScript = job.clipPlan?.lockedScript || "";
  job.tasks = tasks;
  job.removedKocTasks = removed;
  job.clipPlan = { ...job.clipPlan, clips: tasks, totalDuration: tasks.reduce((sum, task) => sum + Number(task.duration || 0), 0), durationSource: "manual", durationBasis: "人工调整分镜列表", lockedScript: reconstructScript(tasks, oldScript) };
  job.clipPlan.targetTotalDuration = job.clipPlan.totalDuration;
  job.summary = { total: tasks.length, success: tasks.filter(t => t.status === "success").length, failed: tasks.filter(t => t.status === "failed").length };
  job.reviewRevision = Number(job.reviewRevision || 0) + 1;
  // Keep the previous files and receipt as history until a replacement is confirmed.
  job.finalVideoPath = "";
  job.previewPath = "";
  job.finalVideoValidation = null;
  job.finalVideoDuration = 0;
  job.finalDelivery = { ...job.finalDelivery, status: "outdated", requested: false };
  job.error = "";
  job.status = !tasks.length || tasks.some(t => !["success", "failed"].includes(t.status)) ? "awaiting_review" : "partial";
  job.actionRequired = tasks.length ? "分镜列表已更新，完整视频将按剩余分镜重新拼接。" : "当前没有分镜，可恢复已删除分镜后继续。";
  return tasks.length > 0 && tasks.every(t => t.status === "success" && t.localPath);
}
module.exports = { editKocClipList };
