import { env } from "cloudflare:workers";
import { getCurrentUser, listWorkspaceUsers } from "../../../lib/current-user";
import { ensureWorkflowSchema, uid } from "../../../lib/workflow-schema";

type Row = Record<string, unknown>;
type WorkspaceActor = { id: string; name: string };
type UploadDescriptor = { originalName: string; mimeType: string; sizeBytes: number };
type CompletedUpload = UploadDescriptor & {
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
};

const SCRIPT_TYPES = ["付费KOC脚本", "唠嗑KOC脚本", "明星脚本", "AI脚本", "自产脚本", "混剪脚本", "剧情脚本"];
const PRODUCTS = ["眼膜", "水润面膜", "水油/蛋白喷雾", "美白针", "黄金面膜", "黑晶面膜", "燕窝面膜", "次抛精华"];
const ROLE_ORDER: Record<string, number> = { team_lead: 1, supervisor: 2, director: 3 };

function extensionForName(name: string, mimeType: string) {
  return /\.mov$/i.test(name) || mimeType === "video/quicktime" ? "mov" : "mp4";
}

function validateDescriptors(files: UploadDescriptor[]) {
  if (!files.length) throw new Error("请至少上传一个 MP4 或 MOV 视频");
  if (files.some((file) => !/\.(mp4|mov)$/i.test(file.originalName) && !["video/mp4", "video/quicktime"].includes(file.mimeType))) throw new Error("仅支持 MP4 或 MOV 视频");
  if (files.some((file) => !Number.isFinite(file.sizeBytes) || file.sizeBytes <= 0)) throw new Error("视频文件为空或大小无效");
}

function descriptors(value: unknown): UploadDescriptor[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const file = entry as Record<string, unknown>;
    return { originalName: String(file.originalName ?? ""), mimeType: String(file.mimeType ?? "video/mp4"), sizeBytes: Number(file.sizeBytes ?? 0) };
  });
}

async function normalizedReviewers(requested: Array<Record<string, unknown>>) {
  if (requested.length < 1) throw new Error("请至少选择一位审核人");
  const users = await listWorkspaceUsers();
  const normalized = requested.map((entry) => ({ reviewerId: String(entry.reviewerId ?? ""), role: String(entry.role ?? "") }))
    .filter((entry) => entry.reviewerId && ROLE_ORDER[entry.role])
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  if (normalized.length !== requested.length) throw new Error("审核人信息无效，请重新选择");
  if (new Set(normalized.map((entry) => entry.role)).size !== normalized.length) throw new Error("同一审核层级只能选择一位同事");
  if (new Set(normalized.map((entry) => entry.reviewerId)).size !== normalized.length) throw new Error("同一位同事不能重复出现在审核路径中");
  const result = normalized.map((entry) => ({ ...entry, person: users.find((person) => person.id === entry.reviewerId) }));
  if (result.some((entry) => !entry.person)) throw new Error("审核人信息无效，请重新选择");
  return { reviewers: result, users };
}

async function createContext(metadata: Record<string, unknown>, user: WorkspaceActor) {
  const materialName = String(metadata.materialName ?? "").trim();
  const scriptType = String(metadata.scriptType ?? "").trim();
  const product = String(metadata.product ?? "").trim();
  const authorId = String(metadata.authorId ?? user.id).trim();
  const cooperationType = String(metadata.cooperationType ?? "成片").trim();
  const artistName = String(metadata.artistName ?? "").trim();
  const projectName = String(metadata.projectName ?? "").trim();
  const priority = ["紧急", "普通", "低"].includes(String(metadata.priority)) ? String(metadata.priority) : "普通";
  const dueDate = String(metadata.dueDate ?? "").trim();
  const note = String(metadata.note ?? "").trim();
  if (materialName.length < 2) throw new Error("请填写视频素材名称");
  if (!SCRIPT_TYPES.includes(scriptType)) throw new Error("请选择视频对应的脚本类型");
  if (product && !PRODUCTS.includes(product)) throw new Error("请选择有效单品");
  const requested = Array.isArray(metadata.reviewers) ? metadata.reviewers as Array<Record<string, unknown>> : [];
  const { reviewers, users } = await normalizedReviewers(requested);
  const author = users.find((entry) => entry.id === authorId) ?? user;
  return { materialName, scriptType, product, cooperationType, artistName, projectName, priority, dueDate, note, reviewers, author };
}

async function revisionContext(itemId: string, user: WorkspaceActor) {
  const item = await env.DB.prepare("SELECT * FROM creative_work_items WHERE id=? LIMIT 1").bind(itemId).first<Row>();
  if (!item || String(item.content_type) !== "video") throw new Error("视频审核任务不存在");
  if (![String(item.submitter_id), String(item.author_id)].includes(user.id)) throw new Error("仅发起人或作者可以上传新版本");
  if (String(item.status) !== "returned") throw new Error("只有退回的视频可以上传新版本");
  const versionRow = await env.DB.prepare("SELECT COALESCE(MAX(version), 0) max_version FROM creative_work_media WHERE item_id=?").bind(itemId).first<Row>();
  return Number(versionRow?.max_version ?? 0) + 1;
}

async function beginMultipart(itemId: string, version: number, files: UploadDescriptor[], user: WorkspaceActor) {
  validateDescriptors(files);
  const sessions: Array<UploadDescriptor & { key: string; uploadId: string }> = [];
  try {
    for (const file of files) {
      const extension = extensionForName(file.originalName, file.mimeType);
      const key = `creative-workbench/${itemId}/v${version}/${crypto.randomUUID()}.${extension}`;
      const upload = await env.MEDIA.createMultipartUpload(key, {
        httpMetadata: { contentType: file.mimeType || (extension === "mov" ? "video/quicktime" : "video/mp4") },
        customMetadata: { originalName: file.originalName, itemId, version: String(version), uploaderId: user.id },
      });
      sessions.push({ ...file, key, uploadId: upload.uploadId });
    }
    return sessions;
  } catch (error) {
    for (const session of sessions) await env.MEDIA.resumeMultipartUpload(session.key, session.uploadId).abort().catch(() => undefined);
    throw error;
  }
}

async function finishObjects(itemId: string, version: number, uploads: CompletedUpload[]) {
  validateDescriptors(uploads);
  const prefix = `creative-workbench/${itemId}/v${version}/`;
  if (uploads.some((upload) => !upload.key.startsWith(prefix) || !upload.uploadId || !upload.parts.length)) throw new Error("分片上传信息无效，请重新选择视频");
  const completed: string[] = [];
  try {
    for (const upload of uploads) {
      const partNumbers = upload.parts.map((part) => part.partNumber);
      if (new Set(partNumbers).size !== partNumbers.length || partNumbers.some((part) => !Number.isInteger(part) || part < 1 || part > 10000)) throw new Error("视频分片顺序无效");
      await env.MEDIA.resumeMultipartUpload(upload.key, upload.uploadId).complete(upload.parts);
      completed.push(upload.key);
      const object = await env.MEDIA.head(upload.key);
      if (!object || object.size !== upload.sizeBytes) throw new Error(`${upload.originalName} 上传不完整，请重试`);
    }
    return completed;
  } catch (error) {
    for (const key of completed) await env.MEDIA.delete(key);
    for (const upload of uploads.filter((entry) => !completed.includes(entry.key))) await env.MEDIA.resumeMultipartUpload(upload.key, upload.uploadId).abort().catch(() => undefined);
    throw error;
  }
}

async function insertCreate(itemId: string, metadata: Record<string, unknown>, uploads: CompletedUpload[], user: WorkspaceActor) {
  const context = await createContext(metadata, user);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO creative_work_items
      (id, content_type, review_section, script_type, cooperation_type, material_name, author_id, author_name, product, feishu_url, artist_name, project_name, priority, due_date, note, submitter_id, submitter_name, status, current_step, created_at, updated_at)
      VALUES (?, 'video', '视频审核', ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, 'pending_review', 1, ?, ?)`).bind(
        itemId, context.scriptType, context.cooperationType, context.materialName, context.author.id, context.author.name, context.product,
        context.artistName, context.projectName, context.priority, context.dueDate, context.note, user.id, user.name, now, now,
      ),
    env.DB.prepare("INSERT INTO creative_work_events (id, item_id, actor_id, actor_name, action, comment, created_at) VALUES (?, ?, ?, ?, 'submit', ?, ?)")
      .bind(uid("CWE"), itemId, user.id, user.name, context.note || `提交 ${uploads.length} 个视频审核`, now),
    ...context.reviewers.map((entry, index) => env.DB.prepare(`INSERT INTO creative_work_reviewers
      (id, item_id, reviewer_id, reviewer_name, reviewer_role, step_order, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        uid("CWR"), itemId, entry.person!.id, entry.person!.name, entry.role, index + 1, index === 0 ? "active" : "waiting", now,
      )),
    ...uploads.map((entry) => env.DB.prepare(`INSERT INTO creative_work_media
      (id, item_id, version, storage_key, original_name, mime_type, size_bytes, uploader_id, uploader_name, created_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`).bind(
        uid("CWM"), itemId, entry.key, entry.originalName, entry.mimeType || "video/mp4", entry.sizeBytes, user.id, user.name, now,
      )),
  ]);
}

async function insertRevision(itemId: string, version: number, comment: string, uploads: CompletedUpload[], user: WorkspaceActor) {
  const now = new Date().toISOString();
  await env.DB.batch([
    ...uploads.map((entry) => env.DB.prepare(`INSERT INTO creative_work_media
      (id, item_id, version, storage_key, original_name, mime_type, size_bytes, uploader_id, uploader_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        uid("CWM"), itemId, version, entry.key, entry.originalName, entry.mimeType || "video/mp4", entry.sizeBytes, user.id, user.name, now,
      )),
    env.DB.prepare("UPDATE creative_work_reviewers SET status=CASE WHEN step_order=1 THEN 'active' ELSE 'waiting' END, comment='', decided_at='' WHERE item_id=?").bind(itemId),
    env.DB.prepare("UPDATE creative_work_items SET status='pending_review', current_step=1, updated_at=? WHERE id=?").bind(now, itemId),
    env.DB.prepare("INSERT INTO creative_work_events (id, item_id, actor_id, actor_name, action, comment, created_at) VALUES (?, ?, ?, ?, 'resubmit', ?, ?)")
      .bind(uid("CWE"), itemId, user.id, user.name, comment || `上传第 ${version} 版视频并重新提交`, now),
  ]);
}

export async function PUT(request: Request) {
  try {
    await ensureWorkflowSchema();
    await getCurrentUser(request);
    const url = new URL(request.url);
    const key = url.searchParams.get("key") ?? "";
    const uploadId = url.searchParams.get("uploadId") ?? "";
    const partNumber = Number(url.searchParams.get("partNumber"));
    if (!/^creative-workbench\/CWV-[A-Z0-9]+\/v\d+\/[a-f0-9-]+\.(mp4|mov)$/i.test(key) || !uploadId) return Response.json({ error: "分片上传地址无效" }, { status: 400 });
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) return Response.json({ error: "分片序号无效" }, { status: 400 });
    if (!request.body) return Response.json({ error: "视频分片为空" }, { status: 400 });
    const part = await env.MEDIA.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, request.body);
    return Response.json({ partNumber: part.partNumber, etag: part.etag });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "视频分片上传失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const completedKeys: string[] = [];
  try {
    await ensureWorkflowSchema();
    const user = await getCurrentUser(request);
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action ?? "");
    const mode = payload.mode === "revision" ? "revision" : "create";
    const files = descriptors(payload.files);
    if (action === "init") {
      const itemId = mode === "revision" ? String(payload.itemId ?? "") : uid("CWV");
      const version = mode === "revision" ? await revisionContext(itemId, user) : 1;
      if (mode === "create") await createContext((payload.metadata ?? {}) as Record<string, unknown>, user);
      const uploads = await beginMultipart(itemId, version, files, user);
      return Response.json({ itemId, version, uploads }, { status: 201 });
    }
    if (action === "abort") {
      const uploads = Array.isArray(payload.uploads) ? payload.uploads as CompletedUpload[] : [];
      for (const upload of uploads) {
        if (upload.key.startsWith("creative-workbench/CWV-") && upload.uploadId) {
          await env.MEDIA.resumeMultipartUpload(upload.key, upload.uploadId).abort().catch(() => undefined);
        }
      }
      return Response.json({ ok: true });
    }
    if (action === "complete") {
      const itemId = String(payload.itemId ?? "");
      const version = Number(payload.version ?? 0);
      const uploads = Array.isArray(payload.uploads) ? payload.uploads as CompletedUpload[] : [];
      if (!/^CWV-[A-Z0-9]+$/i.test(itemId) || !Number.isInteger(version) || version < 1) throw new Error("上传任务信息无效");
      if (mode === "revision") {
        const expectedVersion = await revisionContext(itemId, user);
        if (expectedVersion !== version) throw new Error("视频版本已发生变化，请刷新后重试");
      } else await createContext((payload.metadata ?? {}) as Record<string, unknown>, user);
      completedKeys.push(...await finishObjects(itemId, version, uploads));
      if (mode === "revision") await insertRevision(itemId, version, String(payload.comment ?? "").trim(), uploads, user);
      else await insertCreate(itemId, (payload.metadata ?? {}) as Record<string, unknown>, uploads, user);
      return Response.json({ id: itemId, version }, { status: 201 });
    }
    return Response.json({ error: "不支持的上传操作" }, { status: 400 });
  } catch (error) {
    for (const key of completedKeys) await env.MEDIA.delete(key);
    return Response.json({ error: error instanceof Error ? error.message : "视频上传失败" }, { status: 500 });
  }
}
