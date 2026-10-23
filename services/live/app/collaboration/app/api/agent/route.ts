import { callMcpTool } from "../_lib/mcp";

export const runtime = "edge";

// This service is normally behind the authenticated main proxy. Validate the
// same OA authority here as well, so direct requests cannot bypass its boundary.
async function requireLiveRoomAccess(request: Request): Promise<Response | null> {
  const headers = new Headers({ Accept: "application/json" });
  const cookie = request.headers.get("cookie");
  const oaToken = request.headers.get("x-oa-token");
  if (!cookie && !oaToken) return Response.json({ error: "请先从 WIS 品牌营销中枢登录。" }, { status: 401 });
  if (cookie) headers.set("Cookie", cookie);
  if (oaToken) headers.set("X-OA-Token", oaToken);
  const bases = [...new Set([
    process.env.CENTRAL_AUTHORITY_BASE || "https://app.fandow.top/fd-026222/wis-central-auth/api",
    process.env.CENTRAL_AUTHORITY_FALLBACK_BASE || "https://app.fandow.top/fd-026222/wis-video-center/api",
  ].filter(Boolean).map(base => base.replace(/\/+$/u, "")))];
  for (const base of bases) {
    let response: Response;
    try {
      response = await fetch(`${base}/central-auth/me`, { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    } catch { continue; }
    if (response.status >= 500) continue;
    if (response.status === 401 || (response.status >= 300 && response.status < 400)) {
      return Response.json({ error: "统一登录状态已失效。" }, { status: 401 });
    }
    if (response.status === 403) return Response.json({ error: "当前账号未开通中枢登录权限。" }, { status: 403 });
    if (response.status !== 200) break;
    const payload = await response.json().catch(() => ({})) as { access?: { allowed_modules?: string[] } };
    if (!payload.access?.allowed_modules?.includes("live-room-management")) {
      return Response.json({ error: "当前账号未开通直播间管理权限。" }, { status: 403 });
    }
    return null;
  }
  return Response.json({ error: "统一权限服务暂时不可用，请稍后刷新。" }, { status: 503 });
}

const allowedSql = `WITH latest_hour AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY advertiser_id, live_session_id, stat_time_start
    ORDER BY observed_at DESC, id DESC
  ) AS rn
  FROM d_root_project_marketing_db.qianchuan_live_room_timeslot_sales_detail
  WHERE report_date = :report_date
    AND (advertiser_name LIKE '%WIS%' OR live_room_name LIKE '%WIS%')
)
SELECT live_session_id, live_room_name,
       SUM(total_pay_order_gmv_yuan) AS gmv_yuan,
       SUM(total_cost_yuan) AS cost_yuan,
       SUM(total_pay_order_gmv_yuan) / NULLIF(SUM(total_cost_yuan),0) AS roi
FROM latest_hour WHERE rn = 1
GROUP BY live_session_id, live_room_name;`;

export async function POST(request: Request) {
  const denied = await requireLiveRoomAccess(request);
  if (denied) return denied;
  if (process.env.RECOVERY_READ_ONLY === "1") {
    return Response.json({ ok: false, code: "recovery_read_only", error: "维护恢复中，AI 分析生成已暂停；可继续查看已授权的只读数据。" }, { status: 423 });
  }
  const body = (await request.json()) as { prompt?: string };
  const prompt = body.prompt?.trim() || "分析 WIS 直播表现";
  const keyword = /峰|谷|时段/.test(prompt) ? "成交波峰时段" : /流量|短视频|推荐/.test(prompt) ? "流量渠道占比" : "直播场次 ROI";
  try {
    const dictionary = await callMcpTool("search_data_dictionary", { keyword, limit: 3 });
    return Response.json({
      prompt,
      sql: allowedSql,
      safeguards: ["仅允许 SELECT 查询", "按最新小时快照去重", "金额单位为元", "WIS 按账户/直播间名称匹配"],
      dictionary,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "分析服务暂不可用" }, { status: 503 });
  }
}
