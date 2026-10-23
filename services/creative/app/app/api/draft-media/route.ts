import { env } from "cloudflare:workers";
import { getCurrentUser } from "../../../lib/current-user";
import { ensureWorkflowSchema } from "../../../lib/workflow-schema";

export async function POST(request: Request) {
  try {
    await ensureWorkflowSchema();
    const user = await getCurrentUser(request);
    const form = await request.formData();
    const file = form.get("file");
    const draftId = String(form.get("draftId") ?? "").trim();
    if (!(file instanceof File) || !draftId) return Response.json({ error: "请选择视频并关联脚本" }, { status: 400 });
    if (!["video/mp4", "video/quicktime"].includes(file.type)) return Response.json({ error: "仅支持 MP4 或 MOV 视频" }, { status: 400 });
    if (file.size > 200 * 1024 * 1024) return Response.json({ error: "单个视频不能超过 200MB" }, { status: 400 });
    const draft = await env.DB.prepare("SELECT id, creator_id, uploader_id, video_links FROM creative_drafts WHERE id = ? LIMIT 1").bind(draftId).first<Record<string, unknown>>();
    if (!draft) return Response.json({ error: "未找到关联脚本" }, { status: 404 });
    if (![String(draft.creator_id), String(draft.uploader_id)].includes(user.id) && user.role !== "admin") return Response.json({ error: "你没有上传该脚本视频的权限" }, { status: 403 });
    const extension = file.type === "video/quicktime" ? "mov" : "mp4";
    const key = `drafts/${draftId}-${crypto.randomUUID()}.${extension}`;
    await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { originalName: file.name, draftId } });
    let links: string[] = [];
    try { links = JSON.parse(String(draft.video_links ?? "[]")); } catch { links = []; }
    const url = `/api/media/${encodeURIComponent(key)}`;
    links.push(url);
    await env.DB.prepare("UPDATE creative_drafts SET video_links = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(links), new Date().toISOString(), draftId).run();
    return Response.json({ url, title: file.name.replace(/\.[^.]+$/, "") }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "视频上传失败" }, { status: 500 });
  }
}
