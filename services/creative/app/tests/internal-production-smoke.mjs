const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";

async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 160) };
  }
  if (!response.ok) throw new Error(`${path} ${response.status} ${JSON.stringify(body)}`);
  return body;
}

const imported = await call("/api/cases", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    scriptType: "AI脚本",
    product: "眼膜",
    copy: "【内部系统验收 2026-08-11】加班后的十分钟眼周护理记录，保留真实过程，不使用夸张功效表达。",
    videoUrls: [],
  }),
});
const generated = await call("/api/scripts", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    product: "眼膜",
    scriptType: "剧情脚本",
    templateId: imported.case.id,
    templateTitle: imported.case.title,
    templateCopy: imported.case.copy,
    requirements: "内部验收：开头简洁、口语自然、突出加班场景，避免夸张功效",
  }),
});
const draft = generated.drafts[0];
const submitted = await call(`/api/scripts/${draft.id}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "submit", title: `${draft.title}｜内部验收`, content: draft.content }),
});
const revised = await call(`/api/scripts/${draft.id}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "regenerate", content: submitted.draft.content, feedback: "开头再短一点，更口语，避免夸张功效" }),
});
const approved = await call(`/api/scripts/${draft.id}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "approve", title: revised.draft.title, content: revised.draft.content }),
});
const cases = await call("/api/cases");

console.log(JSON.stringify({
  importedCase: imported.case.id,
  generatedCount: generated.drafts.length,
  submittedStatus: submitted.draft.status,
  revisedVersion: revised.draft.version,
  approvedStatus: approved.draft.status,
  approvedCase: approved.case.id,
  caseFound: cases.cases.some((item) => item.id === approved.case.id),
}, null, 2));
