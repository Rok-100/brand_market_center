"use strict";

(() => {
  const STORAGE_KEY = "wis-person-studio-current-job";
  const requested = new URLSearchParams(location.search).get("job");
  if (requested) localStorage.setItem(STORAGE_KEY, requested);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const label = (status) => ({ queued: "排队中", preparing: "准备中", running: "生成中", downloading: "下载中", success: "已完成", completed: "已完成", partial: "部分完成", failed: "失败", review_required: "待复核" })[status] || status || "已保存";

  function render(rows) {
    const list = document.querySelector("#moduleTaskList");
    const current = localStorage.getItem(STORAGE_KEY) || "";
    document.querySelector("#moduleTaskCount").textContent = `${rows.length} 个历史任务`;
    list.innerHTML = rows.map((job) => {
      const tasks = Array.isArray(job.tasks) ? job.tasks : [];
      const done = tasks.filter((task) => ["success", "failed", "review_required"].includes(task.status)).length;
      const isCurrent = job.id === current;
      return `<button class="module-task-row ${isCurrent ? "current" : ""}" type="button" data-person-task="${escapeHtml(job.id)}"><span class="module-task-state ${escapeHtml(job.status)}">${escapeHtml(label(job.status))}</span><span class="module-task-copy"><b>${escapeHtml(job.productName || job.config?.productName || job.sourceName || "人物视频")}</b><small>${escapeHtml(new Date(job.updatedAt || job.createdAt).toLocaleString("zh-CN", { hour12: false }))} · ${done}/${tasks.length || job.videoCount || "?"} 个结果</small></span><span class="module-task-open">${isCurrent ? "当前任务" : "打开"} →</span></button>`;
    }).join("") || '<p class="module-task-empty">还没有历史任务。任务创建后会在后台继续运行。</p>';
    list.querySelectorAll("[data-person-task]").forEach((button) => button.addEventListener("click", () => {
      localStorage.setItem(STORAGE_KEY, button.dataset.personTask);
      location.href = `./?job=${encodeURIComponent(button.dataset.personTask)}`;
    }));
  }

  async function refresh() {
    const button = document.querySelector("#moduleTaskRefresh");
    button.disabled = true;
    try {
      const response = await fetch("./api/person-jobs?limit=50");
      const rows = await response.json();
      if (!response.ok) throw new Error(rows.error || "任务列表读取失败");
      render(Array.isArray(rows) ? rows : []);
    } catch (error) {
      document.querySelector("#moduleTaskList").innerHTML = `<p class="module-task-empty error">${escapeHtml(error.message)}</p>`;
    } finally { button.disabled = false; }
  }

  function start() {
    const hero = document.querySelector(".hero");
    if (!hero) return;
    const section = document.createElement("section");
    section.className = "module-task-center";
    section.id = "moduleTaskCenter";
    section.innerHTML = '<div class="module-task-head"><div><small>任务中心</small><h2>AI明星画面任务</h2><p>每个任务独立保存人物素材、生成设置与结果；关闭页面后，后台任务不会中断。</p></div><div class="module-task-actions"><span id="moduleTaskCount">正在读取</span><button id="moduleTaskRefresh" type="button">刷新</button><button class="primary" id="moduleTaskNew" type="button">＋ 新建任务</button></div></div><div class="module-task-list" id="moduleTaskList"><p class="module-task-empty">正在读取任务…</p></div>';
    hero.insertAdjacentElement("afterend", section);
    section.querySelector("#moduleTaskRefresh").addEventListener("click", refresh);
    section.querySelector("#moduleTaskNew").addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      location.href = "./?new=1";
    });
    refresh();
    window.addEventListener("person-task-updated", refresh);
    window.setInterval(refresh, 10000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})();
