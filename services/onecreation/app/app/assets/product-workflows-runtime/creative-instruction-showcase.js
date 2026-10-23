"use strict";

const {
  CREATIVE_SCENE_LIBRARY,
  creativeSceneCategories,
  getCreativeSceneCategory,
  selectCreativeScenePresets
} = require("./creative-instruction-scene-library.js");
const {
  PRODUCT_PROFILE_SCHEMA_VERSION,
  PRODUCT_PROFILES,
  formatProductQuantityStrategy,
  formatProductScaleReference
} = require("./product-replacement-contracts.js");

const CREATIVE_INSTRUCTION_SHOWCASE_WORKFLOW = "creative_instruction_showcase";
const CREATIVE_INSTRUCTION_SHOWCASE_TEMPLATE = Object.freeze({
  id: "creative-instruction-showcase-v2",
  version: "2026.08.24-r3",
  source: "server-built-in",
  workflow: CREATIVE_INSTRUCTION_SHOWCASE_WORKFLOW,
  promptPolicy: "workflow-isolated"
});

const RULE_VERSIONS = Object.freeze({
  productIdentity: "global.product-identity@2026.08.20-r1",
  assetRouting: "global.asset-role-routing@2026.08.20-r1",
  sceneAndMotion: "global.scene-and-motion@2026.08.20-r1",
  sceneLibrary: `global.purpose-scene-library@${CREATIVE_SCENE_LIBRARY.version}`,
  maskCategory: "category.mask-product@2026.08.20-r1",
  productProfile: `global.product-profile@${PRODUCT_PROFILE_SCHEMA_VERSION}`,
  blackCrystalMask: "sku.wis-black-crystal-mask@2026.08.24-r3"
});

const BLACK_CRYSTAL_CARD = PRODUCT_PROFILES["wis-black-crystal-mask"];
const BLACK_CRYSTAL_PROFILE = Object.freeze({
  id: "wis-black-crystal-mask",
  version: PRODUCT_PROFILE_SCHEMA_VERSION,
  names: [BLACK_CRYSTAL_CARD.formalName, BLACK_CRYSTAL_CARD.platformName, BLACK_CRYSTAL_CARD.shortName],
  recommendedAssets: ["黑晶面膜盒正面.png", "黑晶面膜盒正面+右侧+顶部.png", "黑晶面膜单片正面.png"],
  promptRules: [
    "盒装正面图负责锁定品牌、正面排版、主色与盒装数量感；盒装三视角图负责锁定厚度、侧面与顶部结构；单片正面图只负责锁定单片袋的尺寸、颜色与正面排版。",
    `尺寸硬锁：面膜盒为${BLACK_CRYSTAL_CARD.dimensionsCm.retailOuterBox.width}×${BLACK_CRYSTAL_CARD.dimensionsCm.retailOuterBox.height}×${BLACK_CRYSTAL_CARD.dimensionsCm.retailOuterBox.depth}cm的近正方形厚盒，单片袋为${BLACK_CRYSTAL_CARD.dimensionsCm.singleSachet.width}×${BLACK_CRYSTAL_CARD.dimensionsCm.singleSachet.height}cm薄袋；同框且距离接近时单片袋正面宽高约为盒装正面的95%，不得变成小样袋、窄长袋或厚盒。`,
    BLACK_CRYSTAL_CARD.quantityStrategy.prompt,
    "出现膜布时必须是湿润、薄、柔软的黑色膜片，表面均匀可见炭灰/灰黑蜂窝状或六边形网格纹理，不得变成纯黑无纹理、白膜、随机裂纹、鱼鳞纹或粗糙布纹。",
    "合规禁区：不出现或强调美容院、院线级、热玛吉、修复、医疗感、美白、祛痘、纳米、百分百、完全、全部、绝对、全方位，也不做立刻逆龄、皱纹消失等夸张前后对比。"
  ],
  negativeRules: [
    "黑晶盒装比例错误，黑晶单片袋明显小于盒装，单片袋变成小样袋或厚盒",
    "黑色膜布蜂窝/六边形纹理缺失，纯黑无纹理膜布，白色面膜，随机裂纹，鱼鳞纹，蜘蛛网纹",
    "从单片袋取出时直接变成完整展开脸型面膜，出袋内容物变成长条布、湿巾或透明凝胶片",
    "医疗场景，美容院招牌，夸张逆龄，皱纹消失，绝对化功效宣称"
  ]
});

const VARIANT_TREATMENTS = Object.freeze([
  Object.freeze({ id: "handheld-documentary", label: "自然手持纪实", prompt: "使用接近真实手机或轻型相机的自然视角，只有克制的呼吸感与轻微重构图，不做广告式机械运镜。" }),
  Object.freeze({ id: "warm-side-light", label: "暖侧逆光纪实", prompt: "使用暖色环境侧逆光和真实景深，以轻微侧移与自然转焦保持生活记录感。" }),
  Object.freeze({ id: "gentle-overhead", label: "轻俯拍生活记录", prompt: "采用轻俯拍与近距离观察，保持手部、道具和产品接触关系可信，避免棚拍式完美对称。" }),
  Object.freeze({ id: "foreground-depth", label: "前景纵深纪实", prompt: "保留少量真实前景遮挡，以正常尺度的前中后景和低速推近建立空间，不使用程序化特效。" }),
  Object.freeze({ id: "focus-transition", label: "自然转焦记录", prompt: "通过道具或环境前景向产品包装自然转焦，焦点变化必须服务产品识别而不是炫技。" }),
  Object.freeze({ id: "interaction-closeup", label: "互动近景纪实", prompt: "以中近景记录真实拿取、开合或使用动作，镜头只跟随动作轻微调整并保持包装稳定。" }),
  Object.freeze({ id: "environment-first", label: "环境先行纪实", prompt: "先清楚建立真实地点和承载面，再让产品自然成为画面主角，避免产品凭空出现。" }),
  Object.freeze({ id: "material-detail", label: "材质细节纪实", prompt: "用克制微距和真实反光展示包装或内容物材质，随后回到完整产品与环境。" }),
  Object.freeze({ id: "hero-finish", label: "自然英雄产品收尾", prompt: "从生活互动自然过渡到完整包装正面，最后稳定停留但不形成TVC式片尾或广告定版。" })
]);

function workflowError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function cleanText(value, maxLength = 2000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeAssetNames(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanText(typeof item === "object" ? item?.name : item, 240))
    .filter(Boolean);
}

function looksLikeMask(input = {}) {
  return /面膜|眼膜|mask/i.test([
    input.productId,
    input.productName,
    input.productCategory,
    ...normalizeAssetNames(input.productAssetNames)
  ].filter(Boolean).join(" "));
}

function isBlackCrystalMask(input = {}) {
  const productId = cleanText(input.productId, 160).toLowerCase();
  const facts = [input.productName, ...normalizeAssetNames(input.productAssetNames)].filter(Boolean).join(" ");
  return productId === BLACK_CRYSTAL_PROFILE.id || BLACK_CRYSTAL_PROFILE.names.some((name) => facts.includes(name));
}

function creativeProductProfile(input = {}) {
  const productId = cleanText(input.productId, 160);
  if (PRODUCT_PROFILES[productId]) return PRODUCT_PROFILES[productId];
  const facts = [input.productName, ...normalizeAssetNames(input.productAssetNames)].filter(Boolean).join(" ");
  return Object.values(PRODUCT_PROFILES).find((profile) => (
    [profile.formalName, profile.platformName, profile.shortName].filter(Boolean).some((name) => facts.includes(name))
  )) || null;
}

function shotCountForDuration(value) {
  const duration = Math.max(4, Math.min(15, Math.round(Number(value) || 5)));
  if (duration <= 6) return 3;
  if (duration <= 9) return 4;
  if (duration <= 12) return 5;
  return 6;
}

function parseExplicitStoryboard(instruction) {
  const source = String(instruction || "");
  const markerIndex = Math.max(source.lastIndexOf("分镜"), source.lastIndexOf("镜头："), source.lastIndexOf("镜头:"));
  if (markerIndex < 0) return [];
  const section = source.slice(markerIndex + (source.startsWith("分镜", markerIndex) ? 2 : 3));
  const matches = [...section.matchAll(/(?:^|[：:；;。\n])\s*(\d{1,2})\s*[、.．）):：]\s*/g)]
    .filter((match) => Number(match[1]) >= 1 && Number(match[1]) <= 12);
  if (!matches.length || Number(matches[0][1]) !== 1) return [];
  const shots = matches.map((match, index) => {
    const start = Number(match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? Number(matches[index + 1].index || section.length) : section.length;
    return cleanText(section.slice(start, end).replace(/[；;。]+$/g, ""), 1200);
  }).filter(Boolean);
  return shots.length >= 2 ? shots : [];
}

function hasExplicitSceneDescription(instruction) {
  return /(?:场景|背景|位于|放置于|海边|沙滩|海岛|落日|夕阳|篝火|露营|酒店|卧室|浴室|梳妆台|床头|桌面|客厅|办公室|宿舍|冰箱|抽屉|货架|专柜|摄影棚|工作室|咖啡馆|机场|车内|户外)/.test(String(instruction || ""));
}

function formatSeconds(value) {
  const rounded = Math.round(Number(value || 0) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function timedStoryboard(shots, duration) {
  const count = shots.length;
  return shots.map((shot, index) => {
    const start = formatSeconds(duration * index / count);
    const end = formatSeconds(duration * (index + 1) / count);
    const transition = index === count - 1
      ? "动作完成后保持完整产品可识别，自然停稳收尾，不出现广告定版。"
      : "通过当前动作、视线或焦点变化自然承接下一镜，不发生场景和SKU跳变。";
    return `镜头${index + 1}，${start}-${end}秒：${shot}。${transition}`;
  });
}

function defaultStoryboard(category, scenePreset, duration) {
  const shotCount = shotCountForDuration(duration);
  return timedStoryboard(Array.from({ length: shotCount }, (_, index) => {
    if (index === 0) return `建立“${scenePreset.name}”的真实空间、承载面和前中后景关系，完整产品包装从开场即稳定存在`;
    if (index === shotCount - 1) return `回到清晰、完整、可识别的英雄产品构图，延续${category.label}方向并保留真实环境层次`;
    return `围绕${category.label}完成一个物理可解释的产品动作、包装细节或焦点变化，产品结构与固有文字保持一致`;
  }), duration);
}

function creativeAssetWarnings(normalized, blackCrystalMask) {
  const warnings = [];
  const openingAction = /开袋|撕开|取出|抽出|夹出|拿出内容物/.test(normalized.instruction);
  if (blackCrystalMask && openingAction && !normalized.productAssetNames.some((name) => /膜布.*内容物|内容物.*膜布/.test(name))) {
    warnings.push("本指令包含黑晶面膜开袋取出动作，但上传文件名中未识别到“黑晶面膜膜布（内容物）”真值资产；正式生成前应补齐该资产。");
  }
  return warnings;
}

function normalizeCreativeInstructionShowcaseInput(input = {}) {
  const instruction = cleanText(input.instruction || input.prompt, 2000);
  if (!instruction) throw workflowError("CREATIVE_INSTRUCTION_REQUIRED", "请填写一句话自然指令");
  const productAssetPaths = (Array.isArray(input.productAssetPaths) ? input.productAssetPaths : [])
    .map((item) => cleanText(item, 1200))
    .filter(Boolean);
  const declaredCount = Number(input.productAssetCount);
  const productAssetCount = productAssetPaths.length || (Number.isFinite(declaredCount) ? Math.trunc(declaredCount) : 0);
  if (productAssetCount < 1) throw workflowError("PRODUCT_IMAGES_MIN_1", "请上传1–9张产品白底图；当前为0张");
  if (productAssetCount > 9) throw workflowError("PRODUCT_IMAGES_MAX_9", `产品白底图最多上传9张；当前为${productAssetCount}张`);
  const categoryId = cleanText(input.categoryId || input.purposeId, 80);
  const category = getCreativeSceneCategory(categoryId);
  if (!category) throw workflowError("CREATIVE_CATEGORY_REQUIRED", "请从8个商业分类中手动选择1个创意视频分类");
  const rawOutputCount = Number(input.outputCount ?? input.videoCount ?? 1);
  if (!Number.isInteger(rawOutputCount) || rawOutputCount < 1 || rawOutputCount > 9) {
    throw workflowError("OUTPUT_COUNT_RANGE", "生成数量必须是1–9之间的整数");
  }
  const duration = Math.max(4, Math.min(15, Math.round(Number(input.duration) || 5)));
  return {
    instruction,
    productAssetPaths,
    productAssetCount,
    productAssetNames: normalizeAssetNames(input.productAssetNames),
    productId: cleanText(input.productId, 160),
    productName: cleanText(input.productName, 240) || "用户上传产品",
    productCategory: cleanText(input.productCategory, 160),
    sceneProvided: input.sceneProvided === true || Boolean(cleanText(input.sceneImagePath, 1200)),
    sceneImagePath: cleanText(input.sceneImagePath, 1200),
    sceneImageName: cleanText(input.sceneImageName, 240) || "用户上传场景图",
    categoryId,
    outputCount: rawOutputCount,
    duration
  };
}

function compileCreativeInstructionShowcasePrompt(input = {}) {
  const normalized = normalizeCreativeInstructionShowcaseInput(input);
  const maskProduct = looksLikeMask(normalized);
  const blackCrystalMask = isBlackCrystalMask(normalized);
  const profile = creativeProductProfile(normalized);
  const category = getCreativeSceneCategory(normalized.categoryId);
  const explicitShots = parseExplicitStoryboard(normalized.instruction);
  const shotCount = explicitShots.length || shotCountForDuration(normalized.duration);
  const explicitScene = !normalized.sceneProvided && hasExplicitSceneDescription(normalized.instruction);
  const scenePresets = selectCreativeScenePresets(
    normalized.categoryId,
    normalized.outputCount,
    `${normalized.productId}|${normalized.productName}|${normalized.instruction}|${normalized.sceneImageName}`
  );
  const rulesApplied = [RULE_VERSIONS.productIdentity, RULE_VERSIONS.assetRouting, RULE_VERSIONS.sceneAndMotion, RULE_VERSIONS.sceneLibrary];
  if (maskProduct) rulesApplied.push(RULE_VERSIONS.maskCategory);
  if (profile) rulesApplied.push(RULE_VERSIONS.productProfile);
  if (blackCrystalMask) rulesApplied.push(RULE_VERSIONS.blackCrystalMask);

  const sceneMode = normalized.sceneProvided ? "uploaded-scene" : "compiled-scene";
  const sceneSource = normalized.sceneProvided ? "uploaded-image" : explicitScene ? "user-instruction" : "scene-library";

  const maskRules = maskProduct ? [
    "面膜品类规则：盒装、单片袋和膜布是不同资产角色，不得把参考图张数解释为画面中的产品数量。",
    "盒装负责品牌与库存量感，单片袋负责单片形态和尺寸锚点，膜布只在真实使用或质地镜头中出现；膜布必须薄、柔软、贴合且湿润，不得生成厚硬塑料片。"
  ] : [];
  const skuRules = blackCrystalMask ? [
    ...BLACK_CRYSTAL_PROFILE.promptRules,
    /开袋|撕开|取出|抽出|夹出/.test(normalized.instruction)
      ? "黑晶开袋状态锁：刚从单片袋取出的第一形态必须是薄而湿润的折叠近方形黑色膜片，蜂窝/六边形纹理清晰；只有后续明确展开或上脸时才允许变为完整脸型膜布。"
      : "",
    /上脸|敷面膜|贴合|揭膜|脸部/.test(normalized.instruction)
      ? "黑晶上脸资产优先级：膜布材质/局部材质 > 膜布内容物/展开 > 单片正面 > 单片背面；缺少膜布事实资产时，不自行虚构膜布微观结构或展开状态。"
      : ""
  ].filter(Boolean) : [];
  const profileRules = profile ? [
    `统一产品资料卡（${PRODUCT_PROFILE_SCHEMA_VERSION}）：产品ID=${profile.productId}；正式产品名=${profile.formalName}；平台显示名=${profile.platformName}；平台简称=${profile.shortName}；规格=${profile.specification}。`,
    `包装层级：${profile.packageHierarchy.join(" → ")}。`,
    formatProductScaleReference(profile.productId),
    `产品数量与量感策略：${formatProductQuantityStrategy(profile.productId)}。`,
    `状态与使用顺序：${profile.openingStates.join("；")}；${profile.usage}。`,
    `内容物与结构真值：${profile.contentIdentity}`
  ] : [];
  const negativePrompt = [
    "错误SKU，包装结构漂移，品牌文字乱码，LOGO漂移，颜色改变，材质改变，比例失真",
    "无依据增加或减少产品，重复复制产品，把参考图张数当产品数量，小格子平铺，缩小产品制造数量感",
    "产品融化，穿模，悬浮，接触阴影缺失，错误反射，多余手指，手部穿透，液体逆重力",
    "无来源字幕，新增卖点字，水印，角标，虚构规格，虚构功效，虚构配件",
    "镜头剧烈抖动，快速旋转，频繁闪烁，过度粒子，装饰性爆炸，低清晰度，主体丢失，单分镜，一镜到底，全程同一构图",
    ...(profile?.negativeConstraints || []),
    ...(blackCrystalMask ? BLACK_CRYSTAL_PROFILE.negativeRules : [])
  ].join("，");

  const prompts = scenePresets.map((scenePreset, variantOffset) => {
    const treatment = VARIANT_TREATMENTS[variantOffset % VARIANT_TREATMENTS.length];
    const sceneContract = normalized.sceneProvided
      ? `场景真值：已连接的“${normalized.sceneImageName}”是本次唯一背景/场景事实依据。保持其空间结构、透视、主要材质、道具关系、光向与色彩；分类预设“${scenePreset.name}”只补充景别与构图方法，不替换上传场景。`
      : explicitScene
        ? `用户显式场景最高优先级：严格保留自然指令中指定的地点、承载面、道具、时间、光线和背景事件。分类预设“${scenePreset.name}”只提供本组差异化的景别与构图灵感，不得借用其地点、台面、背景、道具或色调，不得把用户场景替换为另一场景。`
        : `后端8×20场景库：本组选择 ${scenePreset.id}“${scenePreset.name}”——${scenePreset.prompt}`;
    const storyboard = explicitShots.length
      ? timedStoryboard(explicitShots, normalized.duration)
      : defaultStoryboard(category, scenePreset, normalized.duration);
    const positivePrompt = [
      `内置提示词模板：${CREATIVE_INSTRUCTION_SHOWCASE_TEMPLATE.id}@${CREATIVE_INSTRUCTION_SHOWCASE_TEMPLATE.version}；工作流=${CREATIVE_INSTRUCTION_SHOWCASE_WORKFLOW}。`,
      `本次规则追溯：${rulesApplied.join("；")}。`,
      `批次结构：同一备用创意任务共${normalized.outputCount}组提示词，本提示词为第${variantOffset + 1}组；每组对应同一独立LibTV画布中的一个唯一视频节点。`,
      `生成目标：根据用户自然指令“${normalized.instruction}”，生成一条${normalized.duration}秒、9:16竖屏、真实产品实拍感的${normalized.productName}创意产品展示视频；去除AI味和过度TVC感。`,
      `用户手动选择的商业分类：${category.label}（${category.id}）；分类选择优先于自然指令中的偶发关键词，不允许因“膜布、精华、开袋”等镜头词把分类改成其他方向。`,
      `产品事实输入：已连接${normalized.productAssetCount}张产品白底图。所有已连接产品图共同构成产品外观、包装结构、品牌固有文字、颜色、材质、比例和数量形态的最高优先级事实依据；不同角度互补，不得挑选其中一张后无视其余事实。`,
      "产品身份硬锁：不得改动包装结构、品牌与固有文字位置、主色、材质、比例或SKU；不得虚构未在产品图中出现的规格、功效、配件、开口结构或产品数量。看不清的文字保持原有视觉结构，不重写、不补写。",
      "资产分工：正面/标签图优先锁定身份与文字区；侧面、顶部或三视角图锁定厚度和立体结构；单体或内容物图只锁定其自身形态。避免把相似参考图复制成多个产品。",
      sceneContract,
      `本组差异化拍法：${treatment.label}。${treatment.prompt}`,
      ...maskRules,
      ...profileRules,
      ...skuRules,
      explicitShots.length
        ? `显式分镜锁定：用户已给出${explicitShots.length}个分镜，必须逐镜按原顺序执行；只补充时间、运镜和转场，不改写、不合并、不增加其他动作。`
        : `默认分镜重组：在${normalized.duration}秒内完成${shotCount}个功能明确、衔接自然的镜头，分类场景负责补齐真实空间，用户指令负责内容主题。`,
      ...storyboard,
      "画面规则：产品接触面、阴影、反射、遮挡、手部动作和液体运动符合真实物理；数量展示通过正常尺度下的前后层次、遮挡和纵深完成，不使用小格子平铺、等距缩小矩阵或无来源复制。",
      "文字与合规：只保留产品包装固有且由参考图可验证的文字与LOGO；不生成字幕、卖点字、角标、水印或无法验证的功效宣称。",
      "连续性与收尾：相同人物手部、产品、道具、地点、时间和光线跨镜头保持连续；避免快速旋转、频繁闪烁和无因特效，最后让完整产品自然停稳。"
    ].filter(Boolean).join("\n");
    return {
      index: variantOffset + 1,
      variantId: `creative-${String(variantOffset + 1).padStart(2, "0")}`,
      treatment: { ...treatment },
      scenePreset,
      sceneMode,
      sceneSource,
      shotCount,
      storyboard,
      positivePrompt,
      negativePrompt
    };
  });

  const firstPrompt = prompts[0];
  const warnings = creativeAssetWarnings(normalized, blackCrystalMask);

  return {
    workflowType: CREATIVE_INSTRUCTION_SHOWCASE_WORKFLOW,
    productProfileId: profile?.productId || "",
    productProfileVersion: profile ? PRODUCT_PROFILE_SCHEMA_VERSION : "",
    promptTemplate: { ...CREATIVE_INSTRUCTION_SHOWCASE_TEMPLATE },
    rulesApplied,
    sceneMode,
    sceneSource,
    sceneLibrary: {
      ...CREATIVE_SCENE_LIBRARY,
      category: { id: category.id, label: category.label, sceneCount: category.scenes.length }
    },
    purpose: { id: category.id, label: category.label },
    category: { id: category.id, label: category.label, description: category.description, sceneCount: category.scenes.length },
    outputCount: normalized.outputCount,
    shotCount,
    explicitStoryboard: explicitShots,
    normalizedInput: normalized,
    warnings,
    prompts,
    positivePrompt: firstPrompt.positivePrompt,
    negativePrompt: firstPrompt.negativePrompt,
    scenePreset: firstPrompt.scenePreset
  };
}

module.exports = {
  BLACK_CRYSTAL_PROFILE,
  CREATIVE_INSTRUCTION_SHOWCASE_TEMPLATE,
  CREATIVE_INSTRUCTION_SHOWCASE_WORKFLOW,
  RULE_VERSIONS,
  VARIANT_TREATMENTS,
  compileCreativeInstructionShowcasePrompt,
  creativeProductProfile,
  creativeSceneCategories,
  getCreativeSceneCategory,
  hasExplicitSceneDescription,
  isBlackCrystalMask,
  looksLikeMask,
  normalizeCreativeInstructionShowcaseInput,
  parseExplicitStoryboard,
  shotCountForDuration
};
