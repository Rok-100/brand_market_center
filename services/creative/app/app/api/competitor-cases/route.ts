import { desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { competitorScripts } from "../../../db/schema";

const SCRIPT_TYPES = ["付费KOC脚本", "唠嗑KOC脚本", "明星脚本", "AI脚本", "自产脚本", "混剪脚本", "剧情脚本"];
const BRANDS = ["C咖", "谷雨", "韩束", "奕沃/EIIO", "达尔肤", "敷尔佳", "达肤妍", "丸美", "可逐/kazoo", "造物者", "RNW", "ELL", "原生密码", "百雀羚", "自然堂"];

async function ensureSchema() {
  const d1 = env.DB;
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS competitor_scripts (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '待补充',
      product TEXT NOT NULL DEFAULT '待补充',
      script_type TEXT NOT NULL DEFAULT '自产脚本',
      copy TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '批量导入',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS competitor_scripts_created_idx ON competitor_scripts (created_at)"),
  ]);
  const columns = await d1.prepare("PRAGMA table_info(competitor_scripts)").all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "script_type")) {
    await d1.prepare("ALTER TABLE competitor_scripts ADD COLUMN script_type TEXT NOT NULL DEFAULT '自产脚本'").run();
  }
}

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const db = getDb();
    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(20, Number(url.searchParams.get("limit")) || 100));
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    const rows = await db.select().from(competitorScripts).orderBy(desc(competitorScripts.createdAt)).limit(limit + 1).offset(offset);
    const hasMore = rows.length > limit;
    const scripts = rows.slice(0, limit);
    return Response.json({ scripts, hasMore, nextOffset: offset + scripts.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "竞对案例库读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      items?: Array<{ title?: string; brand?: string; scriptType?: string; copy?: string }>;
    };
    const items = (payload.items ?? []).slice(0, 100).map((item) => ({
      title: item.title?.trim() || "未命名竞对脚本",
      brand: item.brand?.trim() || "待补充",
      product: item.brand?.trim() || "待补充",
      scriptType: item.scriptType?.trim() || "自产脚本",
      copy: item.copy?.trim() || "",
    })).filter((item) => item.copy.length >= 8 && BRANDS.includes(item.brand) && SCRIPT_TYPES.includes(item.scriptType));

    if (!items.length) return Response.json({ error: "请至少确认一条完整竞对脚本" }, { status: 400 });

    await ensureSchema();
    const db = getDb();
    const records = items.map((item) => ({
      id: `CP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      ...item,
      source: "批量导入",
    }));
    await db.insert(competitorScripts).values(records);
    return Response.json({ scripts: records }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "批量导入失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "缺少竞对案例 ID" }, { status: 400 });
  await ensureSchema();
  await getDb().delete(competitorScripts).where(eq(competitorScripts.id, id));
  return Response.json({ ok: true });
}
