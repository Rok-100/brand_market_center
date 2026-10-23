import { env } from "cloudflare:workers";
import { getCurrentUser, listWorkspaceUsers } from "../../../lib/current-user";
import { ensureWorkflowSchema, uid } from "../../../lib/workflow-schema";

const STAR_TYPES = ["长期品牌向明星", "信息流明星", "AI授权明星"];
const PRODUCTS = ["眼膜", "水润面膜", "水油/蛋白喷雾", "美白针", "黄金面膜", "黑晶面膜", "燕窝面膜", "次抛精华", "品牌合作"];
const DECISIONS = ["推进", "观察", "暂缓", "不合作"];

export async function POST(request: Request) {
  try {
    await ensureWorkflowSchema();
    const currentUser = await getCurrentUser(request);
    const payload = await request.json() as Record<string, unknown>;
    const artistName = String(payload.artistName ?? "").trim();
    const product = String(payload.product ?? "").trim();
    const projectType = String(payload.projectType ?? "").trim();
    const projectPeriod = String(payload.projectPeriod ?? "").trim();
    const ownerId = String(payload.ownerId ?? currentUser.id).trim();
    const decision = String(payload.decision ?? "推进").trim();
    if (artistName.length < 2) return Response.json({ error: "请填写明星姓名" }, { status: 400 });
    if (!PRODUCTS.includes(product)) return Response.json({ error: "请选择合作单品" }, { status: 400 });
    if (!STAR_TYPES.includes(projectType)) return Response.json({ error: "请选择明星类型" }, { status: 400 });
    if (!/^\d{4}-\d{2}$/.test(projectPeriod)) return Response.json({ error: "请选择合作时间" }, { status: 400 });
    if (!DECISIONS.includes(decision)) return Response.json({ error: "请选择合作结论" }, { status: 400 });
    const users = await listWorkspaceUsers();
    const owner = users.find((entry) => entry.id === ownerId) ?? currentUser;
    const now = new Date().toISOString();
    const phase = decision === "推进" ? "明星评估" : decision === "观察" ? "明星评估" : decision;
    await env.DB.prepare(`INSERT INTO creative_artist_projects
      (id, artist_name, product, project_type, project_period, phase, owner_id, owner, creator_id, creator_name,
       actual_fee, rights_scope, rights_start_date, rights_end_date, rights_file_url, value_judgement, decision,
       decision_by, decision_at, shoot_date, final_date, launch_date, first_creation_plan, next_milestone, eta,
       risk, script_summary, production_summary, launch_summary, prep_summary, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', '', '', ?)`)
      .bind(
        uid("STAR"), artistName, product, projectType, projectPeriod, phase, owner.id, owner.name, owner.id, owner.name,
        String(payload.actualFee ?? "").trim(), String(payload.rightsScope ?? "").trim(), String(payload.rightsStartDate ?? "").trim(),
        String(payload.rightsEndDate ?? "").trim(), String(payload.rightsFileUrl ?? "").trim(), String(payload.valueJudgement ?? "").trim(),
        decision, currentUser.name, now, String(payload.shootDate ?? "").trim(), String(payload.finalDate ?? "").trim(),
        String(payload.launchDate ?? "").trim(), String(payload.firstCreationPlan ?? "").trim(),
        String(payload.nextMilestone ?? "完成合作信息确认").trim(), String(payload.eta ?? "").trim(), now,
      ).run();
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "明星合作项目创建失败" }, { status: 500 });
  }
}
