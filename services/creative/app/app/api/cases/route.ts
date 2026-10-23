import { desc, eq, inArray } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { creativeScripts, creativeVideos } from "../../../db/schema";
import { getCurrentUser, isManager } from "../../../lib/current-user";
import { ensureWorkflowSchema } from "../../../lib/workflow-schema";

const SCRIPT_TYPES = ["付费KOC脚本", "唠嗑KOC脚本", "明星脚本", "AI脚本", "自产脚本", "混剪脚本", "剧情脚本"];
const PRODUCTS = ["眼膜", "水润面膜", "水油/蛋白喷雾", "美白针", "黄金面膜", "微针面膜", "燕窝面膜", "次抛精华"];

async function ensureSchema() {
  await ensureWorkflowSchema();
  const d1 = env.DB;
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS creative_videos (
      id TEXT PRIMARY KEY NOT NULL,
      script_id TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      duration TEXT NOT NULL DEFAULT '--:--',
      cover_tone TEXT NOT NULL DEFAULT 'forest',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (script_id) REFERENCES creative_scripts(id) ON DELETE CASCADE
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS creative_scripts_type_idx ON creative_scripts (script_type)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS creative_scripts_product_idx ON creative_scripts (product)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS creative_videos_script_idx ON creative_videos (script_id)"),
  ]);
}

export async function GET() {
  try {
    await ensureSchema();
    const db = getDb();
    const scripts = await db.select().from(creativeScripts).orderBy(desc(creativeScripts.createdAt)).limit(200);
    const ids = scripts.map((item) => item.id);
    const videos = ids.length
      ? await db.select().from(creativeVideos).where(inArray(creativeVideos.scriptId, ids))
      : [];
    return Response.json({
      cases: scripts.map((script) => ({
        ...script,
        videos: videos.filter((video) => video.scriptId === script.id),
      })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "案例库读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      scriptType?: string;
      product?: string;
      copy?: string;
      videoUrls?: string[];
      authorType?: string;
      authorName?: string;
      authorUserId?: string;
      source?: string;
    };
    const user = await getCurrentUser(request);
    const scriptType = payload.scriptType?.trim() ?? "";
    const product = payload.product?.trim() ?? "";
    const copy = payload.copy?.trim() ?? "";
    const videoUrls = (payload.videoUrls ?? []).filter((url) => /^https?:\/\//i.test(url)).slice(0, 8);

    if (!SCRIPT_TYPES.includes(scriptType)) return Response.json({ error: "请选择有效的脚本类型" }, { status: 400 });
    if (!PRODUCTS.includes(product)) return Response.json({ error: "请选择有效的单品" }, { status: 400 });
    if (copy.length < 8) return Response.json({ error: "脚本文案至少需要 8 个字" }, { status: 400 });

    await ensureSchema();
    const db = getDb();
    const id = `CS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const title = copy.split(/[。！？\n]/).find(Boolean)?.slice(0, 24) || "新导入脚本";
    const authorType = payload.authorType?.trim() || "内部同事";
    const authorName = payload.authorName?.trim() || user.name;
    const authorUserId = payload.authorUserId?.trim() || (authorName === user.name ? user.id : "");
    const script = { id, scriptType, product, title, copy, status: "待验证", source: payload.source?.trim() || "文字导入", authorType, authorName, authorUserId, uploaderId: user.id, uploaderName: user.name };
    await db.insert(creativeScripts).values(script);

    const videos = videoUrls.map((url, index) => ({
      id: `CV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      scriptId: id,
      title: `关联视频 ${index + 1}`,
      url,
      duration: "待解析",
      coverTone: ["forest", "amber", "blue", "rose"][index % 4],
    }));
    if (videos.length) await db.insert(creativeVideos).values(videos);

    return Response.json({ case: { ...script, videos } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "导入失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser(request);
    const payload = (await request.json()) as { id?: string; scriptType?: string; product?: string; title?: string; copy?: string; status?: string; videoUrls?: string[]; authorType?: string; authorName?: string; authorUserId?: string };
    if (!payload.id) return Response.json({ error: "缺少案例 ID" }, { status: 400 });
    if (!SCRIPT_TYPES.includes(payload.scriptType ?? "")) return Response.json({ error: "请选择有效的脚本类型" }, { status: 400 });
    if (!PRODUCTS.includes(payload.product ?? "")) return Response.json({ error: "请选择有效的单品" }, { status: 400 });
    if ((payload.copy?.trim().length ?? 0) < 8) return Response.json({ error: "脚本文案至少需要 8 个字" }, { status: 400 });
    await ensureSchema();
    const db = getDb();
    const [existingScript] = await db.select().from(creativeScripts).where(eq(creativeScripts.id, payload.id)).limit(1);
    if (!existingScript) return Response.json({ error: "未找到可修改的案例" }, { status: 404 });
    if (!isManager(user) && existingScript.uploaderId && existingScript.uploaderId !== user.id && existingScript.authorUserId !== user.id) return Response.json({ error: "只有上传人、作者或管理角色可以修改" }, { status: 403 });
    const updateResult = await db.update(creativeScripts).set({ scriptType: payload.scriptType!, product: payload.product!, title: payload.title?.trim() || "未命名案例", copy: payload.copy!.trim(), status: payload.status?.trim() || "待验证", authorType: payload.authorType?.trim() || existingScript.authorType, authorName: payload.authorName?.trim() || existingScript.authorName, authorUserId: payload.authorUserId?.trim() ?? existingScript.authorUserId }).where(eq(creativeScripts.id, payload.id));
    const updatedRows = Number((updateResult.meta as { changes?: number } | undefined)?.changes ?? 0);
    if (!updatedRows) return Response.json({ error: "未找到可修改的案例" }, { status: 404 });
    const links = (payload.videoUrls ?? []).filter((url) => /^https?:\/\//i.test(url)).slice(0, 8);
    const existing = await db.select().from(creativeVideos).where(eq(creativeVideos.scriptId, payload.id));
    const existingUrls = new Set(existing.map((video) => video.url));
    const additions = links.filter((url) => !existingUrls.has(url)).map((url, index) => ({ id: `CV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, scriptId: payload.id!, title: `关联视频 ${existing.length + index + 1}`, url, duration: "待解析", coverTone: ["forest", "amber", "blue", "rose"][index % 4] }));
    if (additions.length) await db.insert(creativeVideos).values(additions);
    const [script] = await db.select().from(creativeScripts).where(eq(creativeScripts.id, payload.id)).limit(1);
    const videos = await db.select().from(creativeVideos).where(eq(creativeVideos.scriptId, payload.id));
    if (!script) return Response.json({ error: "案例更新后读取失败" }, { status: 500 });
    return Response.json({ case: { ...script, videos } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "案例更新失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "缺少案例 ID" }, { status: 400 });
    await ensureSchema();
    const user = await getCurrentUser(request);
    const db = getDb();
    const [script] = await db.select().from(creativeScripts).where(eq(creativeScripts.id, id)).limit(1);
    if (!script) return Response.json({ error: "未找到案例" }, { status: 404 });
    const ownsScript = [script.uploaderId, script.authorUserId].includes(user.id);
    if (!ownsScript && user.role !== "admin") return Response.json({ error: "只能删除自己的案例" }, { status: 403 });
    const videos = await db.select().from(creativeVideos).where(eq(creativeVideos.scriptId, id));
    const storedKeys = videos.map((video) => video.url.match(/^\/api\/media\/(.+)$/)?.[1]).filter((key): key is string => !!key).map(decodeURIComponent);
    if (storedKeys.length) await env.MEDIA.delete(storedKeys);
    await db.delete(creativeVideos).where(eq(creativeVideos.scriptId, id));
    await db.delete(creativeScripts).where(eq(creativeScripts.id, id));
    return Response.json({ ok: true, id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "案例删除失败" }, { status: 500 });
  }
}
