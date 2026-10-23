(function exposeWorkbenchWorkstation(global) {
  "use strict";

  const STORAGE_KEY = "ai-product-workbench-workstation-v1";
  const COOKIE_KEY = "ai_workbench_workstation_v1";

  function cookieId() {
    const row = String(global.document.cookie || "").split(";").map((item) => item.trim())
      .find((item) => item.startsWith(`${COOKIE_KEY}=`));
    return row ? decodeURIComponent(row.slice(COOKIE_KEY.length + 1)) : "";
  }

  function persistCookie(id) {
    global.document.cookie = `${COOKIE_KEY}=${encodeURIComponent(id)}; Max-Age=31536000; Path=/; SameSite=Lax`;
  }

  function createId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    global.crypto?.getRandomValues?.(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function identity() {
    let id = String(cookieId() || global.localStorage.getItem(STORAGE_KEY) || "").trim().toLowerCase();
    const compact = id.replace(/[^a-z0-9]/g, "");
    if (compact.length < 16) {
      id = createId();
    }
    global.localStorage.setItem(STORAGE_KEY, id);
    persistCookie(id);
    const shortId = id.replace(/[^a-z0-9]/g, "").slice(-8).toUpperCase();
    return { id, label: `电脑-${shortId}`, workstationId: id, workstationLabel: `电脑-${shortId}` };
  }

  global.WorkbenchWorkstation = Object.freeze({ STORAGE_KEY, COOKIE_KEY, identity });
  identity();
})(window);
