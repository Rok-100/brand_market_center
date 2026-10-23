import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { creativeScripts } from "../../../../../db/schema";
import { getCurrentUser } from "../../../../../lib/current-user";
import { makeScriptDocx } from "../../../../../lib/docx-export";
import { ensureWorkflowSchema } from "../../../../../lib/workflow-schema";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureWorkflowSchema();
    await getCurrentUser(request);
    const { id } = await context.params;
    const [script] = await getDb().select().from(creativeScripts).where(eq(creativeScripts.id, id)).limit(1);
    if (!script) return Response.json({ error: "未找到案例" }, { status: 404 });
    const file = makeScriptDocx(script);
    const safeName = script.title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 60) || "脚本";
    return new Response(file as BodyInit, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.docx` } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "导出失败" }, { status: 500 });
  }
}
