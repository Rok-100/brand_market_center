import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { creativeDrafts, notifications, reviewActions, scriptVersions, workspaceUsers } from "../../../db/schema";
import { getCurrentUser } from "../../../lib/current-user";
import { ensureWorkflowSchema, uid } from "../../../lib/workflow-schema";

const PRODUCTS = ["眼膜", "水润面膜", "水油/蛋白喷雾", "美白针", "黄金面膜", "微针面膜", "燕窝面膜", "次抛精华"];
const SCRIPT_TYPES = ["付费KOC脚本", "唠嗑KOC脚本", "明星脚本", "AI脚本", "自产脚本", "混剪脚本", "剧情脚本"];

export async function POST(request: Request) {
  try {
    await ensureWorkflowSchema();
    const user = await getCurrentUser(request);
    const payload = await request.json() as Record<string, unknown>;
    const title = String(payload.title ?? "").trim();
    const content = String(payload.content ?? "").trim();
    const product = String(payload.product ?? "").trim();
    const scriptType = String(payload.scriptType ?? "").trim();
    const talentName = String(payload.talentName ?? "").trim();
    const authorUserId = String(payload.authorUserId ?? "").trim();
    const teamLeadReviewerId = String(payload.teamLeadReviewerId ?? "").trim();
    const supervisorReviewerId = String(payload.supervisorReviewerId ?? "").trim();
    const priority = ["紧急", "普通", "低"].includes(String(payload.priority)) ? String(payload.priority) : "普通";
    const dueDate = String(payload.dueDate ?? "").trim();
    const videoUrls = Array.isArray(payload.videoUrls) ? payload.videoUrls.map(String).filter((url) => /^https?:\/\//i.test(url)).slice(0, 12) : [];
    if (title.length < 2) return Response.json({ error: "请填写脚本名称" }, { status: 400 });
    if (content.length < 20) return Response.json({ error: "脚本内容至少需要 20 个字" }, { status: 400 });
    if (!PRODUCTS.includes(product) || !SCRIPT_TYPES.includes(scriptType)) return Response.json({ error: "请选择有效的单品和脚本类型" }, { status: 400 });

    const db = getDb();
    const lookup = async (id: string) => (await db.select().from(workspaceUsers).where(eq(workspaceUsers.id, id)).limit(1))[0];
    const author = await lookup(authorUserId || user.id);
    const lead = await lookup(teamLeadReviewerId);
    const supervisor = await lookup(supervisorReviewerId);
    const selectable = (person: typeof author) => person?.active && (person.loginRegistered || person.preloaded);
    if (!selectable(author) || !selectable(lead) || !selectable(supervisor)) return Response.json({ error: "请选择有效的作者、组长审核人和主管审核人" }, { status: 400 });

    const id = uid("DR");
    const draft = {
      id, product, scriptType, title, content, talentName, videoLinks: JSON.stringify(videoUrls),
      templateId: "", templateTitle: "", requirements: "日常脚本上传", version: 1,
      status: "pending_team_lead", feedback: "", creatorId: user.id, creatorName: user.name,
      uploaderId: user.id, uploaderName: user.name, authorType: "内部同事", authorName: author.name,
      authorUserId: author.id, teamLeadReviewerId: lead.id, teamLeadReviewerName: lead.name,
      supervisorReviewerId: supervisor.id, supervisorReviewerName: supervisor.name,
      currentReviewerId: lead.id, priority, dueDate, resumeStage: "pending_team_lead",
    };
    await db.insert(creativeDrafts).values(draft);
    await db.insert(scriptVersions).values({ id: uid("VER"), draftId: id, version: 1, title, content, editorId: user.id, editorName: user.name, reason: "日常脚本提交" });
    await db.insert(reviewActions).values({ id: uid("ACT"), draftId: id, action: "submit", stage: "pending_team_lead", actorId: user.id, actorName: user.name, comment: "提交组长审核", version: 1 });
    await db.insert(notifications).values({ id: uid("NTF"), userId: lead.id, draftId: id, title: `待审核：${title}`, detail: `${user.name} 提交了日常脚本，请完成组长审核` });
    return Response.json({ draft }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "日常脚本提交失败" }, { status: 500 });
  }
}
