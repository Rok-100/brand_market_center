"use strict";

const DISABLED_PROMPT_RULESET = Object.freeze({
  id: "wis-video-prompt-rules",
  version: "2026.07.28-r4",
  sourceDocumentId: "KgYpdVAg7oh0dOxoQs5crvYSnff",
  sourceRevision: 50,
  disabled: true,
  appliedModes: []
});

const BLOCKED_PROMPT_RULE_PATTERNS = Object.freeze([
  /wis-video-prompt-rules(?:@[0-9A-Za-z._-]+)?/i,
  /2026\.07\.28-r4/i,
  /来源文档修订\s*50/i,
  /KgYpdVAg7oh0dOxoQs5crvYSnff/i,
  /jqx28l0j4lx\.feishu\.cn\/docx\/KgYpdVAg7oh0dOxoQs5crvYSnff/i
]);

function promptRuleMetadata() { return null; }
function rulesetHeader() { return ""; }
function analysisContract() { return ""; }
function backgroundCompositionContract() { return ""; }
function generationContract() { return ""; }
function qualityContract() { return ""; }

function assertPromptRulesDisabled(prompt, options = {}) {
  const text = String(prompt || "");
  if (!BLOCKED_PROMPT_RULE_PATTERNS.some((pattern) => pattern.test(text))) return text;
  const workflow = String(options.workflow || "视频任务").trim() || "视频任务";
  const error = new Error(`${workflow}的最终提示词包含已停用的外部通用规则集，已停止提交`);
  error.code = "PROMPT_RULESET_DISABLED";
  error.ruleset = { ...DISABLED_PROMPT_RULESET };
  throw error;
}

function assertLibtvArgsPromptRulesDisabled(args, options = {}) {
  const values = Array.isArray(args) ? args : [];
  for (let index = 0; index < values.length; index += 1) {
    const arg = String(values[index] || "");
    if (arg === "--prompt") {
      assertPromptRulesDisabled(values[index + 1], options);
      index += 1;
    } else if (arg.startsWith("--prompt=")) {
      assertPromptRulesDisabled(arg.slice("--prompt=".length), options);
    }
  }
  return values;
}

function validateGenerationTaskContract({ workflow, config = {}, analysis = {}, task = {} } = {}) {
  const errors = [];
  const warnings = [];
  if (workflow === "product") {
    if (!String(task.positivePrompt || "").trim()) errors.push("产品镜任务缺少正向提示词");
    if (!String(task.negativePrompt || "").trim()) warnings.push("产品镜任务缺少负向提示词");
    if (!String(config.productType || "").trim()) errors.push("产品镜任务缺少目标产品");
  } else if (workflow === "koc") {
    if (!String(task.voiceover || "").trim() && config.silentVideo !== true) errors.push("KOC分镜缺少锁定口播");
    if (!String(task.finalLibtvPrompt || "").trim()) errors.push("KOC分镜缺少最终生成提示词");
    if (!Number(task.duration || 0)) errors.push("KOC分镜缺少有效时长");
  } else if (workflow === "person") {
    if (!String(task.prompt || task.positivePrompt || "").trim()) errors.push("明星画面任务缺少最终提示词");
  } else if (workflow === "variation") {
    const storyboard = Array.isArray(task.storyboard) ? task.storyboard : [];
    const sourceShots = Array.isArray(analysis.shots)
      ? analysis.shots.filter((shot) => Number(shot.end) > Number(shot.start))
      : [];
    if (!storyboard.length) errors.push("缺少逐镜分镜，不能生成");
    if (Number(config.sourceDuration || 0) > 0 && Number(task.targetDuration || 0) < Number(config.sourceDuration) + 0.5) {
      errors.push("裂变成片时长必须比母版略长，用于补全口播、动作因果和自然收口");
    }
    let previousEnd = -1;
    storyboard.forEach((shot, index) => {
      const label = `镜头${index + 1}`;
      if (!String(shot.function || "").trim()) errors.push(`${label}缺少镜头功能`);
      if (!String(shot.action || "").trim()) errors.push(`${label}缺少主体动作`);
      if (!(Number(shot.end) > Number(shot.start))) errors.push(`${label}时间范围无效`);
      if (Number(shot.start) < previousEnd - 0.2) errors.push(`${label}与上一镜时间顺序冲突`);
      previousEnd = Math.max(previousEnd, Number(shot.end || 0));
      if (sourceShots.length && !(Number(shot.sourceEnd) > Number(shot.sourceStart))) {
        errors.push(`${label}缺少有效母版对位区间`);
      }
      if (String(shot.spokenLine || "").trim()) {
        if (!String(shot.speaker || "").trim()) errors.push(`${label}有台词但缺少说话人`);
        if (!String(shot.emotion || "").trim()) errors.push(`${label}有台词但缺少人物情绪`);
        if (!String(shot.voiceDirection || "").trim()) errors.push(`${label}有台词但缺少声音导演`);
      }
    });
    const scriptText = String(task.script?.text || "").trim();
    if (!task.script?.silent && !scriptText) errors.push("有口播任务缺少最终审核台词");
    if (config.noProduct) {
      if (storyboard.some((shot) => shot.productVisible === true)) errors.push("无产品模式分镜仍标记了产品露出");
    } else {
      if (!String(config.targetProductName || "").trim()) errors.push("缺少目标产品名称");
      if (!String(config.productTruth?.visualIdentity || "").trim()) errors.push("缺少目标产品视觉真值");
      if (!storyboard.some((shot) => shot.productVisible === true)) warnings.push("分镜未明确标记产品露出镜头，请人工确认");
      if (config.offer?.hasPrice && !scriptText.includes(String(config.offer.spoken || ""))) {
        warnings.push("最终口播未逐字包含本批已审核价格规格；任务继续生成，请人工抽听确认，正确价格规格仍会写入生成提示词");
      }
    }
    if (!String(analysis.speakerPerspective || "").trim()) warnings.push("母版未明确说话视角，需人工确认");
    if (!String(analysis.sceneContext || "").trim()) warnings.push("母版未明确人物与场景关系，需人工确认");
  }
  return { ok: errors.length === 0, rules: null, errors, warnings };
}

module.exports = {
  DISABLED_PROMPT_RULESET,
  BLOCKED_PROMPT_RULE_PATTERNS,
  promptRuleMetadata,
  rulesetHeader,
  analysisContract,
  backgroundCompositionContract,
  generationContract,
  qualityContract,
  assertPromptRulesDisabled,
  assertLibtvArgsPromptRulesDisabled,
  validateGenerationTaskContract
};
