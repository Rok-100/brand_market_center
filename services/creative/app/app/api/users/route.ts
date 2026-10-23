import { env } from "cloudflare:workers";
import { getCurrentUser, isManager, listWorkspaceUsers } from "../../../lib/current-user";

const ROLES = ["contributor", "team_lead", "supervisor", "director", "admin"];

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    return Response.json({ currentUser, users: await listWorkspaceUsers() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "成员读取失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!isManager(currentUser)) return Response.json({ error: "只有管理角色可以维护团队成员" }, { status: 403 });
    const payload = await request.json() as { userId?: string; role?: string };
    const userId = payload.userId?.trim() ?? "";
    const role = payload.role?.trim() ?? "contributor";
    if (!userId) return Response.json({ error: "请选择已登录的同事" }, { status: 400 });
    if (!ROLES.includes(role)) return Response.json({ error: "请选择有效角色" }, { status: 400 });
    if (role === "admin" && currentUser.role !== "admin") return Response.json({ error: "只有管理员可以授予管理员角色" }, { status: 403 });
    const target = await env.DB.prepare("SELECT * FROM workspace_users WHERE id = ? AND active = 1 AND login_registered = 1 LIMIT 1").bind(userId).first<Record<string, unknown>>();
    if (!target) return Response.json({ error: "该同事尚未通过 OA 登录工作台" }, { status: 404 });
    await env.DB.prepare("UPDATE workspace_users SET role = ? WHERE id = ? AND login_registered = 1").bind(role, userId).run();
    const users = await listWorkspaceUsers();
    return Response.json({ user: users.find((item) => item.id === userId), users });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "成员保存失败" }, { status: 500 });
  }
}
