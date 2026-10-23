const QUANTITY_MODES = Object.freeze([
  Object.freeze({ id: "smart_visual_match", label: "智能匹配" }),
  Object.freeze({ id: "keep_source_count", label: "保持原数量" }),
  Object.freeze({ id: "custom", label: "自定义" })
]);

const ARRANGEMENTS = Object.freeze([
  Object.freeze({ id: "inherit", label: "继承原排列" }),
  Object.freeze({ id: "flat", label: "平铺" }),
  Object.freeze({ id: "compact_staggered", label: "紧凑错落" }),
  Object.freeze({ id: "stacked", label: "叠放" })
]);

const MODE_IDS = new Set(QUANTITY_MODES.map((item) => item.id));
const ARRANGEMENT_IDS = new Set(ARRANGEMENTS.map((item) => item.id));

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback = 0) {
  const number = Math.round(finiteNumber(value, fallback));
  return number > 0 ? number : 0;
}

function normalizeDimensions(raw = {}) {
  const diameter = finiteNumber(raw.diameter, 0);
  const length = finiteNumber(raw.length || raw.width || diameter, 0);
  const width = finiteNumber(raw.depth || (diameter || raw.width), 0);
  const height = finiteNumber(raw.height, 0);
  return {
    ...(length > 0 ? { length } : {}),
    ...(width > 0 ? { width } : {}),
    ...(height > 0 ? { height } : {}),
    ...(diameter > 0 ? { diameter } : {})
  };
}

function dimensionsForLayer(product = {}, layer = "") {
  const profile = product.productProfile || product.replacementContract || product || {};
  const geometry = profile.replacementGeometry || {};
  if (geometry.layer === layer && geometry.dimensionsCm) return normalizeDimensions(geometry.dimensionsCm);
  const dimensions = profile.dimensionsCm || {};
  if (layer === "retail_outer_box") return normalizeDimensions(dimensions.retailOuterBox);
  if (layer === "primary_container") return normalizeDimensions(dimensions.primaryContainer || dimensions.bottleBody);
  if (layer === "single_unit") return normalizeDimensions(dimensions.singleSachet || dimensions.singleAmpoule || dimensions.ampouleStrip);
  if (layer === "content") return normalizeDimensions(dimensions.foldedContent || dimensions.content);
  const state = (profile.remakeStates || []).find((item) => (item.id || item.layer) === layer);
  return normalizeDimensions(state?.dimensionsCm || {});
}

function projectedArea(dimensions = {}, camera = {}) {
  const normalized = normalizeDimensions(dimensions);
  const elevation = Math.max(0, Math.min(90, finiteNumber(camera.elevationDeg, 45))) * Math.PI / 180;
  const yaw = finiteNumber(camera.yawDeg, 0) * Math.PI / 180;
  if (normalized.diameter > 0 && normalized.height > 0) {
    const radius = normalized.diameter / 2;
    const angleToAxis = Math.PI / 2 - elevation;
    return (Math.PI * radius * radius * Math.abs(Math.cos(angleToAxis)))
      + (2 * radius * normalized.height * Math.abs(Math.sin(angleToAxis)));
  }
  if (!(normalized.length > 0 && normalized.width > 0 && normalized.height > 0)) return 0;
  const viewX = Math.cos(elevation) * Math.sin(yaw);
  const viewY = Math.cos(elevation) * Math.cos(yaw);
  const viewZ = Math.sin(elevation);
  return Math.abs(viewX) * normalized.width * normalized.height
    + Math.abs(viewY) * normalized.length * normalized.height
    + Math.abs(viewZ) * normalized.length * normalized.width;
}

function stateLabel(layer) {
  return ({
    retail_outer_box: "零售外盒",
    primary_container: "主容器 / 瓶罐",
    single_unit: "单片 / 单支",
    content: "内容物",
    open_state: "打开状态",
    usage_state: "使用状态",
    product_combination: "产品组合"
  })[layer] || layer || "待确认形态";
}

function bestSourceEvidence(sourceAssets = []) {
  const rows = sourceAssets
    .filter((asset) => asset?.productBearing && asset?.productFacts)
    .map((asset) => ({
      nodeKey: asset.nodeKey || "",
      label: asset.label || asset.nodeKey || "",
      ...clone(asset.productFacts)
    }));
  return rows.sort((left, right) => {
    const leftHasCount = positiveInteger(left.productCount) > 0 ? 1 : 0;
    const rightHasCount = positiveInteger(right.productCount) > 0 ? 1 : 0;
    return rightHasCount - leftHasCount
      || finiteNumber(right.countConfidence || right.confidence) - finiteNumber(left.countConfidence || left.confidence);
  })[0] || {};
}

function riskForCounts(sourceCount, targetCount, sourceLayer, targetLayer) {
  const ratio = sourceCount > 0 ? targetCount / sourceCount : 0;
  const reasons = [];
  if (sourceLayer && targetLayer && sourceLayer !== targetLayer) reasons.push("包装层级发生变化");
  if (ratio >= 2 || (ratio > 0 && ratio <= 0.5)) reasons.push(`数量变化倍率为 ${ratio.toFixed(2)}×`);
  const high = reasons.length > 0;
  return {
    level: high ? "high" : ratio >= 1.5 || (ratio > 0 && ratio <= 0.67) ? "medium" : "low",
    label: high ? "高风险" : ratio >= 1.5 || (ratio > 0 && ratio <= 0.67) ? "中风险" : "风险可控",
    ratio: Number(ratio.toFixed(3)),
    reasons,
    requiresConfirmation: high
  };
}

function quantityPromptContract(decision = {}) {
  if (decision.enabled === false || !(decision.finalCount > 0)) return "";
  const target = decision.target || {};
  const arrangement = ARRANGEMENTS.find((item) => item.id === decision.arrangement)?.label || decision.arrangement;
  const exact = decision.strictQuantity
    ? `画面中必须准确出现 ${decision.finalCount} 个目标产品，不得多、不得少、不得被遮挡到无法计数。`
    : `以 ${decision.finalCount} 个目标产品为排布目标，优先保持整体画面占用区域与空间密度。`;
  return [
    "【替换数量控制模板 v1 硬约束】",
    "先清除全部原产品像素、旧包装、旧文字和重影，禁止保留任何原产品。",
    exact,
    `目标形态：${target.label || stateLabel(target.stateId)}；单体真实尺寸：${JSON.stringify(target.dimensionsCm || {})} cm。`,
    `排列方式：${arrangement || "继承原排列"}；保持合理间距、遮挡、承托、触地面与接触阴影。`,
    `数量模式：${QUANTITY_MODES.find((item) => item.id === decision.mode)?.label || decision.mode}；数量来源：${decision.countSource || "用户确认"}。`,
    "禁止增生额外产品、漏生产品、融合两个产品、悬浮、穿模、以缩小单体的方式强行塞入数量。"
  ].join("\n");
}

function calculatePlan(base = {}, input = {}) {
  const enabled = input.enabled !== undefined ? input.enabled !== false : base.enabled !== false;
  const source = clone(base.source || {});
  const target = clone(base.target || {});
  source.count = positiveInteger(input.sourceCount, positiveInteger(source.count));
  source.countSource = input.sourceCount !== undefined ? "user_confirmed" : (source.countSource || "audit");
  const mode = MODE_IDS.has(input.mode) ? input.mode : (MODE_IDS.has(base.mode) ? base.mode : "smart_visual_match");
  const arrangement = ARRANGEMENT_IDS.has(input.arrangement) ? input.arrangement : (ARRANGEMENT_IDS.has(base.arrangement) ? base.arrangement : "compact_staggered");
  const sourceArea = projectedArea(source.dimensionsCm, source.camera);
  const targetArea = projectedArea(target.dimensionsCm, source.camera);
  const missingData = [];
  if (!source.stateId) missingData.push("缺少原产品包装层级");
  if (!(sourceArea > 0)) missingData.push("缺少原产品该形态的完整尺寸");
  if (!(targetArea > 0)) missingData.push("缺少目标形态的完整尺寸");
  if (!target.assetAvailable) missingData.push("目标形态缺少 OSS 白底身份资产");
  if (!(source.count > 0)) missingData.push("缺少原数量，请人工确认");
  const smartAvailable = missingData.length === 0;
  const smartCount = smartAvailable ? Math.max(1, Math.round(source.count * sourceArea / targetArea)) : 0;
  let finalCount = 0;
  let countSource = "";
  if (mode === "smart_visual_match" && smartAvailable) finalCount = smartCount, countSource = "投影面积智能换算";
  if (mode === "keep_source_count" && source.count > 0) finalCount = source.count, countSource = "保持原数量";
  if (mode === "custom") finalCount = positiveInteger(input.targetCount, positiveInteger(base.finalCount || smartCount || source.count)), countSource = "用户自定义";
  if (input.targetCount !== undefined && mode !== "keep_source_count" && mode !== "smart_visual_match") finalCount = positiveInteger(input.targetCount, finalCount);
  const risk = riskForCounts(source.count, finalCount, source.stateId, target.stateId);
  const strictQuantity = input.strictQuantity !== undefined ? input.strictQuantity === true : base.strictQuantity === true;
  const decision = {
    version: "quantity-control-v1",
    enabled,
    mode,
    arrangement,
    source,
    target,
    smartAvailable,
    missingData,
    status: !enabled ? "disabled" : mode === "smart_visual_match" && !smartAvailable ? "missing_data" : finalCount > 0 ? "ready" : "requires_count",
    recommendedCount: smartCount,
    recommendedRange: smartCount > 0 ? [Math.max(1, Math.ceil(smartCount * 0.75)), smartCount] : [],
    finalCount,
    countSource,
    strictQuantity,
    keyframeValidationRequired: enabled && strictQuantity && finalCount >= 8,
    risk,
    calculation: {
      formula: "round(sourceCount × sourceProjectedArea / targetProjectedArea)",
      sourceProjectedAreaCm2: Number(sourceArea.toFixed(2)),
      targetProjectedAreaCm2: Number(targetArea.toFixed(2)),
      cameraElevationDeg: finiteNumber(source.camera?.elevationDeg, 45),
      cameraYawDeg: finiteNumber(source.camera?.yawDeg, 0)
    }
  };
  decision.hardConstraint = quantityPromptContract(decision);
  return decision;
}

function buildQuantityPlan(input = {}) {
  const evidence = bestSourceEvidence(input.sourceAssets || []);
  const sourceLayer = evidence.layer || input.sourceLayer || "";
  const targetState = input.targetState || {};
  const base = {
    enabled: input.enabled !== false,
    mode: "smart_visual_match",
    arrangement: "compact_staggered",
    strictQuantity: true,
    source: {
      stateId: sourceLayer,
      label: stateLabel(sourceLayer),
      dimensionsCm: dimensionsForLayer(input.sourceProduct || {}, sourceLayer),
      count: positiveInteger(evidence.productCount),
      countConfidence: Math.max(0, Math.min(1, finiteNumber(evidence.countConfidence || evidence.confidence, 0))),
      countSource: positiveInteger(evidence.productCount) ? "audit" : "missing",
      orientation: evidence.orientation || "unknown",
      layout: evidence.layoutType || "unknown",
      evidence: evidence.evidence || "",
      nodeKey: evidence.nodeKey || "",
      camera: {
        elevationDeg: finiteNumber(evidence.cameraElevationDeg, 45),
        yawDeg: finiteNumber(evidence.cameraYawDeg, 0),
        source: evidence.cameraElevationDeg === undefined ? "45° 默认校准" : "多模态审计"
      }
    },
    target: {
      stateId: targetState.id || "",
      label: targetState.label || stateLabel(targetState.id),
      shape: targetState.shape || "",
      dimensionsCm: normalizeDimensions(targetState.dimensionsCm || {}),
      assetAvailable: Array.isArray(targetState.assets) && targetState.assets.length > 0
    }
  };
  return calculatePlan(base, {});
}

function applyQuantityConfirmation(plan = {}, input = {}) {
  const decision = calculatePlan(plan, input);
  if (!decision.enabled) {
    decision.confirmedAt = new Date().toISOString();
    decision.rollback = { active: true, note: "已关闭数量模板，不向原流程注入数量约束" };
    return decision;
  }
  if (decision.mode === "smart_visual_match" && !decision.smartAvailable) {
    throw new Error(`智能数量换算不可用：${decision.missingData.join("；")}。请补齐资料，或选择保持原数量 / 自定义。`);
  }
  if (!(decision.source.count > 0)) throw new Error("请先确认原画面中的产品数量");
  if (!(decision.finalCount > 0)) throw new Error("请设置有效的目标数量");
  if (decision.risk.requiresConfirmation && input.highRiskConfirmed !== true) {
    throw new Error(`原数量 ${decision.source.count} 变为 ${decision.finalCount}，或包装层级发生变化，请先完成高风险确认`);
  }
  decision.highRiskConfirmed = input.highRiskConfirmed === true;
  decision.confirmedAt = new Date().toISOString();
  return decision;
}

module.exports = {
  QUANTITY_MODES,
  ARRANGEMENTS,
  normalizeDimensions,
  dimensionsForLayer,
  projectedArea,
  buildQuantityPlan,
  applyQuantityConfirmation,
  quantityPromptContract
};
