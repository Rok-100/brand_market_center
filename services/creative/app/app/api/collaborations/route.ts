import { desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { creatorCollaborations } from "../../../db/schema";
import { CALENDAR_STAGES, validDate, safeCalendarUrl } from "../../../lib/calendar";

const MATERIAL_TYPES = ["付费KOC原片", "唠嗑KOC原片", "唠嗑KOC AI", "明星原片", "混剪素材", "其他素材"];
async function ensureSchema() {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS creator_collaborations (id TEXT PRIMARY KEY NOT NULL, sequence INTEGER NOT NULL DEFAULT 1, creator_name TEXT NOT NULL, platform TEXT NOT NULL DEFAULT '抖音', material_type TEXT NOT NULL DEFAULT '付费KOC原片', product TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '待分配', stage TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '', shooting_date TEXT NOT NULL DEFAULT '', launch_date TEXT NOT NULL DEFAULT '', abnormal_stage TEXT NOT NULL DEFAULT '', abnormal_note TEXT NOT NULL DEFAULT '', asset_link TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS creator_collaborations_stage_idx ON creator_collaborations (stage)"),
  ]);
  const columns = (await env.DB.prepare("PRAGMA table_info(creator_collaborations)").all<{ name: string }>()).results ?? [];
  const present = new Set(columns.map((column) => column.name));
  const additions = [
    ...["finished_date", "actual_shooting_date", "actual_finished_date", "actual_launch_date", "script_link", "source"].map((name) => [name, "TEXT NOT NULL DEFAULT ''"]), ["linked_item_ids", "TEXT NOT NULL DEFAULT '[]'"],
    ["sequence", "INTEGER NOT NULL DEFAULT 1"], ["material_type", "TEXT NOT NULL DEFAULT '付费KOC原片'"], ["owner_id", "TEXT NOT NULL DEFAULT ''"],
    ["shooting_date", "TEXT NOT NULL DEFAULT ''"], ["launch_date", "TEXT NOT NULL DEFAULT ''"],
    ["abnormal_stage", "TEXT NOT NULL DEFAULT ''"], ["abnormal_note", "TEXT NOT NULL DEFAULT ''"], ["asset_link", "TEXT NOT NULL DEFAULT ''"], ["created_at", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, definition] of additions) if (!present.has(name)) await env.DB.prepare(`ALTER TABLE creator_collaborations ADD COLUMN ${name} ${definition}`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS creator_collaborations_launch_idx ON creator_collaborations (launch_date, owner_id)").run();
}


type Row = typeof creatorCollaborations.$inferSelect;
type Input = Partial<Row>;
const textFields = ["creatorName", "platform", "materialType", "product", "ownerId", "owner", "stage", "shootingDate", "finishedDate", "launchDate", "actualShootingDate", "actualFinishedDate", "actualLaunchDate", "scriptLink", "assetLink", "linkedItemIds", "source", "abnormalStage", "abnormalNote", "note"] as const;
const dateFields = ["shootingDate", "finishedDate", "launchDate", "actualShootingDate", "actualFinishedDate", "actualLaunchDate"] as const;
function normalize(input: Input, previous?: Row): Row {
  const now = new Date().toISOString();
  const row = { id: input.id || `MAT-${crypto.randomUUID()}`, sequence: input.sequence || 1, creatorName: "", platform: "抖音", materialType: "付费KOC原片", product: "", ownerId: "", owner: "待分配", stage: "待拍摄", shootingDate: "", finishedDate: "", launchDate: "", actualShootingDate: "", actualFinishedDate: "", actualLaunchDate: "", scriptLink: "", assetLink: "", linkedItemIds: "[]", source: "", abnormalStage: "", abnormalNote: "", note: "", dueDate: "", createdAt: now, ...previous, updatedAt: now } as Row;
  for (const key of textFields) if (input[key] !== undefined) {
    if (typeof input[key] !== "string") throw new Error(`字段 ${key} 格式错误`);
    row[key] = input[key]!.trim();
  }
  if (!row.creatorName || !row.product) throw new Error("达人名称和单品不能为空");
  // Old unverified stage values are retained until a colleague explicitly confirms a new status.
  if (input.stage !== undefined && !CALENDAR_STAGES.includes(row.stage)) throw new Error("请选择待拍摄、已拍摄、待发布或已发布");
  if (!MATERIAL_TYPES.includes(row.materialType)) throw new Error("素材类型无效");
  for (const key of dateFields) if (!validDate(row[key])) throw new Error("日期无效，请填写真实的 YYYY-MM-DD 日期");
  if (!row.shootingDate && !row.finishedDate && !row.launchDate) throw new Error("拍摄、成片、发布日期至少填写一项");
  for (const key of ["assetLink", "scriptLink"] as const) if (row[key] && !safeCalendarUrl(row[key])) throw new Error("链接必须以 http:// 或 https:// 开头");
  const ids = JSON.parse(row.linkedItemIds);
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string") || ids.length > 100) throw new Error("关联素材格式无效");
  row.linkedItemIds = JSON.stringify([...new Set(ids)]);
  if (row.abnormalStage && !["拍摄", "成片", "上线"].includes(row.abnormalStage)) throw new Error("异常环节无效");
  if (row.abnormalStage && !row.abnormalNote) throw new Error("请填写异常说明");
  row.dueDate = row.launchDate || row.finishedDate || row.shootingDate;
  return row;
}

export async function GET(request: Request) {
  await ensureSchema();
  const month = new URL(request.url).searchParams.get("month") || "";
  const all = await getDb().select().from(creatorCollaborations).orderBy(desc(creatorCollaborations.updatedAt));
  return Response.json({ isDemo: false, items: month ? all.filter((r) => [r.shootingDate, r.finishedDate, r.launchDate].some((date) => date.startsWith(month))) : all });
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const payload = await request.json() as Input & { items?: Input[]; preview?: boolean; upsert?: boolean };
    const inputs = payload.items ?? [payload];
    if (!inputs.length || inputs.length > 200) return Response.json({ error: "每次可导入 1—200 条" }, { status: 400 });
    const existing = await getDb().select().from(creatorCollaborations);
    const seen = new Set<string>();
    const plan = inputs.map((input, index) => {
      try {
        const previous = input.id ? existing.find((r) => r.id === input.id) : undefined;
        if (input.id && !previous) throw new Error("素材编号不存在，请核对；新增素材请留空编号");
        if (previous && !payload.upsert) throw new Error("已有记录请使用更新模式");
        // Never silently match two deliveries by creator name alone.
        const similar = !input.id ? existing.filter((r) => r.creatorName === input.creatorName?.trim() && r.product === input.product?.trim() && r.materialType === input.materialType && r.shootingDate === (input.shootingDate || "")) : [];
        if (similar.length) throw new Error("存在相似记录，请填写原素材编号更新，避免重复导入");
        const row = normalize(input, previous);
        const key = previous?.id || [row.creatorName, row.product, row.materialType, row.shootingDate, row.launchDate].join("|");
        if (seen.has(key)) throw new Error("本批次记录重复");
        seen.add(key);
        return { line: index + 1, action: previous ? "更新" : "新增", row, error: "" };
      } catch (error) { return { line: index + 1, action: "冲突", error: error instanceof Error ? error.message : "格式错误" }; }
    });
    if (payload.preview) return Response.json({ plan });
    if (plan.some((p) => p.error)) return Response.json({ error: "存在冲突，请先预览并修正", plan }, { status: 409 });
    // One atomic D1 batch; each statement stays below SQLite parameter limits.
    const statements = plan.map((p) => {
      const row = p.row!;
      const fields = Object.entries(creatorCollaborations).filter(([key]) => Object.hasOwn(row, key));
      const columns = fields.map(([, column]) => (column as { name: string }).name);
      const values = fields.map(([key]) => row[key as keyof Row]);
      const updates = columns.filter((c) => c !== "id" && c !== "created_at").map((c) => `${c}=excluded.${c}`).join(",");
      return env.DB.prepare(`INSERT INTO creator_collaborations (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${updates}`).bind(...values);
    });
    await env.DB.batch(statements);
    return Response.json({ items: plan.map((p) => p.row), count: plan.length }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 }); }
}
export async function PATCH(request: Request) {
  try {
    await ensureSchema();
    const input = await request.json() as Input;
    if (!input.id) return Response.json({ error: "缺少素材编号" }, { status: 400 });
    const [previous] = await getDb().select().from(creatorCollaborations).where(eq(creatorCollaborations.id, input.id));
    if (!previous) return Response.json({ error: "素材不存在" }, { status: 404 });
    const row = normalize(input, previous);
    await getDb().update(creatorCollaborations).set(row).where(eq(creatorCollaborations.id, input.id));
    return Response.json({ item: row });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "更新失败" }, { status: 400 }); }
}
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "缺少合作任务 ID" }, { status: 400 });
  await ensureSchema();
  await getDb().delete(creatorCollaborations).where(eq(creatorCollaborations.id, id));
  return Response.json({ ok: true });
}
