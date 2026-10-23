import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { creativeDrafts, reviewActions, scriptAlternatives, scriptVersions } from "../../../../../db/schema";
import { getCurrentUser, isManager } from "../../../../../lib/current-user";
import { ensureWorkflowSchema } from "../../../../../lib/workflow-schema";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureWorkflowSchema();
    const user = await getCurrentUser(request);
    const { id } = await context.params;
    const db = getDb();
    const [draft] = await db.select().from(creativeDrafts).where(eq(creativeDrafts.id, id)).limit(1);
    if (!draft) return Response.json({ error: "未找到脚本" }, { status: 404 });
    const related = [draft.creatorId, draft.uploaderId, draft.authorUserId, draft.teamLeadReviewerId, draft.supervisorReviewerId].includes(user.id);
    if (!related && !isManager(user)) return Response.json({ error: "你没有查看这条脚本记录的权限" }, { status: 403 });
    const versions = await db.select().from(scriptVersions).where(eq(scriptVersions.draftId, id)).orderBy(asc(scriptVersions.version));
    const actions = await db.select().from(reviewActions).where(eq(reviewActions.draftId, id)).orderBy(asc(reviewActions.createdAt));
    const alternatives = await db.select().from(scriptAlternatives).where(eq(scriptAlternatives.draftId, id)).orderBy(asc(scriptAlternatives.createdAt));
    return Response.json({ versions, actions, alternatives });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "历史记录读取失败" }, { status: 500 });
  }
}
