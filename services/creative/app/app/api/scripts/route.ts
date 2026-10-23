import { scriptNoticeRows } from "../../../lib/script-notifications.mjs";
import { generateAiScripts } from "../../../lib/script-ai.mjs";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { creativeDrafts, scriptVersions, notifications, scriptNotificationPayloads } from "../../../db/schema";
import { getLengthAssessment, type CreativeMode, type RewriteMode } from "../../../lib/script-engine";
import { getCurrentUser } from "../../../lib/current-user";
import { ensureWorkflowSchema, uid } from "../../../lib/workflow-schema";

const PRODUCTS = ["眼膜", "水润面膜", "水油/蛋白喷雾", "美白针", "黄金面膜", "黑晶面膜", "微针面膜", "燕窝面膜", "次抛精华"];
const STYLES = ["付费KOC脚本", "唠嗑KOC脚本", "明星原片脚本", "明星营销号脚本", "视频号脚本", "明星脚本", "AI脚本", "自产脚本", "混剪脚本", "剧情脚本"];

function contentSimilarity(left: string, right: string) {
  const normalize = (value: string) => value
    .replace(/^(【创作定位】|【参考依据】|【类型标准】|【补充需求】|【长度标准】).*\n?/gm, "")
    .replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "")
    .toLowerCase();
  const grams = (value: string) => {
    const clean = normalize(value);
    const result = new Set<string>();
    for (let index = 0; index < clean.length - 1; index += 1) result.add(clean.slice(index, index + 2));
    return result;
  };
  const a = grams(left);
  const b = grams(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((entry) => { if (b.has(entry)) shared += 1; });
  return shared / (a.size + b.size - shared);
}

async function ensureSchema() {
  await ensureWorkflowSchema();
}

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const status = new URL(request.url).searchParams.get("status");
    const db = getDb();
    const drafts = status
      ? await db.select().from(creativeDrafts).where(eq(creativeDrafts.status, status)).orderBy(desc(creativeDrafts.updatedAt)).limit(100)
      : await db.select().from(creativeDrafts).orderBy(desc(creativeDrafts.updatedAt)).limit(100);
    return Response.json({ drafts });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "脚本读取失败" }, { status: Number((error as { status?: number })?.status) || 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { product?: string; scriptType?: string; templateId?: string; templateTitle?: string; templateCopy?: string; requirements?: string; audience?: string; count?: number; generationKey?: string; previousContent?: string; avoidContents?: string[]; rewriteMode?: RewriteMode; creativeMode?: CreativeMode };
    const product = payload.product?.trim() ?? "";
    const scriptType = payload.scriptType?.trim() ?? "";
    let templateCopy = payload.templateCopy?.trim() ?? "";
    let templateId = payload.templateId?.trim() ?? "";
    let templateTitle = payload.templateTitle?.trim() ?? "";
    const requirements = payload.requirements?.trim() ?? "";
    if (!PRODUCTS.includes(product)) return Response.json({ error: "请选择有效的产品" }, { status: 400 });
    if (!STYLES.includes(scriptType)) return Response.json({ error: "请选择有效的目标风格" }, { status: 400 });
    if (!templateId || templateCopy.length < 8) {
      templateId = "";
      templateTitle = "独立创作";
      templateCopy = "";
    }
    if (requirements.length < 2) return Response.json({ error: "请填写补充需求" }, { status: 400 });

    await ensureSchema();
    const user = await getCurrentUser(request);
    const db = getDb();
    const creativeInput = { product, scriptType, templateTitle, templateCopy, requirements, audience: payload.audience ?? "", previousContent: payload.previousContent ?? "" };
    const count = Math.max(1, Math.min(Number(payload.count) || 1, 3));
    const generationKey = payload.generationKey?.trim() || crypto.randomUUID();
    const previousContent = payload.previousContent?.trim() ?? "";
    const avoidContents = Array.from(new Set([...(payload.avoidContents ?? []), previousContent].map((entry) => entry.trim()).filter(Boolean))).slice(-12);
    const creativeMode = payload.creativeMode || "expand";
    const generated = await generateAiScripts(creativeInput, { count, generationKey, creativeMode, rewriteMode: payload.rewriteMode || "new-direction", avoidContents }, request.headers);
    const candidates = generated.drafts;
    const distanceFromHistory = (content: string) => avoidContents.length
      ? Math.max(...avoidContents.map((previous) => contentSimilarity(previous, content)))
      : 0;
    const selected = previousContent
      ? [...candidates].sort((left, right) => distanceFromHistory(left.content) - distanceFromHistory(right.content)).slice(0, count)
      : candidates;
    const drafts = selected.map((item) => ({
      id: `DR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      product,
      scriptType,
      templateId,
      templateTitle,
      requirements,
      title: item.title,
      content: item.content,
      version: 1,
      status: "generated",
      feedback: `创意路线：${item.creativeRoute} · ${["付费KOC脚本", "唠嗑KOC脚本"].includes(scriptType)
        ? `口播${getLengthAssessment(item.content).count}字`
        : `口播${getLengthAssessment(item.content).count}字 · 已按${scriptType}结构生成`}${previousContent ? ` · 与历史版本最高相似度${Math.round(distanceFromHistory(item.content) * 100)}%` : ""}`,
      creatorId: user.id,
      creatorName: user.name,
      uploaderId: user.id,
      uploaderName: user.name,
      authorType: "内部同事",
      authorName: user.name,
      authorUserId: user.id,
    }));
    const noticeRows = drafts.map(draft => scriptNoticeRows({eventId: draft.id, kind: "generated", draft, user}));
    await db.batch([
      db.insert(creativeDrafts).values(drafts),
      db.insert(scriptVersions).values(drafts.map((draft) => ({
      id: uid("VER"), draftId: draft.id, version: 1, title: draft.title, content: draft.content,
      editorId: user.id, editorName: user.name, reason: "AI 初稿生成",
    }))),
      db.insert(notifications).values(noticeRows.flatMap(row => row.notices)),
      db.insert(scriptNotificationPayloads).values(noticeRows.flatMap(row => row.payloads)),
    ]);
    return Response.json({ analysis: generated.analysis, drafts, generationKey, model: generated.model }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "生成失败" }, { status: Number((error as { status?: number })?.status) || 500 });
  }
}
