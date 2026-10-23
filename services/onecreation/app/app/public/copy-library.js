const COPY_LIBRARY_SOURCE = "https://jqx28l0j4lx.feishu.cn/wiki/LPoJw9cnKiFBkyk9JQbcBI97nOe";
const COPY_CATEGORIES = [
  { id: "chat-koc", name: "唠嗑KOC脚本" },
  { id: "paid-koc", name: "付费KOC脚本" },
  { id: "story", name: "剧情脚本" }
];

const searchInput = document.querySelector("#copySearch");
const filters = document.querySelector("#copyFilters");
const grid = document.querySelector("#copyLibraryGrid");
const empty = document.querySelector("#copyLibraryEmpty");
const visibleCount = document.querySelector("#copyVisibleCount");
const sourceLink = document.querySelector("#copyLibrarySource");
let activeCategory = "all";
let allItems = [];

sourceLink.href = COPY_LIBRARY_SOURCE;

function categoryCount(id) {
  return id === "all" ? allItems.length : allItems.filter((item) => item.categoryId === id).length;
}

function renderFilters() {
  const options = [{ id: "all", name: "全部" }, ...COPY_CATEGORIES];
  filters.replaceChildren(...options.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = item.id === activeCategory ? "is-active" : "";
    button.textContent = `${item.name} ${categoryCount(item.id)}`;
    button.addEventListener("click", () => {
      activeCategory = item.id;
      renderFilters();
      renderLibrary();
    });
    return button;
  }));
}

function applyButton(label, target, framework) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => {
    button.disabled = true;
    button.textContent = `已带入完整原文，进入${target === "creation" ? "一创" : "二创"}…`;
    window.WorkbenchKnowledge.select(framework, target);
  });
  return button;
}

function originalDetails(item) {
  const details = document.createElement("details");
  details.className = "copy-library-original";
  const summary = document.createElement("summary");
  summary.textContent = "查看完整原文";
  const content = document.createElement("div");
  content.textContent = item.fullText || "原文暂未收录。";
  details.append(summary, content);
  return details;
}

function renderLibrary() {
  const keyword = String(searchInput.value || "").trim().toLowerCase();
  const visible = allItems.filter((item) => {
    const inCategory = activeCategory === "all" || item.categoryId === activeCategory;
    const searchable = [
      item.title, item.tag, item.category, item.description, item.fullText
    ].join(" ").toLowerCase();
    return inCategory && (!keyword || searchable.includes(keyword));
  });
  visibleCount.textContent = String(visible.length);
  empty.hidden = visible.length > 0;
  grid.replaceChildren(...visible.map((item) => {
    const card = document.createElement("article");
    card.className = `copy-library-card copy-library-card-${item.categoryId || "other"}`;
    const type = document.createElement("span");
    type.className = "copy-library-card-type";
    type.textContent = item.category || "有效文案";
    const title = document.createElement("h2");
    title.textContent = item.title;
    const tag = document.createElement("span");
    tag.className = "copy-library-card-tag";
    tag.textContent = item.tag || "历史有效";
    const source = document.createElement("a");
    source.className = "copy-library-card-source";
    source.textContent = "查看飞书源文档 ↗";
    source.href = item.sourceUrl || COPY_LIBRARY_SOURCE;
    source.target = "_blank";
    source.rel = "noopener";
    const buttons = document.createElement("div");
    buttons.className = "remix-rule-actions";
    const framework = {
      id: item.id,
      name: item.title,
      skeleton: `${item.category || "有效文案"} · ${item.tag || "历史有效"}`,
      description: item.description || "按完整原文保留钩子、人物关系、叙事节奏和成交逻辑",
      originalText: item.fullText || "",
      category: item.category || "",
      productName: item.productName || "",
      evidenceTier: item.evidenceTier || "",
      source: "copy-library",
      sourceUrl: item.sourceUrl || COPY_LIBRARY_SOURCE
    };
    buttons.append(
      applyButton("应用到一创", "creation", framework),
      applyButton("应用到二创", "remix", framework)
    );
    card.append(type, title, tag, originalDetails(item), source, buttons);
    return card;
  }));
}

async function syncSharedLibrary() {
  try {
    const response = await fetch("./api/copy-library/sync", {
      method: "POST",
      credentials: "same-origin"
    });
    if (!response.ok) throw new Error("部门文案云库暂未同步");
    sessionStorage.setItem("copy-library-shared-synced", "1");
  } catch {
    // 内置原文仍可直接使用；登录或网络恢复后下次打开会自动重试同步。
  }
}

async function loadLibrary() {
  try {
    const response = await fetch("./api/copy-library/assets?library=first&pageSize=100", {
      cache: "no-store",
      credentials: "same-origin"
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "一创文案库读取失败");
    allItems = data.items || [];
    renderFilters();
    renderLibrary();
    if (!sessionStorage.getItem("copy-library-shared-synced")) syncSharedLibrary();
  } catch (error) {
    empty.hidden = false;
    empty.textContent = error.message || "一创文案库读取失败，请刷新重试。";
  }
}

searchInput.addEventListener("input", renderLibrary);
loadLibrary();
