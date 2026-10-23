const sourceLink = document.querySelector("#remixLibrarySource");
const searchInput = document.querySelector("#remixSearch");
const filters = document.querySelector("#remixFilters");
const grid = document.querySelector("#remixLibraryGrid");
const empty = document.querySelector("#remixLibraryEmpty");
const visibleCount = document.querySelector("#remixVisibleCount");
const visibleLabel = document.querySelector("#remixVisibleLabel");
const versionLine = document.querySelector("#remixLibraryVersion");
const chain = document.querySelector("#remixChain");

const views = [
  ["originals", "完整原文"],
  ["patterns", "母版结构"],
  ["evidence", "有效证据"],
  ["sku", "品类边界"],
  ["failures", "失败反例"]
];

let library = null;
let originals = [];
let activeView = "originals";

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderChain() {
  chain.replaceChildren(...library.summary.effectiveChain.map((item, index) => {
    const block = node("div", "remix-chain-step");
    block.append(node("span", "", String(index + 1).padStart(2, "0")), node("b", "", item));
    return block;
  }));
}

function renderFilters() {
  filters.replaceChildren(...views.map(([id, label]) => {
    const button = node("button", id === activeView ? "is-active" : "", label);
    button.type = "button";
    button.addEventListener("click", () => {
      activeView = id;
      renderFilters();
      renderContent();
    });
    return button;
  }));
}

function matchesKeyword(parts, keyword) {
  return !keyword || parts.flat().join(" ").toLowerCase().includes(keyword);
}

function patternCard(item) {
  const card = node("article", "remix-rule-card remix-rule-card-pattern");
  const top = node("div", "remix-rule-top");
  top.append(node("span", "remix-rule-id", item.id), node("span", "remix-rule-kind", "母版结构"));
  const title = node("h2", "", item.name);
  const description = node("p", "remix-rule-description", item.description);
  const skeleton = node("div", "remix-rule-skeleton");
  skeleton.append(node("small", "", "成交骨架"), node("b", "", item.skeleton));
  const tags = node("div", "remix-rule-tags");
  tags.replaceChildren(...item.bestFor.map((value) => node("span", "", value)));
  const innovation = node("p", "remix-rule-detail", `可创新：${item.innovation.join("、")}`);
  const risk = node("p", "remix-rule-risk", `边界：${item.risk}`);
  const actions = node("div", "remix-rule-actions");
  const creation = node("button", "", "应用到一创");
  const remix = node("button", "", "应用到二创");
  creation.type = "button";
  remix.type = "button";
  const apply = (button, target) => {
    button.disabled = true;
    button.textContent = target === "creation" ? "已选中，进入一创…" : "已选中，进入二创…";
    window.WorkbenchKnowledge.select({
      ...item,
      source: "copy-remix-library",
      sourceUrl: library.sourceDoc
    }, target);
  };
  creation.addEventListener("click", () => apply(creation, "creation"));
  remix.addEventListener("click", () => apply(remix, "remix"));
  actions.append(creation, remix);
  card.append(top, title, description, skeleton, tags, innovation, risk, actions);
  return card;
}

function originalCard(item) {
  const card = node("article", "remix-rule-card remix-rule-card-original");
  const top = node("div", "remix-rule-top");
  top.append(
    node("span", "remix-rule-id", item.evidenceTier || "A"),
    node("span", "remix-rule-kind", item.category || "完整原文")
  );
  const title = node("h2", "", item.title || "历史有效原文");
  const meta = node("p", "remix-rule-description", `${item.productName || "WIS产品"} · ${item.tag || "历史有效"}`);
  const details = node("details", "remix-original-details");
  const summary = node("summary", "", "查看完整原文");
  const text = node("div", "", item.fullText || "原文暂未收录。");
  details.append(summary, text);
  const notes = [];
  if (item.matchedVideo) notes.push(`对应素材：${item.matchedVideo}`);
  if (item.riskNote) notes.push(`审核提醒：${item.riskNote}`);
  const note = node("p", item.riskNote ? "remix-rule-risk" : "remix-rule-detail", notes.join(" · "));
  note.hidden = !notes.length;
  const actions = node("div", "remix-rule-actions");
  const creation = node("button", "", "应用到一创");
  const remix = node("button", "", "应用到二创");
  const framework = {
    id: item.id,
    name: item.title,
    skeleton: `${item.category || "完整原文"} · ${item.tag || "历史有效"}`,
    description: "按完整原文保留钩子、语气、节奏和成交逻辑",
    originalText: item.fullText || "",
    category: item.category || "",
    productName: item.productName || "",
    evidenceTier: item.evidenceTier || "",
    source: "copy-remix-original",
    sourceUrl: item.sourceUrl || library.sourceDoc
  };
  const apply = (button, target) => {
    button.disabled = true;
    button.textContent = `已带入完整原文，进入${target === "creation" ? "一创" : "二创"}…`;
    window.WorkbenchKnowledge.select(framework, target);
  };
  creation.addEventListener("click", () => apply(creation, "creation"));
  remix.addEventListener("click", () => apply(remix, "remix"));
  actions.append(creation, remix);
  card.append(top, title, meta, details, note, actions);
  return card;
}

function evidenceCard(item) {
  const card = node("article", "remix-rule-card remix-rule-card-evidence");
  const top = node("div", "remix-rule-top");
  top.append(node("span", "remix-rule-id", item.tier), node("span", "remix-rule-kind", "历史结构证据"));
  card.append(
    top,
    node("h2", "", item.structure),
    node("p", "remix-rule-metrics", item.metrics),
    node("p", "remix-rule-detail", `应学习：${item.learning}`)
  );
  return card;
}

function skuCard(item) {
  const card = node("article", "remix-rule-card remix-rule-card-sku");
  const top = node("div", "remix-rule-top");
  top.append(node("span", "remix-rule-id", "SKU"), node("span", "remix-rule-kind", "品类隔离"));
  const prefer = node("div", "remix-rule-list");
  prefer.append(node("b", "", "优先表达"), node("p", "", item.prefer.join("、")));
  const forbid = node("div", "remix-rule-list remix-rule-list-risk");
  forbid.append(node("b", "", "未经确认不得迁入"), node("p", "", item.forbidUnlessVerified.join("、")));
  card.append(top, node("h2", "", item.name), prefer, forbid);
  return card;
}

function failureCard(text, index) {
  const card = node("article", "remix-rule-card remix-rule-card-failure");
  const top = node("div", "remix-rule-top");
  top.append(node("span", "remix-rule-id", `C${String(index + 1).padStart(2, "0")}`), node("span", "remix-rule-kind", "生成前拦截"));
  card.append(top, node("h2", "", text), node("p", "remix-rule-detail", "检测到该模式时返回修改，不直接进入视频生成。"));
  return card;
}

function renderContent() {
  const keyword = String(searchInput.value || "").trim().toLowerCase();
  let items = [];
  let cards = [];
  let label = "项可用规则";

  if (activeView === "originals") {
    items = originals.filter((item) => matchesKeyword([
      item.title, item.tag, item.category, item.productName, item.fullText,
      item.matchedVideo, item.riskNote
    ], keyword));
    cards = items.map(originalCard);
    label = "条完整原文";
  } else if (activeView === "patterns") {
    items = library.patterns.filter((item) => matchesKeyword([item.id, item.name, item.description, item.skeleton, item.bestFor, item.innovation, item.risk], keyword));
    cards = items.map(patternCard);
    label = "种母版结构";
  } else if (activeView === "evidence") {
    items = library.effectiveExamples.filter((item) => matchesKeyword([item.tier, item.structure, item.metrics, item.learning], keyword));
    cards = items.map(evidenceCard);
    label = "条数据证据";
  } else if (activeView === "sku") {
    items = library.skuBoundaries.filter((item) => matchesKeyword([item.name, item.prefer, item.forbidUnlessVerified], keyword));
    cards = items.map(skuCard);
    label = "项品类边界";
  } else {
    items = library.failurePatterns.filter((item) => matchesKeyword([item], keyword));
    cards = items.map(failureCard);
    label = "个失败模式";
  }

  visibleCount.textContent = String(items.length);
  visibleLabel.textContent = label;
  empty.hidden = items.length > 0;
  grid.replaceChildren(...cards);
}

async function loadLibrary() {
  try {
    const [rulesResponse, originalsResponse] = await Promise.all([
      fetch("/copy-remix-library.json", { cache: "no-store" }),
      fetch("./api/copy-library/assets?library=second&pageSize=100", {
        cache: "no-store",
        credentials: "same-origin"
      })
    ]);
    const [data, originalData] = await Promise.all([rulesResponse.json(), originalsResponse.json()]);
    if (!rulesResponse.ok) throw new Error(data.error || "二创框架库读取失败");
    if (!originalsResponse.ok) throw new Error(originalData.error || "二创完整原文读取失败");
    library = data;
    originals = originalData.items || [];
    sourceLink.href = data.sourceDoc;
    versionLine.textContent = `规则版本 ${data.version} · ${data.summary.patternCount}种母版结构 · ${originals.length}条完整原文`;
    renderChain();
    renderFilters();
    renderContent();
    if (!sessionStorage.getItem("copy-library-shared-synced")) {
      fetch("./api/copy-library/sync", { method: "POST", credentials: "same-origin" })
        .then((response) => {
          if (response.ok) sessionStorage.setItem("copy-library-shared-synced", "1");
        })
        .catch(() => {});
    }
  } catch (error) {
    versionLine.textContent = "规则暂未载入";
    empty.hidden = false;
    empty.textContent = error.message || "二创文案库读取失败，请刷新重试。";
  }
}

searchInput.addEventListener("input", () => {
  if (library) renderContent();
});

loadLibrary();
