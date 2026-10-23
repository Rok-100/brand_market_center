import { env } from "cloudflare:workers";
import { ensureWorkflowSchema } from "../../../lib/workflow-schema";

export async function GET() {
  try {
    await ensureWorkflowSchema();
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS creative_videos (id text PRIMARY KEY NOT NULL, script_id text NOT NULL, title text NOT NULL, url text DEFAULT '' NOT NULL, duration text DEFAULT '--:--' NOT NULL, cover_tone text DEFAULT 'forest' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS competitor_scripts (id text PRIMARY KEY NOT NULL, title text NOT NULL, brand text DEFAULT '待补充' NOT NULL, product text DEFAULT '待补充' NOT NULL, script_type text DEFAULT '自产脚本' NOT NULL, copy text NOT NULL, source text DEFAULT '批量导入' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS creator_collaborations (
      id text PRIMARY KEY NOT NULL, creator_name text NOT NULL, platform text NOT NULL,
      product text NOT NULL, owner text NOT NULL, stage text DEFAULT '待建联' NOT NULL,
      due_date text DEFAULT '' NOT NULL, note text DEFAULT '' NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    ]);
    const [cases, videos, competitors, drafts, collaborations] = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) AS total FROM creative_scripts"),
      env.DB.prepare("SELECT COUNT(*) AS total FROM creative_videos"),
      env.DB.prepare("SELECT COUNT(*) AS total FROM competitor_scripts"),
      env.DB.prepare("SELECT status, COUNT(*) AS total FROM creative_drafts GROUP BY status"),
      env.DB.prepare("SELECT stage, COUNT(*) AS total FROM creator_collaborations GROUP BY stage"),
    ]);
    const draftRows = (drafts.results ?? []) as Array<{ status: string; total: number }>;
    const collaborationRows = (collaborations.results ?? []) as Array<{ stage: string; total: number }>;
    return Response.json({
      cases: Number((cases.results[0] as { total?: number })?.total ?? 0),
      videos: Number((videos.results[0] as { total?: number })?.total ?? 0),
      competitors: Number((competitors.results[0] as { total?: number })?.total ?? 0),
      pendingReview: draftRows.filter((row) => ["pending_review", "pending_team_lead", "pending_supervisor", "returned_to_creator"].includes(row.status)).reduce((sum, row) => sum + Number(row.total), 0),
      approved: Number(draftRows.find((row) => row.status === "approved")?.total ?? 0),
      collaborations: collaborationRows.reduce((sum, row) => sum + Number(row.total), 0),
      collaborationStages: collaborationRows,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "数据总览读取失败" }, { status: 500 });
  }
}
