(function () {
  const STORAGE_KEY = "brand-marketing-selected-framework";

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return value && value.id && value.name ? value : null;
    } catch {
      return null;
    }
  }

  function save(framework, target = "") {
    const value = {
      id: String(framework.id || "").slice(0, 120),
      name: String(framework.name || "").slice(0, 300),
      skeleton: String(framework.skeleton || "").slice(0, 2000),
      description: String(framework.description || "").slice(0, 2000),
      originalText: String(framework.originalText || framework.fullText || "").slice(0, 50000),
      category: String(framework.category || "").slice(0, 200),
      productName: String(framework.productName || "").slice(0, 300),
      evidenceTier: String(framework.evidenceTier || "").slice(0, 40),
      source: String(framework.source || "").slice(0, 100),
      sourceUrl: String(framework.sourceUrl || "").slice(0, 4000),
      target: String(target || framework.target || "").slice(0, 24),
      selectedAt: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    return value;
  }

  async function post(url, body) {
    try {
      await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch {
      // 协作服务短暂不可用时不阻塞本地创作，后续任务记录仍会保留。
    }
  }

  async function select(framework, target) {
    const selected = save(framework, target);
    const key = `framework:${selected.source || "library"}:${selected.id}`;
    await Promise.allSettled([
      post("./api/team-workbench/resources", {
        recordKey: key,
        recordType: "copy_framework",
        title: selected.name,
        sourceType: selected.source || "copy_library",
        sourceUrl: selected.sourceUrl || "",
        frameworkKey: key,
        status: "active",
        approved: true,
        metadata: {
          skeleton: selected.skeleton,
          description: selected.description,
          library: selected.source,
          category: selected.category,
          productName: selected.productName,
          evidenceTier: selected.evidenceTier,
          originalText: selected.originalText,
          selectedAt: selected.selectedAt
        }
      }),
      post("./api/team-workbench/events", {
        eventKey: `framework-selected:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`,
        eventType: "framework_selected",
        frameworkKey: key,
        payload: { target, name: selected.name }
      })
    ]);
    sessionStorage.setItem("brand-marketing-framework-confirmation", JSON.stringify({
      name: selected.name,
      target,
      at: Date.now()
    }));
    const destination = target === "remix" ? "./remix.html#planning" : "./#creation";
    window.location.assign(destination);
  }

  function enrich(config) {
    const selected = read();
    return selected ? { ...config, knowledgeFramework: selected } : config;
  }

  function record(eventType, resourceKey, payload) {
    const selected = read();
    return post("./api/team-workbench/events", {
      eventKey: `${eventType}:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`,
      eventType,
      resourceKey: resourceKey || "",
      frameworkKey: selected ? `framework:${selected.source || "library"}:${selected.id}` : "",
      lineageKey: resourceKey || "",
      payload: { ...(payload || {}), framework: selected || null }
    });
  }

  function renderBanner() {
    const selected = read();
    if (!selected || document.querySelector(".knowledge-context-banner")) return;
    const main = document.querySelector("main");
    const header = main?.querySelector("header");
    const slot = document.querySelector(".knowledge-context-slot");
    if (!main || (!slot && !header)) return;
    const banner = document.createElement("aside");
    banner.className = "knowledge-context-banner";
    const targetLabel = selected.target === "remix" ? "二创" : selected.target === "creation" ? "一创" : "当前任务";
    banner.innerHTML = `<div><b>已应用到${targetLabel} ✓</b><span></span><small></small></div><button type="button">取消带入</button>`;
    banner.querySelector("span").textContent = selected.name;
    banner.querySelector("small").textContent = selected.originalText
      ? `已带入完整原文：${selected.originalText.slice(0, 120)}${selected.originalText.length > 120 ? "…" : ""}`
      : selected.skeleton || selected.description || "生成时保留该框架的成交因果";
    banner.querySelector("button").addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      banner.remove();
    });
    if (slot) slot.replaceChildren(banner);
    else header.insertAdjacentElement("afterend", banner);
  }

  window.WorkbenchKnowledge = { read, save, select, enrich, record };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderBanner);
  else renderBanner();
})();
