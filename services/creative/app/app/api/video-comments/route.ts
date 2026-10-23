import { env } from "cloudflare:workers";
import { getCurrentUser } from "../../../lib/current-user";
import { ensureWorkflowSchema, uid } from "../../../lib/workflow-schema";

type Row = Record<string, unknown>;

function mapComment(row: Row) {
  const screenshotKey = String(row.screenshot_key ?? "");
  return {
    id: String(row.id), itemId: String(row.item_id), mediaId: String(row.media_id), version: Number(row.version),
    timeSeconds: Number(row.time_seconds), comment: String(row.comment), authorId: String(row.author_id), authorName: String(row.author_name),
    status: String(row.status), createdAt: String(row.created_at), resolvedAt: String(row.resolved_at ?? ""),
    screenshotUrl: screenshotKey ? `/api/media?key=${encodeURIComponent(screenshotKey)}` : "",
  };
}

async function assertParticipant(itemId: string, user: { id: string; name: string }) {
  const item = await env.DB.prepare("SELECT submitter_id, author_id FROM creative_work_items WHERE id=? AND content_type='video' LIMIT 1").bind(itemId).first<Row>();
  if (!item) throw new Error("视频审核任务不存在");
  const reviewer = await env.DB.prepare("SELECT id FROM creative_work_reviewers WHERE item_id=? AND reviewer_id=? LIMIT 1").bind(itemId, user.id).first<Row>();
  const isAdmin = user.name === "李雨橦" || user.id.toUpperCase() === "FD-023794";
  if (!isAdmin && ![String(item.submitter_id), String(item.author_id)].includes(user.id) && !reviewer) throw new Error("只有任务参与人可以添加或处理画面意见");
}

export async function GET(request: Request) {
  try {
    await ensureWorkflowSchema();
    const user = await getCurrentUser(request);
    const itemId = new URL(request.url).searchParams.get("itemId") ?? "";
    await assertParticipant(itemId, user);
    const rows = (await env.DB.prepare("SELECT * FROM creative_video_comments WHERE item_id=? ORDER BY version DESC, time_seconds, created_at").bind(itemId).all<Row>()).results ?? [];
    return Response.json({ comments: rows.map(mapComment) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取画面意见失败" }, { status: 403 });
  }
}

export async function POST(request: Request) {
  let screenshotKey = "";
  try {
    await ensureWorkflowSchema();
    const user = await getCurrentUser(request);
    const form = await request.formData();
    const itemId = String(form.get("itemId") ?? "");
    const mediaId = String(form.get("mediaId") ?? "");
    const comment = String(form.get("comment") ?? "").trim();
    const timeSeconds = Number(form.get("timeSeconds") ?? 0);
    await assertParticipant(itemId, user);
    const media = await env.DB.prepare("SELECT * FROM creative_work_media WHERE id=? AND item_id=? LIMIT 1").bind(mediaId, itemId).first<Row>();
    if (!media) throw new Error("视频版本不存在");
    if (!comment) throw new Error("请填写画面修改意见");
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) throw new Error("视频时间点无效");
    const screenshot = form.get("screenshot");
    if (screenshot instanceof File && screenshot.size > 0) {
      if (screenshot.size > 3 * 1024 * 1024) throw new Error("画面截图过大");
      screenshotKey = `creative-workbench/${itemId}/comments/${crypto.randomUUID()}.jpg`;
      await env.MEDIA.put(screenshotKey, screenshot.stream(), { httpMetadata: { contentType: "image/jpeg" } });
    }
    const id = uid("CVC");
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO creative_video_comments
      (id,item_id,media_id,version,time_seconds,comment,screenshot_key,author_id,author_name,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,'open',?)`).bind(
        id, itemId, mediaId, Number(media.version), timeSeconds, comment, screenshotKey, user.id, user.name, now,
      ).run();
    const row = await env.DB.prepare("SELECT * FROM creative_video_comments WHERE id=?").bind(id).first<Row>();
    return Response.json({ comment: mapComment(row!) }, { status: 201 });
  } catch (error) {
    if (screenshotKey) await env.MEDIA.delete(screenshotKey).catch(() => undefined);
    return Response.json({ error: error instanceof Error ? error.message : "保存画面意见失败" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureWorkflowSchema();
    const user = await getCurrentUser(request);
    const payload = await request.json() as Record<string, unknown>;
    const id = String(payload.id ?? "");
    const row = await env.DB.prepare("SELECT * FROM creative_video_comments WHERE id=? LIMIT 1").bind(id).first<Row>();
    if (!row) return Response.json({ error: "画面意见不存在" }, { status: 404 });
    await assertParticipant(String(row.item_id), user);
    const status = payload.status === "resolved" ? "resolved" : "open";
    await env.DB.prepare("UPDATE creative_video_comments SET status=?, resolved_at=? WHERE id=?").bind(status, status === "resolved" ? new Date().toISOString() : "", id).run();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "更新画面意见失败" }, { status: 400 });
  }
}
