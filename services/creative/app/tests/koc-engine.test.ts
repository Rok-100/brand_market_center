import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCreativeBrief, countSpokenCharacters, generateScripts, getLengthAssessment, reviseScript } from "../lib/script-engine.ts";

const input = {
  product: "黄金面膜",
  scriptType: "付费KOC脚本",
  templateTitle: "45岁秦海璐推荐时我忍住了",
  templateCopy: "45岁的秦海璐推荐它的时候我忍住了，现在品牌把价格打下来我真忍不了了。",
  requirements: "针对40+，突出脸松、垮、纹和显年轻，保留明星背书与库存促单",
};

test("付费KOC生成三条差异化完整脚本", () => {
  const drafts = generateScripts(input);
  assert.equal(drafts.length, 3);
  assert.equal(new Set(drafts.map((item) => item.title)).size, 3);
  for (const draft of drafts) {
    assert.match(draft.content, /30\+熟龄女性/);
    assert.match(draft.content, /口播：/);
    assert.match(draft.content, /画面：/);
    assert.match(draft.content, /四十|40|年龄|显老|年轻/);
    assert.match(draft.content, /润|嘭|凉|精华/);
    assert.ok(countSpokenCharacters(draft.content) >= 260);
    assert.ok(countSpokenCharacters(draft.content) <= 340);
    assert.equal(getLengthAssessment(draft.content).status, "合适");
    assert.doesNotMatch(draft.content, /加班|空调房|不卡粉|学生党|奶茶/);
  }
  assert.match(drafts[2].content, /女明星|明星/);
});

test("创作分析明确人群与去研发腔", () => {
  const analysis = analyzeCreativeBrief(input);
  assert.match(analysis, /40\+/);
  assert.match(analysis, /参考脚本已实际拆解/);
  assert.match(analysis, /补充需求/);
});

test("审核改稿将研发词翻译成消费者语言", () => {
  const content = "球型PDRN微球控释技术配合六重胜肽分层抗老系统，采用黄金膜布单向封包。";
  const revised = reviseScript({ content, feedback: "去掉研发术语，多写口语和肤感，再加强40+年龄焦虑与价格促单", version: 2, product: "黄金面膜" });
  assert.doesNotMatch(revised, /微球控释|分层抗老系统|单向封包/);
  assert.match(revised, /一点点释放|一层层照顾|精华稳稳留在脸上/);
  assert.match(revised, /40岁|过了40岁/);
  assert.match(revised, /活动|备上|高阶护理/);
});
