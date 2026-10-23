const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CLI = process.env.LARK_CLI || path.join(process.env.APPDATA || "", "npm", "lark-cli.cmd");
const OUTPUT = path.join(ROOT, "app", "assets", "copy-library-assets.json");

const categories = [
  {
    id: "chat-koc",
    name: "唠嗑KOC脚本",
    description: "自然分享、问题切入与生活化种草",
    items: [
      ["黑白眼A", "【对外】WIS眼膜 · 唠嗑种草脚本 · 黑白眼A", "UYoKw5fDfifOMWkAMNAcsdEkn1b", "wiki"],
      ["大小眼A", "【对外】WIS眼膜 · 唠嗑种草脚本 · 大小眼A", "CiTWwLvmhirEXmkrOZdcujPqnGc", "wiki"],
      ["单人A", "【对外】WIS眼膜 · 唠嗑种草脚本 · 单人A", "UNLDwUzxIiFizCkoQrhckuMGnzh", "wiki"],
      ["高考A", "【对外】WIS眼膜 · 唠嗑种草脚本 · 高考A", "P9XWwUcrmigrtLkivAJcicIdnBf", "wiki"],
      ["高考B", "【对外】WIS眼膜 · 唠嗑种草脚本 · 高考B", "C1ZQw3Prli0gXYkcuX8cPflVnkd", "wiki"]
    ]
  },
  {
    id: "paid-koc",
    name: "付费KOC脚本",
    description: "信息流钩子、痛点表达与机制型成交结构",
    items: [
      ["补水切入", "WIS眼膜-爆款视频脚本1（如果你想给这里补水）", "WiuQwUGAAitsmikpAC5ckiRFnhc", "wiki"],
      ["45岁秦海璐", "WIS眼膜-爆款视频脚本2（45岁秦海璐）", "ZidmwSx4YirK9KkVsgjchxlLnpd", "wiki"],
      ["眼膜早用", "WIS眼膜-爆款视频脚本3（眼膜用的早看着就是比同龄人小）", "KbMFw5rh3ippdgkER7Uc9Cf6nDg", "wiki"],
      ["眼膜早用", "WIS眼膜-爆款视频脚本4（眼膜用的早看着就是比同龄人小）", "JpmcwoDp2iQfAjk8p34caZ93ngc", "wiki"],
      ["肖恩", "WIS眼膜-爆款视频脚本5（肖恩）", "GPiswWdi6ieEpDkCkaVcFHOsnDM", "wiki"],
      ["吾里七七", "WIS眼膜—爆款视频脚本6（吾里七七）", "DD2NwtALSioEyikQJQ3cHYTtnLc", "wiki"],
      ["机制类", "桌拍脚本A（机制类文案）", "Ah8ZwvxcFiHYUGk2UZTcmuSOn8g", "wiki"],
      ["痛点效果", "桌拍脚本B（痛点效果文案）", "QggSwA5fCi5kDBkke6ec2uSunVb", "wiki"],
      ["补水对比", "WIS眼膜-爆款视频脚本7（石笑笑 你贴10片补水的）", "GHnjw1PMxiN67TkY7JvcFj5unOd", "wiki"],
      ["45岁秦海璐", "WIS眼膜-爆款视频脚本8（石笑笑 45岁秦海璐）", "BVKkwoodLi0BctkyCq2cbdG0nGe", "wiki"]
    ]
  },
  {
    id: "story",
    name: "剧情脚本",
    description: "人物关系、冲突转折与剧情式种草",
    items: [
      ["暖阳夫妇", "WIS眼膜×暖阳夫妇（修改版）", "B7aowZTx4iOliBkVn76coJEOnxd", "wiki"],
      ["婆婆边界感", "毛毛×WIS眼膜 婆婆边界感脚本", "KqIZwSYvJi5yHFkr7tXcrOdpnbh", "wiki"],
      ["毛毛彦叔", "WIS眼膜×毛毛彦叔2024.08", "Pqmzw47Jniw1bVke9A9cudTXngb", "wiki"],
      ["财不外露", "WIS眼膜×木子李李（财不外露）", "Za23wTzDIi3Sujkl0GOcj5ounWe", "wiki"],
      ["上门提亲", "柠檬小姐*上门提亲*紧致眼膜", "TWtzwGdHtiVLQrktqzycTNPKnve", "wiki"],
      ["相亲真爱", "WIS眼膜×毛毛（相亲遇上真爱）", "O3tZwgpBzi5yBHkC5gxcO79dnjh", "wiki"],
      ["去男友家", "WIS眼膜×林秋天（去男友家）", "Kb8PwTk1DiVCG9kHzMncsh1lnmW", "wiki"],
      ["决定结婚", "WIS眼膜×大雨别走 决定结婚", "PCY6dJKIXorYmfxe1QzcxDuZned", "docx"],
      ["关系维护", "WIS眼膜✖️大海哥-关系维护", "LX30wNt10i6PsEkrIgucNiYhnbf", "wiki"],
      ["财不外露", "WIS眼膜×财不外露×姜莱的日子0124", "FmV0wW65RipH8kkMDRFc2XHOn5b", "wiki"],
      ["爱的本质", "彦叔×WIS眼膜-爱的本质是看见", "Ubcawov6sixO5okOYzoca0yenGh", "wiki"]
    ]
  }
];

function run(args) {
  const result = spawnSync(CLI, args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    shell: true
  });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `lark-cli exited ${result.status}`).trim());
  }
  const parsed = JSON.parse(result.stdout);
  if (!parsed.ok) throw new Error(parsed.error || parsed.message || "飞书内容读取失败");
  return parsed;
}

function cleanContent(value) {
  return String(value || "")
    .replace(/<img[\s\S]*?\/>/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 50000);
}

function fetchDoc(url) {
  const data = run(["docs", "+fetch", "--as", "user", "--doc", url, "--doc-format", "markdown"]);
  return cleanContent(data.data?.document?.content || "");
}

function shortTitle(text, prefix) {
  const first = String(text || "").split(/\n/).map((item) => item.replace(/^#+\s*/, "").trim()).find(Boolean) || prefix;
  return first.length > 42 ? `${first.slice(0, 42)}…` : first;
}

function splitOriginals(text, sourceName, sourceUrl, productName) {
  const blocks = String(text || "")
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 45);
  return blocks.slice(0, 80).map((fullText, index) => ({
    id: `${sourceName}-${String(index + 1).padStart(3, "0")}`,
    library: "second",
    title: shortTitle(fullText, `${sourceName}原文${index + 1}`),
    tag: sourceName,
    category: "完整原文",
    productName,
    evidenceTier: "A",
    sourceType: "feishu-doc",
    sourceUrl,
    fullText
  }));
}

function main() {
  const firstCreation = [];
  const failures = [];
  for (const category of categories) {
    for (const [tag, title, token, type] of category.items) {
      const sourceUrl = `https://jqx28l0j4lx.feishu.cn/${type}/${token}`;
      try {
        firstCreation.push({
          id: `first-${token}`,
          library: "first",
          title,
          tag,
          categoryId: category.id,
          category: category.name,
          description: category.description,
          productName: "WIS晶润紧致眼膜",
          evidenceTier: "A",
          sourceType: "feishu-doc",
          sourceUrl,
          fullText: fetchDoc(sourceUrl)
        });
        process.stdout.write(`已收录 ${firstCreation.length}/26：${title}\n`);
      } catch (error) {
        failures.push({ title, sourceUrl, error: error.message });
      }
    }
  }
  if (failures.length) throw new Error(`一创原文有${failures.length}篇读取失败：${JSON.stringify(failures)}`);

  const sheetUrl = "https://jqx28l0j4lx.feishu.cn/wiki/F2DAwQ39Li2KAbkjGOvcAFe0nOf";
  const sheet = run(["sheets", "+table-get", "--as", "user", "--url", sheetUrl, "--sheet-id", "cc9bd2"]);
  const rows = sheet.data?.sheets?.[0]?.data || [];
  const secondCreationOriginals = rows.map((row, index) => ({
    id: `second-water-${String(index + 1).padStart(3, "0")}`,
    library: "second",
    title: shortTitle(row[0], `水润往期爆款文案${index + 1}`),
    tag: String(row[2] || "历史有效"),
    category: "水润往期爆款",
    productName: "WIS隐形水润面膜",
    evidenceTier: row[3] ? "C" : "A",
    matchedVideo: String(row[1] || ""),
    riskNote: String(row[3] || ""),
    sourceType: "feishu-sheet",
    sourceUrl: sheetUrl,
    fullText: cleanContent(row[0])
  })).filter((item) => item.fullText);

  const sourceDocs = [
    {
      name: "WIS视频号",
      url: "https://jqx28l0j4lx.feishu.cn/wiki/OEVhwqjbMiefFYk8ydQcyVFnnxb",
      productName: "WIS多产品"
    },
    {
      name: "WIS眼膜有效文案",
      url: "https://jqx28l0j4lx.feishu.cn/docx/U0MKdBYN3oKINkxDWtaczyBFnxd",
      productName: "WIS晶润紧致眼膜"
    }
  ];
  for (const source of sourceDocs) {
    secondCreationOriginals.push(...splitOriginals(
      fetchDoc(source.url),
      source.name,
      source.url,
      source.productName
    ));
  }

  const payload = {
    version: "2026.07.30-r1",
    generatedAt: new Date().toISOString(),
    sourceOfTruth: "飞书历史有效文案与水润爆款表",
    firstCreation,
    secondCreationOriginals,
    summary: {
      firstCount: firstCreation.length,
      secondCount: secondCreationOriginals.length,
      failures: 0
    }
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`完成：一创${payload.summary.firstCount}篇，二创${payload.summary.secondCount}条\n${OUTPUT}\n`);
}

main();
