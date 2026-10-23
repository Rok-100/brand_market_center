import { normalizeChatId, scriptNoticeRows } from "../../../../lib/script-notifications.mjs";
import { eq, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { creativeDrafts, creativeScripts, creativeVideos, notifications, scriptNotificationPayloads, scriptNotificationChats, reviewActions, scriptAlternatives, scriptVersions, workspaceUsers } from "../../../../db/schema";
import { getCurrentUser, isManager, type WorkspaceUser } from "../../../../lib/current-user";
import { generateAiScripts } from "../../../../lib/script-ai.mjs";
import { ensureWorkflowSchema, uid } from "../../../../lib/workflow-schema";

type Draft = typeof creativeDrafts.$inferSelect;
type PatchPayload = {
  action?: string;
  title?: string;
  content?: string;
  feedback?: string;
  authorType?: string;
  authorName?: string;
  authorUserId?: string;
  teamLeadReviewerId?: string;
  supervisorReviewerId?: string;
  priority?: string;
  dueDate?: string;
  alternativeId?: string;
  notificationChatId?: string;
};

function canEdit(user: WorkspaceUser, draft: Draft) {
  return isManager(user) || [draft.creatorId, draft.uploaderId, draft.authorUserId].includes(user.id);
}

function canReview(user: WorkspaceUser, draft: Draft) {
  return isManager(user) || draft.currentReviewerId === user.id;
}

async function addVersion(draftId: string, version: number, title: string, content: string, user: WorkspaceUser, reason: string) {
  await getDb().insert(scriptVersions).values({ id: uid("VER"), draftId, version, title, content, editorId: user.id, editorName: user.name, reason });
}

async function addAction(draft: Draft, user: WorkspaceUser, action: string, stage: string, comment = "", version = draft.version) {
  await getDb().insert(reviewActions).values({ id: uid("ACT"), draftId: draft.id, action, stage, actorId: user.id, actorName: user.name, comment, version });
}

async function notify(userId: string, draftId: string, title: string, detail: string) {
  if (!userId) return;
  await getDb().insert(notifications).values({ id: uid("NTF"), userId, draftId, title, detail });
}

async function findReviewer(id: string) {
  if (!id) return null;
  const [reviewer] = await getDb().select().from(workspaceUsers).where(eq(workspaceUsers.id, id)).limit(1);
  return reviewer?.active && (reviewer.loginRegistered || reviewer.preloaded) ? reviewer : null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const payload = (await request.json()) as PatchPayload;
    await ensureWorkflowSchema();
    const user = await getCurrentUser(request);
    const db = getDb();
    const [draft] = await db.select().from(creativeDrafts).where(eq(creativeDrafts.id, id)).limit(1);
    if (!draft) return Response.json({ error: "未找到脚本" }, { status: 404 });

    const title = payload.title?.trim() || draft.title;
    const content = payload.content?.trim() || draft.content;
    const changed = title !== draft.title || content !== draft.content;
    if (["save", "submit", "resubmit"].includes(payload.action ?? "") && content.length < 20) {
      return Response.json({ error: "脚本内容至少需要 20 个字" }, { status: 400 });
    }

    if (payload.action === "save") {
      if (!canEdit(user, draft)) return Response.json({ error: "你没有修改这条脚本的权限" }, { status: 403 });
      const version = changed ? draft.version + 1 : draft.version;
      await db.update(creativeDrafts).set({ title, content, version, authorType: payload.authorType?.trim() || draft.authorType, authorName: payload.authorName?.trim() || draft.authorName, authorUserId: payload.authorUserId?.trim() ?? draft.authorUserId, updatedAt: new Date().toISOString() }).where(eq(creativeDrafts.id, id));
      if (changed) await addVersion(id, version, title, content, user, "保存修改");
    } else if (payload.action === "submit") {
      if (!canEdit(user, draft)) return Response.json({ error: "你没有提交这条脚本的权限" }, { status: 403 });
      const lead = await findReviewer(payload.teamLeadReviewerId?.trim() || "");
      const supervisor = await findReviewer(payload.supervisorReviewerId?.trim() || "");
      if (!lead || !supervisor) return Response.json({ error: "请选择有效的组长审核人和主管审核人" }, { status: 400 });
      const version = changed ? draft.version + 1 : draft.version;
      await db.update(creativeDrafts).set({
        title, content, version, status: "pending_team_lead", currentReviewerId: lead.id,
        teamLeadReviewerId: lead.id, teamLeadReviewerName: lead.name,
        supervisorReviewerId: supervisor.id, supervisorReviewerName: supervisor.name,
        authorType: payload.authorType?.trim() || draft.authorType,
        authorName: payload.authorName?.trim() || draft.authorName,
        authorUserId: payload.authorUserId?.trim() ?? draft.authorUserId,
        priority: payload.priority?.trim() || "普通", dueDate: payload.dueDate?.trim() || "",
        resumeStage: "pending_team_lead", updatedAt: new Date().toISOString(),
      }).where(eq(creativeDrafts.id, id));
      if (changed) await addVersion(id, version, title, content, user, "提交审核前修改");
      await addAction(draft, user, "submit", "pending_team_lead", "提交组长审核", version);
      await notify(lead.id, id, `待审核：${title}`, `${user.name} 提交了脚本，请完成组长审核`);
    } else if (payload.action === "team_lead_approve") {
      if (draft.status !== "pending_team_lead" || !canReview(user, draft)) return Response.json({ error: "当前脚本不在你的组长审核队列" }, { status: 403 });
      await db.update(creativeDrafts).set({ status: "pending_supervisor", currentReviewerId: draft.supervisorReviewerId, feedback: payload.feedback?.trim() || draft.feedback, updatedAt: new Date().toISOString() }).where(eq(creativeDrafts.id, id));
      await addAction(draft, user, "approve", "team_lead", payload.feedback?.trim() || "组长审核通过");
      await notify(draft.supervisorReviewerId, id, `待终审：${draft.title}`, `${user.name} 已通过组长审核，请完成主管终审`);
    } else if (payload.action === "reject") {
      if (!["pending_team_lead", "pending_supervisor"].includes(draft.status) || !canReview(user, draft)) return Response.json({ error: "当前脚本不在你的审核队列" }, { status: 403 });
      const feedback = payload.feedback?.trim() || "";
      if (feedback.length < 2) return Response.json({ error: "请填写明确的修改建议" }, { status: 400 });
      await db.update(creativeDrafts).set({ status: "returned_to_creator", currentReviewerId: draft.creatorId, feedback, resumeStage: draft.status, updatedAt: new Date().toISOString() }).where(eq(creativeDrafts.id, id));
      await addAction(draft, user, "reject", draft.status === "pending_supervisor" ? "supervisor" : "team_lead", feedback);
      await notify(draft.creatorId || draft.uploaderId, id, `脚本需修改：${draft.title}`, feedback);
    } else if (payload.action === "regenerate") {
      if (!canEdit(user, draft) && !canReview(user, draft)) return Response.json({ error: "你没有修改这条脚本的权限" }, { status: 403 });
      const feedback = payload.feedback?.trim() || "";
      if (feedback.length < 2) return Response.json({ error: "请先填写修改建议" }, { status: 400 });
      const generated = await generateAiScripts({ product: draft.product, scriptType: draft.scriptType,
        templateTitle: draft.templateTitle, templateCopy: "", requirements: feedback,
        previousContent: content }, { count: 1, creativeMode: "expand", rewriteMode: "same-direction" }, request.headers);
      const revised = generated.drafts[0].content;
      const alternative = {
        id: uid("ALT"), draftId: id, title: `${title}｜AI 建议稿`, content: revised, request: feedback,
        creatorId: user.id, creatorName: user.name, adopted: false,
      };
      const noticeRows = scriptNoticeRows({eventId: alternative.id, kind: "alternative", draft: {...draft, title: alternative.title, content: revised}, user});
      await db.batch([
        db.insert(scriptAlternatives).values(alternative),
        db.insert(reviewActions).values({id: uid("ACT"), draftId: id, action: "ai_revise_candidate", stage: draft.status, actorId: user.id, actorName: user.name, comment: feedback, version: draft.version}),
        db.insert(notifications).values(noticeRows.notices),
        db.insert(scriptNotificationPayloads).values(noticeRows.payloads),
      ]);
      return Response.json({ draft, alternative });
    } else if (payload.action === "adopt_alternative") {
      if (!canEdit(user, draft) && !canReview(user, draft)) return Response.json({ error: "你没有采用这版新稿的权限" }, { status: 403 });
      const [alternative] = await db.select().from(scriptAlternatives).where(eq(scriptAlternatives.id, payload.alternativeId?.trim() || "")).limit(1);
      if (!alternative || alternative.draftId !== id) return Response.json({ error: "未找到这版 AI 新稿" }, { status: 404 });
      const version = draft.version + 1;
      await db.update(creativeDrafts).set({ title: alternative.title.replace(/｜AI 建议稿$/, ""), content: alternative.content, feedback: alternative.request, version, updatedAt: new Date().toISOString() }).where(eq(creativeDrafts.id, id));
      await db.update(scriptAlternatives).set({ adopted: true }).where(eq(scriptAlternatives.id, alternative.id));
      await addVersion(id, version, alternative.title.replace(/｜AI 建议稿$/, ""), alternative.content, user, `采用 AI 新稿：${alternative.request}`);
      await addAction(draft, user, "adopt_ai_revision", draft.status, alternative.request, version);
    } else if (payload.action === "resubmit") {
      if (!canEdit(user, draft) || draft.status !== "returned_to_creator") return Response.json({ error: "当前脚本不可重新提交" }, { status: 403 });
      const nextStage = draft.resumeStage === "pending_supervisor" ? "pending_supervisor" : "pending_team_lead";
      const reviewerId = nextStage === "pending_supervisor" ? draft.supervisorReviewerId : draft.teamLeadReviewerId;
      const version = changed ? draft.version + 1 : draft.version;
      await db.update(creativeDrafts).set({ title, content, version, status: nextStage, currentReviewerId: reviewerId, updatedAt: new Date().toISOString() }).where(eq(creativeDrafts.id, id));
      if (changed) await addVersion(id, version, title, content, user, "按审核意见修改并重新提交");
      await addAction(draft, user, "resubmit", nextStage, draft.feedback, version);
      await notify(reviewerId, id, `重新送审：${title}`, `${user.name} 已按意见修改，请再次审核`);
    } else if (payload.action === "supervisor_approve" || payload.action === "approve") {
      if (draft.status !== "pending_supervisor") return Response.json({ error: "脚本尚未进入主管终审，或已经归档，请刷新后查看" }, { status: 409 });
      if (!canReview(user, draft)) return Response.json({ error: "当前脚本不在你的主管审核队列" }, { status: 403 });
      const chatId = normalizeChatId(payload.notificationChatId);
      const version = changed ? draft.version + 1 : draft.version;
      const now = new Date().toISOString();
      const caseItem = {
        id: `CS-FINAL-${id}`, scriptType: draft.scriptType, product: draft.product, title, copy: content,
        status: "已验证", source: "主管审核通过", authorType: draft.authorType, authorName: draft.authorName,
        authorUserId: draft.authorUserId, uploaderId: draft.uploaderId, uploaderName: draft.uploaderName,
        finalReviewerId: user.id, finalReviewerName: user.name, archivedFromDraftId: draft.id, talentName: draft.talentName,
      };
      let videoLinks: string[] = [];
      try { videoLinks = JSON.parse(draft.videoLinks || "[]"); } catch { videoLinks = []; }
      const statements: any[] = [
        // Stable primary keys make concurrent final approvals roll back as one unit.
        db.insert(creativeScripts).values(caseItem),
        db.update(creativeDrafts).set({ title, content, version, status: "approved", currentReviewerId: "", updatedAt: now }).where(eq(creativeDrafts.id, id)),
        db.insert(reviewActions).values({ id: `ACT-FINAL-${id}`, draftId: id, action: "approve", stage: "supervisor", actorId: user.id, actorName: user.name, comment: payload.feedback?.trim() || "主管终审通过并归档", version }),
        db.insert(notifications).values({ id: `NTF-FINAL-${id}`, userId: draft.creatorId || draft.uploaderId, draftId: id, title: `已归档：${title}`, detail: `${user.name} 已完成主管终审，脚本已进入品牌案例库` }),
      ];
      if (changed) statements.push(db.insert(scriptVersions).values({id: uid("VER"), draftId: id, version, title, content, editorId: user.id, editorName: user.name, reason: "主管终审修改"}));
      if (videoLinks.length) statements.push(db.insert(creativeVideos).values(videoLinks.map((url, index) => ({
        id: uid("CV"), scriptId: caseItem.id, title: `关联视频 ${index + 1}`, url, duration: "待解析", coverTone: ["forest", "amber", "blue", "rose"][index % 4],
      }))));
      if (chatId) {
        const rows = scriptNoticeRows({eventId: `FINAL-${id}`, kind: "approved", draft: {...draft, title, content, version}, user, chatId});
        statements.push(db.insert(notifications).values(rows.notices), db.insert(scriptNotificationPayloads).values(rows.payloads));
        statements.push(db.insert(scriptNotificationChats).values({id: `${user.id}:${chatId}`, userId: user.id, chatId, updatedAt: now})
          .onConflictDoUpdate({target: sql`"id"`, set: {updatedAt: now}}));
      }
      await db.batch(statements as [any, ...any[]]);
      const [updated] = await db.select().from(creativeDrafts).where(eq(creativeDrafts.id, id)).limit(1);
      return Response.json({ draft: updated, case: { ...caseItem, videos: [] }, groupNotification: chatId ? "queued" : "none" });
    } else {
      return Response.json({ error: "未知操作" }, { status: 400 });
    }

    const [updated] = await db.select().from(creativeDrafts).where(eq(creativeDrafts.id, id)).limit(1);
    return Response.json({ draft: updated });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "脚本更新失败" }, { status: Number((error as { status?: number })?.status) || 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await ensureWorkflowSchema();
    const user = await getCurrentUser(request);
    const db = getDb();
    const [draft] = await db.select().from(creativeDrafts).where(eq(creativeDrafts.id, id)).limit(1);
    if (!draft) return Response.json({ error: "未找到脚本" }, { status: 404 });
    const ownsDraft = [draft.creatorId, draft.uploaderId, draft.authorUserId].includes(user.id);
    if (!ownsDraft && user.role !== "admin") return Response.json({ error: "只能删除自己的脚本" }, { status: 403 });
    let videoLinks: string[] = [];
    try { videoLinks = JSON.parse(draft.videoLinks || "[]"); } catch { videoLinks = []; }
    const storedKeys = videoLinks.map((url) => url.match(/^\/api\/media\/(.+)$/)?.[1]).filter((key): key is string => !!key).map(decodeURIComponent);
    if (storedKeys.length) await env.MEDIA.delete(storedKeys);
    await db.delete(scriptAlternatives).where(eq(scriptAlternatives.draftId, id));
    await db.delete(scriptVersions).where(eq(scriptVersions.draftId, id));
    await db.delete(reviewActions).where(eq(reviewActions.draftId, id));
    await db.delete(notifications).where(eq(notifications.draftId, id));
    await db.delete(creativeDrafts).where(eq(creativeDrafts.id, id));
    return Response.json({ ok: true, id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "脚本删除失败" }, { status: Number((error as { status?: number })?.status) || 500 });
  }
}
