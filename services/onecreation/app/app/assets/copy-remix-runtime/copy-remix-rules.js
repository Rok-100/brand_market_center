"use strict";

// Runtime copy lives under assets so legacy update clients also install it.

const COPY_REMIX_RULESET = Object.freeze({
  id: "wis-effective-copy-remix",
  version: "2026.07.27-v1",
  sourceDocumentId: "Zw5bdyvyIoDCVFx8nXLcQ5DWnAe",
  sourceUrl: "https://jqx28l0j4lx.feishu.cn/docx/Zw5bdyvyIoDCVFx8nXLcQ5DWnAe",
  patterns: [
    ["L1", "生活损失"],
    ["S1", "症状自检"],
    ["C1", "反常识纠错"],
    ["T1", "信任转交"],
    ["R1", "仪式处方"],
    ["E1", "证据翻译"],
    ["O1", "机制冲突"],
    ["D1", "问答成交"],
    ["H1", "主持揭晓"],
    ["P1", "产品观察"],
    ["A1", "人群点名"]
  ]
});

const WATER_MASK_FORBIDDEN = [
  "微针",
  "上千万微针",
  "富勒烯",
  "类蛇毒肽",
  "燕窝酸",
  "燕窝凝胶",
  "石墨烯",
  "专利微电流",
  "月牙形眼贴"
];

const EYE_MASK_FORBIDDEN = [
  "整脸膜布",
  "上千万微针",
  "黑色蜂窝膜布",
  "燕窝凝胶"
];

function copyRemixMetadata() {
  return {
    id: COPY_REMIX_RULESET.id,
    version: COPY_REMIX_RULESET.version,
    sourceDocumentId: COPY_REMIX_RULESET.sourceDocumentId,
    sourceUrl: COPY_REMIX_RULESET.sourceUrl,
    patternCount: COPY_REMIX_RULESET.patterns.length
  };
}

function copyRemixEnabled(config = {}) {
  return Array.isArray(config.dimensions) && config.dimensions.includes("copy");
}

function forbiddenTermsForSku(config = {}) {
  if (config.productId === "wis-hydra-peptide-mask") return WATER_MASK_FORBIDDEN;
  if (config.productId === "wis-crystal-firming-eye-mask") return EYE_MASK_FORBIDDEN;
  return [];
}

function compactCopyBeats(analysis = {}) {
  return (Array.isArray(analysis.copyBeats) ? analysis.copyBeats : []).slice(0, 24).map((beat) => ({
    sourceShotIndex: Number(beat.sourceShotIndex || 0),
    start: Number(beat.start || 0),
    end: Number(beat.end || 0),
    function: String(beat.function || ""),
    speaker: String(beat.speaker || ""),
    text: String(beat.text || ""),
    emotion: String(beat.emotion || ""),
    delivery: String(beat.delivery || "")
  }));
}

function buildCopyRemixPrompt({ config = {}, analysis = {}, tasks = [] } = {}) {
  const plan = tasks.map((task) => ({
    id: String(task.id || ""),
    tier: String(task.tier || "balanced"),
    targetDuration: Number(task.targetDuration || 0)
  }));
  const payload = {
    sku: {
      id: String(config.productId || ""),
      name: String(config.targetProductFullName || config.productType || ""),
      spokenName: String(config.targetProductName || ""),
      noProduct: config.noProduct === true
    },
    channel: "抖音千川单视频批量裂变",
    sourceDuration: Number(config.sourceDuration || 0),
    plan,
    mother: {
      archetype: String(analysis.archetype || ""),
      transcript: String(analysis.sourceCopy || ""),
      transcriptComplete: analysis.sourceCopyComplete === true,
      hook: String(analysis.hook || ""),
      audience: String(analysis.audience || ""),
      problem: String(analysis.problem || ""),
      structure: String(analysis.structure || ""),
      solution: String(analysis.solution || ""),
      benefit: String(analysis.benefit || ""),
      cta: String(analysis.cta || ""),
      roles: String(analysis.roles || ""),
      speakerPerspective: String(analysis.speakerPerspective || ""),
      sceneContext: String(analysis.sceneContext || ""),
      emotionalMechanism: String(analysis.emotionalMechanism || ""),
      performanceStyle: String(analysis.performanceStyle || ""),
      mustKeep: String(analysis.mustKeep || ""),
      copyBeats: compactCopyBeats(analysis),
      sourceFacts: analysis.sourceFacts || {}
    },
    truth: {
      visualIdentity: String(config.productTruth?.visualIdentity || ""),
      verifiedClaims: [config.productTruth?.pain, config.productTruth?.productLine].map((item) => String(item || "").trim()).filter(Boolean),
      verifiedEvidence: [config.productTruth?.benefitCues, config.productTruth?.maskDetail].map((item) => String(item || "").trim()).filter(Boolean),
      compliance: String(config.productTruth?.compliance || ""),
      offerSpoken: config.offer?.hasPrice ? String(config.offer.spoken || "") : "",
      productMentionPolicy: String(config.productMentionPolicy || "follow-source"),
      authorizedEntities: []
    },
    constraints: {
      variationRequest: String(config.variationRequest || ""),
      userMustKeep: String(config.mustKeep || ""),
      forbiddenCrossSkuTerms: forbiddenTermsForSku(config)
    }
  };
  const patternText = COPY_REMIX_RULESET.patterns.map(([id, name]) => `${id}${name}`).join("、");
  return [
    `执行二创文案规则集：${COPY_REMIX_RULESET.id}@${COPY_REMIX_RULESET.version}。`,
    "你是WIS美妆电商二创文案引擎。你的任务不是同义词替换，也不是另写一条无关广告；你必须在保留母版有效成交因果的前提下，生成能直接口播、能被镜头证明、商品事实准确且创新清晰的裂变文案。",
    "先逐字保全母版，再识别真实存在的钩子、用户认领/痛点、信任、产品揭晓、产品证据、体验/利益、价格机制和行动引导。没有的节点不要虚构。",
    "必须锁定：钩子的心理功能、主问题、说话人视角、人物功能关系、情绪推进、产品出现节点、证据顺序、动作因果和成交顺序。",
    "只能改变：具体措辞、同功能生活场景、人物外观、服装、道具、同类型证据镜头，以及输入中已审核的目标商品事实和当日机制。",
    `主结构只能选择：${patternText}。新闻或爆炸消息默认禁用，除非输入提供可核验来源。`,
    "stable保留节点、顺序、视角、角色、情绪和主要句式；balanced只选择一个主要创新轴；bold可以完整重写原句和表现形式，但必须逐节点证明仍完成相同心理任务、人物功能和成交因果。大胆不等于更夸张。",
    "写成真人能说的话：前三秒只建立一个强相关问题或悬念；一句只承载一个信息；使用具体部位、时刻、动作和短句停顿；不要写报告腔、说明书腔、连续排比或只换语气词。",
    "商品事实零猜测。只能使用输入中的sku、verifiedClaims、verifiedEvidence、offerSpoken和authorizedEntities。历史素材中的成分、技术、明星、价格、销量、库存、频率、检测和功效不能自动迁移。",
    "sku.noProduct为true时，所有版本必须删除产品、品牌、包装、价格、规格、功效与购买引导，只用人物反应、剧情结果或环境细节承接母版的原商品节点。",
    "offerSpoken为空时，任何版本都不得出现价格、盒数、片数、赠品、库存、限时、恢复原价或销量数字。offerSpoken不为空时必须逐字使用，不得改写数字。",
    "每个主卖点至少对应一个可拍证据。当前素材不能证明时，降低主张或写入pendingFields。",
    "输出严格JSON，不要Markdown，不要任何前后解释。variants数量、id与tier必须和plan完全一致。",
    "返回结构：{\"schemaVersion\":\"1.0\",\"primaryPattern\":{\"id\":\"S1\",\"reason\":\"\"},\"invariants\":[],\"variables\":[],\"variants\":[{\"id\":\"variant-01\",\"tier\":\"stable\",\"templateId\":\"S1\",\"hook\":\"\",\"voiceover\":\"\",\"spokenRhythm\":[],\"logicMap\":[{\"beat\":\"hook\",\"motherFunction\":\"\",\"newLine\":\"\"}],\"innovation\":\"\",\"evidenceShots\":[],\"riskFlags\":[],\"pendingFields\":[]}],\"batchRisks\":[],\"humanReviewRequired\":true}",
    `【结构化输入】\n${JSON.stringify(payload)}`
  ].join("\n");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function normalizeCopyRemixResult(input, tasks = []) {
  const raw = input && typeof input === "object" ? input : {};
  const source = Array.isArray(raw.variants) ? raw.variants : [];
  const expected = new Map(tasks.map((task) => [String(task.id || ""), task]));
  const variants = [];
  for (const item of source) {
    const id = String(item?.id || "").trim();
    const task = expected.get(id);
    if (!task) continue;
    const voiceover = normalizeText(item.voiceover);
    if (!voiceover) continue;
    variants.push({
      id,
      tier: String(task.tier || item.tier || "balanced"),
      templateId: String(item.templateId || raw.primaryPattern?.id || ""),
      hook: normalizeText(item.hook),
      voiceover,
      spokenRhythm: Array.isArray(item.spokenRhythm) ? item.spokenRhythm.map(normalizeText).filter(Boolean).slice(0, 24) : [],
      logicMap: Array.isArray(item.logicMap) ? item.logicMap.slice(0, 24) : [],
      innovation: String(item.innovation || "").trim(),
      evidenceShots: Array.isArray(item.evidenceShots) ? item.evidenceShots.map(String).filter(Boolean).slice(0, 12) : [],
      riskFlags: Array.isArray(item.riskFlags) ? item.riskFlags.map(String).filter(Boolean).slice(0, 12) : [],
      pendingFields: Array.isArray(item.pendingFields) ? item.pendingFields.map(String).filter(Boolean).slice(0, 12) : []
    });
  }
  return {
    schemaVersion: "1.0",
    primaryPattern: raw.primaryPattern && typeof raw.primaryPattern === "object" ? raw.primaryPattern : {},
    invariants: Array.isArray(raw.invariants) ? raw.invariants.slice(0, 20) : [],
    variables: Array.isArray(raw.variables) ? raw.variables.slice(0, 20) : [],
    variants,
    batchRisks: Array.isArray(raw.batchRisks) ? raw.batchRisks.slice(0, 20) : [],
    humanReviewRequired: true,
    metadata: copyRemixMetadata()
  };
}

module.exports = {
  COPY_REMIX_RULESET,
  buildCopyRemixPrompt,
  copyRemixEnabled,
  copyRemixMetadata,
  forbiddenTermsForSku,
  normalizeCopyRemixResult
};
