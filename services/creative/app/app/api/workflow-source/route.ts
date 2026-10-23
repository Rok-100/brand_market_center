import { env } from "cloudflare:workers";
import { getCurrentUser, isManager } from "../../../lib/current-user";
import { workflowSource } from "../../../lib/flow-workflow-source.mjs";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    return workflowSource({ request, db: env.DB, user, canManage: isManager(user) });
  } catch {
    return Response.json({ detail: "请重新核对来源系统登录身份" }, { status: 401 });
  }
}
