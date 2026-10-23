import { env } from "cloudflare:workers";
import { getCurrentUser, isManager, listWorkspaceUsers } from "../../../lib/current-user";

type DraftRow = Record<string, unknown>;

function mapDraft(row: DraftRow) {
  return {
    id: row.id, product: row.product, scriptType: row.script_type, templateId: row.template_id,
    templateTitle: row.template_title, requirements: row.requirements, title: row.title, content: row.content,
    version: row.version, status: row.status, feedback: row.feedback, creatorId: row.creator_id,
    creatorName: row.creator_name, uploaderId: row.uploader_id, uploaderName: row.uploader_name,
    authorType: row.author_type, authorName: row.author_name, authorUserId: row.author_user_id,
    teamLeadReviewerId: row.team_lead_reviewer_id, teamLeadReviewerName: row.team_lead_reviewer_name,
    supervisorReviewerId: row.supervisor_reviewer_id, supervisorReviewerName: row.supervisor_reviewer_name,
    currentReviewerId: row.current_reviewer_id, priority: row.priority, dueDate: row.due_date,
    resumeStage: row.resume_stage, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    const pendingStatuses = ["pending_review", "pending_team_lead", "pending_supervisor"];
    const rows = (await env.DB.prepare("SELECT * FROM creative_drafts ORDER BY updated_at DESC LIMIT 300").all<DraftRow>()).results ?? [];
    const drafts = rows.map(mapDraft);
    const assigned = drafts.filter((item) => pendingStatuses.includes(String(item.status)) && item.currentReviewerId === user.id);
    const returned = drafts.filter((item) => item.status === "returned_to_creator" && (item.creatorId === user.id || item.uploaderId === user.id));
    const submissions = drafts.filter((item) => item.creatorId === user.id || item.uploaderId === user.id);
    const teamQueue = user.role === "admin" ? drafts : isManager(user) ? drafts.filter((item) => pendingStatuses.includes(String(item.status))) : [];
    const notifications = (await env.DB.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30").bind(user.id).all<Record<string, unknown>>()).results ?? [];
    const today = new Date().toISOString().slice(0, 10);
    const dueSoon = [...assigned, ...returned].filter((item) => item.dueDate && String(item.dueDate) <= today).length;
    return Response.json({
      user,
      users: await listWorkspaceUsers(),
      counts: {
        assigned: assigned.length,
        returned: returned.length,
        submitted: submissions.filter((item) => !["approved", "archived"].includes(String(item.status))).length,
        completed: submissions.filter((item) => ["approved", "archived"].includes(String(item.status))).length,
        dueSoon,
        unread: notifications.filter((item) => Number(item.is_read) === 0).length,
        teamPending: teamQueue.length,
      },
      assigned, returned, submissions, teamQueue, notifications,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "个人工作台读取失败" }, { status: 500 });
  }
}
