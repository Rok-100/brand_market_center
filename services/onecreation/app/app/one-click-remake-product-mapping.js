const PRODUCT_STATE_TYPES = Object.freeze([
  Object.freeze({ id: "retail_outer_box", label: "零售外盒" }),
  Object.freeze({ id: "primary_container", label: "主容器 / 瓶罐" }),
  Object.freeze({ id: "single_unit", label: "单片 / 单支" }),
  Object.freeze({ id: "content", label: "内容物" }),
  Object.freeze({ id: "open_state", label: "打开状态" }),
  Object.freeze({ id: "usage_state", label: "使用状态" }),
  Object.freeze({ id: "product_combination", label: "产品组合" })
]);

const STATE_LABELS = Object.fromEntries(PRODUCT_STATE_TYPES.map((item) => [item.id, item.label]));
const STATIC_ACTIONS = new Set(["陈列", "手持", "推倒"]);
const ACTION_PATTERNS = Object.freeze([
  ["按压喷洒", /按压.{0,8}(喷|雾)|喷洒|喷出|细雾|雾化/],
  ["摇匀", /摇匀|摇晃/],
  ["拔盖", /拔盖|取下.{0,4}盖/],
  ["开盒", /开盒|打开.{0,4}盒/],
  ["取单支", /取下.{0,4}(单支|一支)|取出.{0,4}(单支|一支)/],
  ["掰断出液", /掰断|折断.{0,4}(帽|盖)|挤出.{0,4}(精华|液体)/],
  ["开罐", /开罐|打开.{0,4}罐|旋开.{0,4}罐/],
  ["挖取", /挖取|勺取|搅拌/],
  ["揭膜", /揭下.{0,6}(膜|保护膜)|揭膜/],
  ["涂抹", /涂抹|厚敷|上脸/],
  ["推倒", /推倒|扫倒/],
  ["手持", /拿起|手持|握住|抱持/],
  ["陈列", /陈列|堆放|摆放|排列/]
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function safeText(value, limit = 2000) {
  return String(value ?? "").trim().slice(0, limit);
}

function profileFromProduct(product = {}) {
  return product.productProfile || product.replacementContract || product;
}

function stateLabel(id) {
  return STATE_LABELS[id] || id || "未知形态";
}

function normalizeLayer(value) {
  const text = safeText(value, 100).toLowerCase();
  if (!text) return "";
  if (["retail_outer_box", "outer_box", "box", "package_box"].includes(text)) return "retail_outer_box";
  if (["primary_container", "bottle_body", "bottle", "jar"].includes(text)) return "primary_container";
  if (["single_unit", "single_sachet", "single_ampoule", "ampoule_strip"].includes(text)) return "single_unit";
  if (["content", "content_unit", "folded_content", "protective_film"].includes(text)) return "content";
  if (["open_state", "open"].includes(text)) return "open_state";
  if (["usage_state", "usage"].includes(text)) return "usage_state";
  if (["product_combination", "combination"].includes(text)) return "product_combination";
  return "";
}

function ratioFromDimensions(dimensions = {}) {
  const length = Number(dimensions.length || dimensions.diameter || 0);
  const width = Number(dimensions.width || dimensions.diameter || 0);
  const height = Number(dimensions.height || 0);
  if (!(length > 0 && width > 0 && height > 0)) return [];
  return [length, width, height];
}

function normalizeDimensions(raw = {}, layer = "") {
  if (!raw || typeof raw !== "object") return {};
  const diameter = Number(raw.diameter || 0);
  const length = Number(raw.length || raw.width || diameter || 0);
  const width = Number(raw.depth || (diameter ? diameter : raw.width && layer !== "retail_outer_box" ? raw.width : 0));
  const height = Number(raw.height || 0);
  return {
    ...(length > 0 ? { length } : {}),
    ...(width > 0 ? { width } : {}),
    ...(height > 0 ? { height } : {}),
    ...(diameter > 0 ? { diameter } : {})
  };
}

function inferredShape(layer, dimensions = {}, explicit = "") {
  if (safeText(explicit)) return safeText(explicit, 240);
  if (dimensions.diameter) return "正圆柱";
  if (layer === "retail_outer_box") return "矩形外盒";
  if (layer === "single_unit") return "独立单片 / 单支";
  if (layer === "content") return "内容物";
  return "";
}

function orientationFromDimensions(dimensions = {}) {
  const values = [
    ["length", Number(dimensions.length || 0)],
    ["width", Number(dimensions.width || 0)],
    ["height", Number(dimensions.height || 0)]
  ].filter((item) => item[1] > 0).sort((left, right) => right[1] - left[1]);
  if (!values.length) return "unknown";
  if (values[0][0] === "height") return "vertical";
  if (values[0][0] === "length") return "horizontal";
  return "depth_dominant";
}

function explicitStateOverrides(profile = {}) {
  const rows = Array.isArray(profile.remakeStates) ? profile.remakeStates : [];
  return new Map(rows.map((item) => [normalizeLayer(item?.id || item?.layer), item]).filter((item) => item[0]));
}

function groupedAssetLayer(layer, product = {}) {
  const normalizedLayer = normalizeLayer(layer);
  const profile = profileFromProduct(product) || {};
  const aliases = profile.remakeAssetStateAliases && typeof profile.remakeAssetStateAliases === "object"
    ? profile.remakeAssetStateAliases
    : {};
  return normalizeLayer(aliases[normalizedLayer]) || normalizedLayer;
}

function profileLayerDimensions(profile = {}, layer = "") {
  const dimensions = profile.dimensionsCm || {};
  const geometry = profile.replacementGeometry || {};
  if (normalizeLayer(geometry.layer) === layer && geometry.dimensionsCm) return normalizeDimensions(geometry.dimensionsCm, layer);
  if (layer === "retail_outer_box") return normalizeDimensions(dimensions.retailOuterBox, layer);
  if (layer === "primary_container") {
    return normalizeDimensions(dimensions.primaryContainer || dimensions.bottleBody, layer);
  }
  if (layer === "single_unit") {
    return normalizeDimensions(dimensions.singleSachet || dimensions.singleAmpoule || dimensions.ampouleStrip, layer);
  }
  if (layer === "content") return normalizeDimensions(dimensions.foldedContent || dimensions.content, layer);
  return {};
}

function packageLayers(profile = {}) {
  const layers = [];
  for (const value of profile.packageHierarchy || []) {
    const layer = normalizeLayer(value);
    if (layer && !layers.includes(layer)) layers.push(layer);
  }
  for (const item of profile.remakeStates || []) {
    const layer = normalizeLayer(item?.id || item?.layer);
    if (layer && !layers.includes(layer)) layers.push(layer);
  }
  const geometryLayer = normalizeLayer(profile.replacementGeometry?.layer);
  if (geometryLayer && !layers.includes(geometryLayer)) layers.push(geometryLayer);
  return layers;
}

function inferAssetFacts(asset = {}, product = {}, states = []) {
  const explicitLayer = normalizeLayer(asset.productState || asset.displayState || asset.layer || asset.assetLayer || asset.assetRole);
  const text = `${asset.title || ""} ${asset.fileName || ""} ${asset.angleLabel || ""} ${asset.angle || ""}`.toLowerCase();
  let layer = explicitLayer;
  let confidence = explicitLayer ? 0.98 : 0;
  let evidence = explicitLayer ? "资产元数据已标注产品形态 / 资产角色" : "";
  if (!layer) {
    const rules = [
      ["product_combination", /组合|全家福|套装|外盒.{0,6}(瓶|罐|单支)|盒.{0,3}\+.{0,3}(瓶|罐|单支)/],
      ["usage_state", /使用|上脸|涂抹|喷洒|出液|贴敷/],
      ["open_state", /开盒|开盖|开罐|打开状态|开启状态/],
      ["retail_outer_box", /零售外盒|外盒|包装盒|盒装|盒正面|盒背面|盒侧面/],
      ["content", /内容物|膜布|凝胶|质地|液体|精华液微距/],
      ["single_unit", /单片|单袋|单支|联排|安瓶|次抛管/],
      ["primary_container", /瓶体|瓶装|圆罐|罐体|主容器|喷雾瓶|精华瓶/]
    ];
    const matched = rules.find((item) => item[1].test(text));
    if (matched) {
      layer = matched[0];
      confidence = 0.84;
      evidence = `根据资产名称 / 角度标签识别为${stateLabel(layer)}`;
    }
  }
  if (!layer) {
    const profile = profileFromProduct(product);
    layer = normalizeLayer(profile.remakeDefaultStateId || profile.quantityStrategy?.displayUnit || profile.replacementGeometry?.layer)
      || states.find((item) => item.isDefault)?.id || states[0]?.id || "";
    confidence = 0.45;
    evidence = `资产没有形态元数据，暂按 SKU 默认形态${stateLabel(layer)}归类，需人工核实`;
  }
  const semanticLayer = layer;
  const groupedLayer = groupedAssetLayer(semanticLayer, product);
  if (groupedLayer && groupedLayer !== semanticLayer) {
    layer = groupedLayer;
    evidence = `${evidence}；按 SKU 展示规则并入${stateLabel(groupedLayer)}`;
  }
  let view = safeText(asset.view || asset.angle, 80).toLowerCase();
  if (!view || view === "unknown") {
    if (/背面|back/.test(text)) view = "back";
    else if (/侧面|侧视|side/.test(text)) view = "side";
    else if (/顶视|俯视|top/.test(text)) view = "top";
    else if (/正面|front/.test(text)) view = "front";
    else view = "unknown";
  }
  const status = semanticLayer === "usage_state" || /使用|上脸|涂抹|喷洒|出液/.test(text)
    ? "usage"
    : semanticLayer === "open_state" || /开盒|开盖|开罐|打开/.test(text) ? "open" : "closed";
  return { layer, layerLabel: stateLabel(layer), view, status, confidence, evidence };
}

function buildProductStateCatalog(product = {}, assets = []) {
  const profile = profileFromProduct(product) || {};
  const overrides = explicitStateOverrides(profile);
  const defaultLayer = normalizeLayer(profile.remakeDefaultStateId || profile.quantityStrategy?.displayUnit || profile.replacementGeometry?.layer);
  const layers = packageLayers(profile);
  for (const asset of assets || []) {
    const assetLayer = normalizeLayer(asset.productState || asset.displayState || asset.layer || asset.assetLayer || asset.assetRole);
    if (assetLayer && !layers.includes(assetLayer)) layers.push(assetLayer);
  }
  const states = layers.map((layer) => {
    const override = overrides.get(layer) || {};
    const geometry = normalizeLayer(profile.replacementGeometry?.layer) === layer ? profile.replacementGeometry || {} : {};
    const dimensionsCm = normalizeDimensions(override.dimensionsCm || geometry.dimensionsCm || profileLayerDimensions(profile, layer), layer);
    const fixedRatio = clone(override.fixedLengthWidthHeightRatio || geometry.fixedLengthWidthHeightRatio || ratioFromDimensions(dimensionsCm));
    const allowedActions = clone(override.allowedActions || []);
    const forbiddenActions = clone(override.forbiddenActions || []);
    const state = {
      id: layer,
      label: safeText(override.label, 100) || stateLabel(layer),
      shape: inferredShape(layer, dimensionsCm, override.shape || geometry.shape),
      dimensionsCm,
      fixedLengthWidthHeightRatio: fixedRatio,
      heightToDiameter: override.heightToDiameter || geometry.heightToDiameter || null,
      orientation: safeText(override.orientation, 60) || orientationFromDimensions(dimensionsCm),
      orientationRule: safeText(override.orientationRule || geometry.orientationRule, 1200),
      invariants: clone(override.invariants || geometry.invariants || []),
      allowedActions,
      forbiddenActions,
      usageFlow: safeText(override.usageFlow || profile.usage, 3000),
      isDefault: layer === defaultLayer,
      selectable: false,
      assets: [],
      dataGaps: []
    };
    state.assets = (assets || []).map((asset) => ({ asset, facts: inferAssetFacts(asset, product, []) }))
      .filter((item) => item.facts.layer === layer)
      .map((item) => ({
        id: String(item.asset.id || ""),
        title: item.asset.title || item.asset.fileName || item.asset.id || "",
        fileName: item.asset.fileName || "",
        angleLabel: item.asset.angleLabel || "",
        thumbnailUrl: item.asset.thumbnailUrl || "",
        storageUrl: item.asset.storageUrl || item.asset.previewUrl || "",
        ...item.facts
      }));
    if (!Object.keys(dimensionsCm).length) state.dataGaps.push("缺少该形态尺寸，禁止自动布局");
    if (!state.assets.length) state.dataGaps.push("OSS 中缺少该形态可匹配资产");
    if (!allowedActions.length && !forbiddenActions.length) state.dataGaps.push("缺少动作白名单 / 禁止动作信息");
    state.selectable = Object.keys(dimensionsCm).length > 0 && state.assets.length > 0;
    return state;
  });
  if (defaultLayer && !states.some((item) => item.id === defaultLayer)) {
    states.push({
      id: defaultLayer,
      label: stateLabel(defaultLayer),
      shape: "",
      dimensionsCm: {},
      fixedLengthWidthHeightRatio: [],
      heightToDiameter: null,
      orientation: "unknown",
      orientationRule: "",
      invariants: [],
      allowedActions: [],
      forbiddenActions: [],
      usageFlow: safeText(profile.usage, 3000),
      isDefault: true,
      selectable: false,
      assets: [],
      dataGaps: ["缺少默认形态资料", "OSS 中缺少该形态可匹配资产"]
    });
  }
  return states;
}

function recommendDisplayState(product = {}, states = []) {
  const profile = profileFromProduct(product) || {};
  const preferredId = normalizeLayer(profile.remakeDefaultStateId || profile.quantityStrategy?.displayUnit || profile.replacementGeometry?.layer);
  const preferred = states.find((item) => item.id === preferredId && item.selectable);
  return preferred || states.find((item) => item.selectable) || states.find((item) => item.id === preferredId) || states[0] || null;
}

function detectActions(...values) {
  const text = values.flat(Infinity).filter(Boolean).join("\n");
  return ACTION_PATTERNS.filter((item) => item[1].test(text)).map((item) => item[0]);
}

function normalizeSourceAssetFacts(asset = {}, sourceProduct = {}, sourceStates = []) {
  const explicit = asset.productFacts || asset.productClassification || {};
  const inferred = inferAssetFacts({
    ...asset,
    productState: explicit.layer || explicit.productState || asset.productState,
    view: explicit.view || asset.view
  }, sourceProduct, sourceStates);
  const actions = Array.isArray(explicit.actions) && explicit.actions.length
    ? explicit.actions.map((item) => safeText(item, 100)).filter(Boolean)
    : detectActions(asset.label, asset.role, asset.reason);
  return {
    layer: normalizeLayer(explicit.layer || explicit.productState) || inferred.layer,
    layerLabel: stateLabel(normalizeLayer(explicit.layer || explicit.productState) || inferred.layer),
    shape: safeText(explicit.shape, 240),
    view: safeText(explicit.view, 80) || inferred.view,
    status: safeText(explicit.status, 80) || inferred.status,
    actions,
    confidence: Number(explicit.confidence ?? inferred.confidence),
    evidence: safeText(explicit.evidence || inferred.evidence || asset.reason, 2000)
  };
}

function geometryRisk(sourceState = {}, targetState = {}) {
  const source = ratioFromDimensions(sourceState.dimensionsCm || {});
  const target = ratioFromDimensions(targetState.dimensionsCm || {});
  const reasons = [];
  if (source.length !== 3 || target.length !== 3) {
    return { level: "high", label: "高风险", sizeDeltaPct: null, reasons: ["源或目标形态缺少完整长宽高，不能自动校准比例"] };
  }
  const sourceNormalized = source.map((value) => value / Math.max(...source));
  const targetNormalized = target.map((value) => value / Math.max(...target));
  const delta = Math.max(...sourceNormalized.map((value, index) => Math.abs(value - targetNormalized[index]) / Math.max(value, 0.001)));
  const sourceOrientation = sourceState.orientation || orientationFromDimensions(sourceState.dimensionsCm);
  const targetOrientation = targetState.orientation || orientationFromDimensions(targetState.dimensionsCm);
  let level = delta <= 0.15 ? "low" : delta <= 0.4 ? "medium" : "high";
  if (sourceState.id && targetState.id && sourceState.id !== targetState.id) {
    level = "high";
    reasons.push(`产品层级从${stateLabel(sourceState.id)}变为${stateLabel(targetState.id)}`);
  }
  if (sourceOrientation !== "unknown" && targetOrientation !== "unknown" && sourceOrientation !== targetOrientation) {
    level = "high";
    reasons.push(`主方向从${sourceOrientation}变为${targetOrientation}`);
  }
  if (delta > 0.4) reasons.push("归一化长宽高差异超过 40%");
  else if (delta > 0.15) reasons.push("归一化长宽高差异为 15%–40%");
  else reasons.push("归一化长宽高差异不超过 15%");
  return {
    level,
    label: level === "low" ? "低风险" : level === "medium" ? "中风险" : "高风险",
    sizeDeltaPct: Math.round(delta * 100),
    reasons
  };
}

const CARRIER_PROP_DECISIONS = new Set(["preserve_source", "keep_and_rewrite", "regenerate_with_product"]);
const ACTIVE_CARRIER_RELATIONS = new Set(["contains_product", "product_removed_from", "product_inserted_into", "carries_product"]);
const RELATED_CARRIER_RELATIONS = new Set([
  ...ACTIVE_CARRIER_RELATIONS,
  "product_companion",
  "brand_companion",
  "display_support",
  "product_transport",
  "product_storage"
]);

function carrierEnvelopeScale(sourceDimensions = {}, targetDimensions = {}) {
  const source = ratioFromDimensions(sourceDimensions).sort((left, right) => left - right);
  const target = ratioFromDimensions(targetDimensions).sort((left, right) => left - right);
  if (source.length !== 3 || target.length !== 3) return null;
  return Math.max(...target.map((value, index) => value / Math.max(source[index], 0.001)));
}

function normalizeCarrierCapacityScale(prop = {}) {
  const explicit = Number(prop.capacityScaleToSourceProduct);
  if (Number.isFinite(explicit) && explicit >= 0.2 && explicit <= 10) return explicit;
  const relation = safeText(prop.capacityComparedToSourceProduct, 40).toLowerCase();
  if (relation === "smaller") return 0.9;
  if (relation === "similar") return 1.1;
  if (relation === "larger") return 1.5;
  return null;
}

function buildCarrierPropAssessments(input = {}) {
  const sourceProduct = input.sourceProduct || {};
  const sourceStates = input.sourceStates || buildProductStateCatalog(sourceProduct, []);
  const targetState = input.targetState || null;
  const defaultSourceState = recommendDisplayState(sourceProduct, sourceStates);
  const assessments = [];
  for (const asset of input.sourceAssets || []) {
    const props = Array.isArray(asset.carrierProps) ? asset.carrierProps : [];
    for (let index = 0; index < props.length; index += 1) {
      const prop = props[index] || {};
      const relation = safeText(prop.relation, 80).toLowerCase();
      const requiredForProductAction = prop.requiredForProductAction === true
        || ACTIVE_CARRIER_RELATIONS.has(relation);
      const associationType = safeText(prop.associationType || prop.visualRole, 80).toLowerCase();
      const productRelated = requiredForProductAction
        || prop.productRelated === true
        || prop.brandLinked === true
        || RELATED_CARRIER_RELATIONS.has(relation)
        || ["active_carrier", "brand_companion", "product_companion", "display_support"].includes(associationType);
      if (!productRelated) continue;
      const relatedLayer = normalizeLayer(prop.relatedProductState || prop.productState || asset.productFacts?.layer);
      const sourceState = sourceStates.find((item) => item.id === relatedLayer) || defaultSourceState || null;
      const targetScale = targetState && sourceState
        ? carrierEnvelopeScale(sourceState.dimensionsCm || {}, targetState.dimensionsCm || {})
        : null;
      const capacityScale = normalizeCarrierCapacityScale(prop);
      const capacityConfidence = Math.max(0, Math.min(1, Number(prop.capacityConfidence ?? 0)));
      const associationConfidence = Math.max(0, Math.min(1, Number(prop.associationConfidence ?? prop.confidence ?? prop.capacityConfidence ?? 0)));
      const fit = targetScale != null && capacityScale != null && capacityConfidence >= 0.7
        ? (targetScale > capacityScale * 1.05 ? "too_small" : "fits")
        : "uncertain";
      const geometryChanged = targetScale != null && targetScale > 1.15;
      const autoLinked = fit === "too_small"
        || (fit === "uncertain" && geometryChanged && associationConfidence >= 0.75);
      const decision = autoLinked
        ? "regenerate_with_product"
        : requiredForProductAction && geometryChanged ? "keep_and_rewrite" : "preserve_source";
      const label = safeText(prop.label || prop.kind || "承载道具", 200);
      const id = safeText(prop.id, 120) || `carrier-${index + 1}`;
      const reason = fit === "too_small"
        ? `${label}的可用容积约为源产品的 ${capacityScale.toFixed(2)} 倍，目标 SKU 外形包络约为源产品的 ${targetScale.toFixed(2)} 倍，存在装不下或穿模风险。`
        : fit === "fits"
          ? `${label}的可用容积可覆盖目标 SKU 的外形包络。`
          : autoLinked
            ? `${label}与源产品存在高置信关联，且目标 SKU 最大必要轴向约为源产品的 ${targetScale.toFixed(2)} 倍；系统将自动与产品同轮重构，避免尺寸失配。`
            : `${label}已识别为产品关联道具，但现有画面证据不足以确认需要调整尺寸。`;
      assessments.push({
        id: `${asset.nodeKey}::${id}`,
        sourceNodeKey: asset.nodeKey,
        sourceLabel: asset.label,
        propId: id,
        kind: safeText(prop.kind || prop.type, 80) || "other",
        label,
        relation: relation || "unknown",
        associationType: associationType || (requiredForProductAction ? "active_carrier" : "product_companion"),
        productRelated,
        brandLinked: prop.brandLinked === true,
        sourceStateId: sourceState?.id || "",
        targetStateId: targetState?.id || "",
        capacityScaleToSourceProduct: capacityScale,
        targetScaleAgainstSourceProduct: targetScale == null ? null : Number(targetScale.toFixed(3)),
        capacityConfidence,
        associationConfidence,
        confidence: associationConfidence,
        fit,
        requiresDecision: false,
        autoLinked,
        recommendedDecision: decision,
        decision,
        decisionSource: "automatic",
        evidence: safeText(prop.evidence, 1200),
        reason
      });
    }
  }
  return assessments;
}

function actionRisk(actions = [], targetState = {}) {
  const allowed = new Set(targetState.allowedActions || []);
  const forbidden = new Set(targetState.forbiddenActions || []);
  const conflicts = actions.filter((action) => forbidden.has(action) || (!STATIC_ACTIONS.has(action) && allowed.size && !allowed.has(action)));
  const unknown = actions.filter((action) => !STATIC_ACTIONS.has(action) && !forbidden.has(action) && !allowed.has(action));
  return {
    compatible: conflicts.length === 0 && unknown.length === 0,
    conflicts,
    unknown,
    requiresResolution: conflicts.length > 0 || unknown.length > 0,
    reason: conflicts.length
      ? `目标形态不支持动作：${conflicts.join("、")}`
      : unknown.length ? `目标资料未声明动作能力：${unknown.join("、")}` : "动作与目标形态兼容"
  };
}

function assetMatchScore(sourceFacts = {}, targetAsset = {}, selectedIds = new Set()) {
  let score = 0;
  if (targetAsset.layer === sourceFacts.layer) score += 60;
  if (targetAsset.view !== "unknown" && targetAsset.view === sourceFacts.view) score += 30;
  if (targetAsset.status === sourceFacts.status) score += 15;
  if (selectedIds.has(String(targetAsset.id))) score += 20;
  if (targetAsset.confidence >= 0.8) score += 5;
  return score;
}

function dataGap(id, severity, scope, message, sourceNodeKey = "") {
  return { id, severity, scope, sourceNodeKey, message };
}

function actionLabel(value) {
  const text = safeText(value, 100);
  const normalized = text.toLowerCase().replace(/[\s_-]+/g, "");
  const labels = {
    holding: "手持",
    hold: "手持",
    displaying: "展示",
    display: "展示",
    spraying: "喷洒",
    spray: "喷洒",
    pressing: "按压",
    press: "按压",
    opening: "打开",
    open: "打开",
    pouring: "倾倒",
    pour: "倾倒"
  };
  return labels[normalized] || text;
}

function targetContactInstruction(targetState = {}, targetAsset = {}) {
  const targetLabel = safeText(targetAsset.title || targetState.label || "目标产品", 300);
  if (targetState.id === "single_unit") {
    return `沿用原画面实际参与持物的手，夹持“${targetLabel}”的下沿或侧边，使包装正面完整朝向镜头，并保持产品在原画面中的展示位置和大致占用区域`;
  }
  if (targetState.id === "retail_outer_box") {
    return `沿用原画面的手部数量与接触侧，托持或扶持“${targetLabel}”，使主展示面朝向镜头，并按目标外盒真实比例重建手指接触关系`;
  }
  if (targetState.id === "primary_container") {
    return `沿用原画面的手部数量与接触侧，自然握持“${targetLabel}”的主容器，使主展示面朝向镜头，并按目标容器真实结构重建手指接触关系`;
  }
  if (targetState.id === "content") {
    return `沿用原画面实际参与持物的手，以符合真实材质的方式轻夹或承托“${targetLabel}”，完整展示内容物形态，不套用旧包装的握持方式`;
  }
  if (targetState.id === "open_state") {
    return `把原产品操作改为符合“${targetLabel}”真实结构的打开与展示方式，沿用原画面的手部数量、动作方向和节奏`;
  }
  if (targetState.id === "usage_state") {
    return `把原产品动作改为“${targetLabel}”资料卡声明的真实使用方式，沿用原画面人物姿态、动作阶段和节奏`;
  }
  return `沿用原画面的手部数量、接触侧和动作阶段，自然持有并展示“${targetLabel}”，按目标产品真实结构重建接触关系`;
}

function buildActionResolutionDraft(input = {}) {
  const sourceProduct = input.sourceProduct || {};
  const targetProduct = input.targetProduct || {};
  const sourceFacts = input.sourceFacts || {};
  const targetState = input.targetState || {};
  const targetAsset = input.targetAsset || {};
  const action = input.action || {};
  const sourceName = safeText(sourceProduct.name || profileFromProduct(sourceProduct).platformName || "原产品", 200);
  const targetName = safeText(targetProduct.name || profileFromProduct(targetProduct).platformName || targetAsset.title || "目标产品", 200);
  const sourceActions = (sourceFacts.actions || []).map(actionLabel).filter(Boolean);
  const actionSummary = sourceActions.length ? sourceActions.join("并") : "持有并展示";
  const forbidden = [...new Set([...(action.conflicts || []), ...(action.unknown || [])].map(actionLabel).filter(Boolean))];
  const targetInstruction = targetContactInstruction(targetState, targetAsset);
  const sourceStructure = sourceFacts.layer === "primary_container"
    ? "瓶身、瓶盖、喷头或泵头"
    : sourceFacts.layer === "retail_outer_box" ? "外盒轮廓与开盒结构" : "包装轮廓与专属结构";
  const targetGuard = targetState.id === "single_unit"
    ? "目标单片包装不得折叠、弯曲或遮挡品牌文字"
    : "目标产品不得拉伸、压扁或遮挡主展示面";
  return [
    `将原动作“${actionSummary}${sourceName}”改为“${targetInstruction}”。`,
    "人物身份、未参与持物的手、其他道具、表情、视线、对白、镜头、构图、背景，以及原视频节点提示词中的剧情顺序和节奏保持不变。",
    `禁止残留“${sourceName}”及其${sourceStructure}${forbidden.length ? `，并移除不适用于“${targetName}”的${forbidden.join("、")}动作` : "和专属操作"}；${targetGuard}，不得悬浮或穿模。`
  ].join("");
}

function buildMappingPlan(input = {}) {
  const sourceProduct = input.sourceProduct || {};
  const targetProduct = input.targetProduct || {};
  const sourceAssets = (input.sourceAssets || []).filter((asset) => asset.productBearing === true || asset.rebuildRoles?.includes?.("产品"));
  const sourceStates = buildProductStateCatalog(sourceProduct, []);
  const targetAssets = input.targetAssets || [];
  const targetStates = buildProductStateCatalog(targetProduct, targetAssets);
  const recommended = recommendDisplayState(targetProduct, targetStates);
  const targetStateId = normalizeLayer(input.targetStateId) || recommended?.id || "";
  const targetState = targetStates.find((item) => item.id === targetStateId) || null;
  const selectedIds = new Set((input.selectedAssetIds || []).map(String));
  const gaps = [];
  const blockingIssues = [];
  if (!targetState) {
    gaps.push(dataGap("target-state-missing", "blocking", "target_state", "目标展示形态不存在"));
    blockingIssues.push("目标展示形态不存在");
  } else {
    if (!Object.keys(targetState.dimensionsCm || {}).length) {
      gaps.push(dataGap("target-dimensions-missing", "blocking", "target_state", `${targetState.label}缺少尺寸，禁止自动布局`));
      blockingIssues.push(`${targetState.label}缺少尺寸`);
    }
    if (!targetState.assets.length) {
      gaps.push(dataGap("target-assets-missing", "blocking", "target_state", `OSS 中没有${targetState.label}资产`));
      blockingIssues.push(`OSS 中没有${targetState.label}资产`);
    }
    if (!(targetState.allowedActions || []).length && !(targetState.forbiddenActions || []).length) {
      gaps.push(dataGap("target-actions-missing", "manual", "target_state", `${targetState.label}缺少动作白名单 / 禁止动作信息；涉及非静态动作时按高风险人工处理`));
    }
  }
  const usedAssets = new Map();
  const mappings = sourceAssets.map((asset) => {
    const sourceFacts = normalizeSourceAssetFacts(asset, sourceProduct, sourceStates);
    const sourceState = sourceStates.find((item) => item.id === sourceFacts.layer) || {
      id: sourceFacts.layer,
      label: sourceFacts.layerLabel,
      dimensionsCm: profileLayerDimensions(profileFromProduct(sourceProduct), sourceFacts.layer),
      orientation: "unknown"
    };
    const risk = targetState ? geometryRisk(sourceState, targetState) : { level: "high", label: "高风险", sizeDeltaPct: null, reasons: ["缺少目标形态"] };
    const isDirect = asset.replacementStrategy === "direct_oss_product_asset" || asset.generationRequired === false;
    const actions = sourceFacts.actions.length
      ? sourceFacts.actions
      : isDirect ? detectActions(asset.label) : detectActions(input.sourcePrompt, asset.label);
    const action = targetState ? actionRisk(actions, targetState) : { compatible: false, conflicts: actions, unknown: [], requiresResolution: true, reason: "缺少目标形态" };
    if (action.requiresResolution) risk.level = "high", risk.label = "高风险", risk.reasons.push(action.reason);
    const semanticSignature = `${sourceFacts.layer}:${sourceFacts.view}:${sourceFacts.status}`;
    let candidates = [];
    let targetAssetId = "";
    let targetAsset = null;
    const rowIssues = [];
    if (targetState) {
      candidates = targetState.assets.map((item) => ({ ...item, matchScore: assetMatchScore(sourceFacts, item, selectedIds) }))
        .sort((left, right) => right.matchScore - left.matchScore || String(left.id).localeCompare(String(right.id)));
      const unused = isDirect
        ? candidates.find((item) => !usedAssets.has(String(item.id)) || usedAssets.get(String(item.id)) === semanticSignature)
        : candidates[0];
      const chosen = unused || null;
      targetAssetId = chosen?.id || "";
      targetAsset = chosen;
      if (chosen && isDirect) usedAssets.set(String(chosen.id), semanticSignature);
      if (!chosen) {
        const issue = `节点 ${asset.label || asset.nodeKey} 没有可映射的${targetState.label} OSS 资产`;
        rowIssues.push(issue);
        gaps.push(dataGap(`asset-${asset.nodeKey}`, "blocking", "node_mapping", issue, asset.nodeKey));
        blockingIssues.push(issue);
      }
    }
    if (sourceFacts.confidence < 0.7) {
      gaps.push(dataGap(`confidence-${asset.nodeKey}`, "warning", "source_classification", `节点 ${asset.label || asset.nodeKey} 的产品形态识别置信度较低，需人工核实`, asset.nodeKey));
    }
    if (action.unknown.length) {
      gaps.push(dataGap(`actions-${asset.nodeKey}`, "manual", "action", action.reason, asset.nodeKey));
    }
    const actionResolution = action.requiresResolution && targetState && targetAsset
      ? buildActionResolutionDraft({ sourceProduct, targetProduct, sourceFacts: { ...sourceFacts, actions }, targetState, targetAsset, action })
      : "";
    return {
      sourceNodeKey: asset.nodeKey,
      sourceLabel: asset.label,
      sourceRole: asset.role,
      sourceFacts: { ...sourceFacts, actions },
      targetStateId: targetState?.id || "",
      targetStateLabel: targetState?.label || "",
      targetView: sourceFacts.view,
      targetStatus: sourceFacts.status,
      targetAssetId,
      targetAssetCandidates: candidates,
      processingMode: isDirect ? "oss_direct" : "generate_candidate",
      semanticSignature,
      classificationConfidence: sourceFacts.confidence,
      classificationEvidence: sourceFacts.evidence,
      risk: { ...risk, action },
      requiresActionResolution: action.requiresResolution,
      actionResolution,
      actionResolutionSource: actionResolution ? "rule_fallback" : "",
      blockingIssues: rowIssues
    };
  });
  const carrierPropAssessments = buildCarrierPropAssessments({
    sourceAssets: input.sourceAssets || [],
    sourceProduct,
    sourceStates,
    targetState
  });
  const warnings = gaps.filter((item) => item.severity !== "blocking").map((item) => item.message);
  return {
    schemaVersion: "one-click-remake-product-mapping-v1",
    sourceProduct: {
      id: sourceProduct.id || profileFromProduct(sourceProduct).productId || "",
      name: sourceProduct.name || profileFromProduct(sourceProduct).platformName || "",
      states: sourceStates
    },
    targetProduct: {
      id: targetProduct.id || profileFromProduct(targetProduct).productId || "",
      name: targetProduct.name || profileFromProduct(targetProduct).platformName || "",
      states: targetStates
    },
    recommendedStateId: recommended?.id || "",
    selectedStateId: targetState?.id || targetStateId,
    selectedState: clone(targetState),
    mappings,
    carrierPropAssessments,
    dataGapReport: gaps,
    blockingIssues: [...new Set(blockingIssues)],
    warnings: [...new Set(warnings)],
    requiresHighRiskConfirmation: mappings.some((item) => item.risk.level === "high"),
    createdAt: new Date().toISOString()
  };
}

function applyMappingConfirmation(plan = {}, input = {}) {
  const overrides = input.mappings && typeof input.mappings === "object" ? input.mappings : {};
  const highRiskConfirmed = input.highRiskConfirmed === true;
  const usedAssets = new Map();
  const mappings = (plan.mappings || []).map((mapping) => {
    const override = overrides[mapping.sourceNodeKey] || {};
    const reuseSource = override.reuseSource === true;
    if (reuseSource) {
      return {
        ...mapping,
        targetAssetId: "",
        actionResolution: "",
        processingMode: "reuse_source",
        requiresActionResolution: false,
        userConfirmedNoProduct: true,
        risk: {
          level: "none",
          label: "无需生图",
          sizeDeltaPct: null,
          reasons: ["用户确认该关键帧不含原产品像素；保持源图不变，不调用生图模型。"],
          action: {
            compatible: true,
            conflicts: [],
            unknown: [],
            requiresResolution: false,
            reason: "源图仅作为人物、服装、身体状态或动作时序参考"
          }
        }
      };
    }
    const targetAssetId = safeText(override.targetAssetId || mapping.targetAssetId, 240);
    const candidate = (mapping.targetAssetCandidates || []).find((item) => String(item.id) === targetAssetId);
    if (!candidate) throw new Error(`${mapping.sourceLabel || mapping.sourceNodeKey} 未选择合法的 OSS 产品资产`);
    const submittedActionResolution = safeText(override.actionResolution, 3000);
    const actionWasEdited = Boolean(submittedActionResolution && submittedActionResolution !== safeText(mapping.actionResolution, 3000));
    const targetAssetChanged = String(targetAssetId) !== String(mapping.targetAssetId || "");
    let actionResolution = safeText(submittedActionResolution || mapping.actionResolution, 3000);
    let actionResolutionSource = actionWasEdited ? "user_edited" : mapping.actionResolutionSource;
    if (mapping.requiresActionResolution && targetAssetChanged && !actionWasEdited) {
      actionResolution = buildActionResolutionDraft({
        sourceProduct: plan.sourceProduct,
        targetProduct: plan.targetProduct,
        sourceFacts: mapping.sourceFacts,
        targetState: plan.selectedState,
        targetAsset: candidate,
        action: mapping.risk?.action
      });
      actionResolutionSource = "rule_refreshed_for_asset";
    }
    if (mapping.processingMode === "oss_direct") {
      const previous = usedAssets.get(targetAssetId);
      if (previous && previous !== mapping.semanticSignature) {
        throw new Error(`OSS 产品资产 ${candidate.title || targetAssetId} 不能复用于不同形态 / 视角的源节点`);
      }
      usedAssets.set(targetAssetId, mapping.semanticSignature);
    }
    if (mapping.requiresActionResolution && !actionResolution) {
      throw new Error(`${mapping.sourceLabel || mapping.sourceNodeKey} 存在动作冲突，必须填写动作改写方案`);
    }
    return { ...mapping, targetAssetId, actionResolution, actionResolutionSource };
  });
  const reusedNodeKeys = new Set(mappings.filter((mapping) => mapping.processingMode === "reuse_source").map((mapping) => mapping.sourceNodeKey));
  const dataGapReport = (plan.dataGapReport || []).filter((gap) => !gap.sourceNodeKey || !reusedNodeKeys.has(gap.sourceNodeKey));
  const blockingIssues = dataGapReport.filter((gap) => gap.severity === "blocking").map((gap) => gap.message);
  const requiresHighRiskConfirmation = mappings.some((mapping) => mapping.processingMode !== "reuse_source" && mapping.risk?.level === "high");
  const carrierOverrides = input.carrierProps && typeof input.carrierProps === "object" ? input.carrierProps : {};
  const carrierPropAssessments = (plan.carrierPropAssessments || []).map((assessment) => {
    const requestedDecision = safeText(carrierOverrides[assessment.id]?.decision, 80);
    const automaticDecision = safeText(assessment.decision || assessment.recommendedDecision, 80);
    const decision = CARRIER_PROP_DECISIONS.has(requestedDecision)
      ? requestedDecision
      : CARRIER_PROP_DECISIONS.has(automaticDecision)
        ? automaticDecision
        : assessment.fit === "too_small" ? "regenerate_with_product" : "preserve_source";
    return {
      ...assessment,
      requiresDecision: false,
      decision,
      decisionSource: CARRIER_PROP_DECISIONS.has(requestedDecision) ? "legacy_client_override" : assessment.decisionSource || "automatic",
      decisionLabel: decision === "regenerate_with_product"
        ? "系统自动与产品联动生图"
        : decision === "keep_and_rewrite" ? "保留道具并自动改写动作" : "保留原道具",
      confirmedAt: new Date().toISOString()
    };
  });
  if (blockingIssues.length) throw new Error(`资料缺口尚未解决：${blockingIssues.join("；")}`);
  if (requiresHighRiskConfirmation && !highRiskConfirmed) throw new Error("存在高风险形态替换，请确认已核实尺寸、构图与动作改写");
  return {
    ...clone(plan),
    mappings,
    carrierPropAssessments,
    dataGapReport,
    blockingIssues: [...new Set(blockingIssues)],
    requiresHighRiskConfirmation,
    confirmedAt: new Date().toISOString(),
    confirmedByUser: true,
    highRiskConfirmed
  };
}

function effectiveProductForState(product = {}, selectedState = null) {
  if (!selectedState) return clone(product);
  const result = clone(product);
  const profileKey = result.productProfile ? "productProfile" : result.replacementContract ? "replacementContract" : null;
  const profile = profileKey ? result[profileKey] : result;
  profile.replacementGeometry = {
    layer: selectedState.id,
    shape: selectedState.shape,
    dimensionsCm: clone(selectedState.dimensionsCm || {}),
    fixedLengthWidthHeightRatio: clone(selectedState.fixedLengthWidthHeightRatio || []),
    heightToDiameter: selectedState.heightToDiameter || null,
    orientationRule: selectedState.orientationRule || "",
    invariants: clone(selectedState.invariants || [])
  };
  profile.remakeDefaultStateId = selectedState.id;
  return result;
}

module.exports = {
  PRODUCT_STATE_TYPES,
  normalizeLayer,
  stateLabel,
  inferAssetFacts,
  buildProductStateCatalog,
  recommendDisplayState,
  normalizeSourceAssetFacts,
  detectActions,
  geometryRisk,
  carrierEnvelopeScale,
  buildCarrierPropAssessments,
  actionRisk,
  buildActionResolutionDraft,
  buildMappingPlan,
  applyMappingConfirmation,
  effectiveProductForState
};
