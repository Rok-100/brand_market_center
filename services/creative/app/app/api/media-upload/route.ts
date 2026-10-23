import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { creativeVideos } from "../../../db/schema";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const scriptId = String(form.get("scriptId") ?? "").trim();
    if (!(file instanceof File) || !scriptId) return Response.json({ error: "请选择视频并关联案例" }, { status: 400 });
    if (!["video/mp4", "video/quicktime"].includes(file.type)) return Response.json({ error: "仅支持 MP4 或 MOV 视频" }, { status: 400 });
    if (file.size > 200 * 1024 * 1024) return Response.json({ error: "视频不能超过 200MB" }, { status: 400 });
    const extension = file.type === "video/quicktime" ? "mov" : "mp4";
    const key = `${scriptId}-${crypto.randomUUID()}.${extension}`;
    await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { originalName: file.name, scriptId } });
    const video = { id: `CV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, scriptId, title: file.name.replace(/\.[^.]+$/, ""), url: `/api/media/${encodeURIComponent(key)}`, duration: "待解析", coverTone: "forest" };
    await getDb().insert(creativeVideos).values(video);
    return Response.json({ video }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "视频上传失败" }, { status: 500 });
  }
}
