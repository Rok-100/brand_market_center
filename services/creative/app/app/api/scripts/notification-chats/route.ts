import { env } from "cloudflare:workers";
import { getCurrentUser } from "../../../../lib/current-user";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    const rows = await env.DB.prepare("SELECT chat_id FROM script_notification_chats WHERE user_id=? ORDER BY updated_at DESC")
      .bind(user.id).all<{chat_id: string}>();
    return Response.json({chatIds: (rows.results ?? []).map(row => row.chat_id)}, {headers: {"Cache-Control": "no-store"}});
  } catch (error) {
    return Response.json({error: error instanceof Error ? error.message : "群聊选项读取失败"}, {status: 500});
  }
}
