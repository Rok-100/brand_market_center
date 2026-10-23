import { getCurrentUser } from "../../../lib/current-user";

export async function GET(request: Request) {
  try {
    return Response.json({ user: await getCurrentUser(request) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "登录身份读取失败" }, { status: 401 });
  }
}
