import { env } from "cloudflare:workers";
import { getCurrentUser, listWorkspaceUsers } from "../../../lib/current-user";
import { ensureWorkflowSchema, uid } from "../../../lib/workflow-schema";

type Row = Record<string, unknown>;

const SECTIONS = ["文案审核", "拍摄场地审核", "妆造方案审核"];
const SCRIPT_TYPES = ["付费KOC脚本", "唠嗑KOC脚本", "明星脚本", "AI脚本", "自产脚本", "混剪脚本", "剧情脚本"];
const PRODUCTS = ["眼膜", "水润面膜", "水油/蛋白喷雾", "美白针", "黄金面膜", "黑晶面膜", "燕窝面膜", "次抛精华"];
const ROLE_ORDER: Record<string, number> = { team_lead: 1, supervisor: 2, director: 3 };
const ROLE_LABEL: Record<string, string> = { team_lead: "组长审核", supervisor: "主管审核", director: "总监审核" };

function mapReviewer(row: Row) {
  return {
    id: String(row.id), itemId: String(row.item_id), reviewerId: String(row.reviewer_id), reviewerName: String(row.reviewer_name),
    reviewerRole: String(row.reviewer_role), roleLabel: ROLE_LABEL[String(row.reviewer_role)] ?? "审核",
    stepOrder: Number(row.step_order), status: String(row.status), comment: String(row.comment ?? ""),
    decidedAt: String(row.decided_at ?? ""), createdAt: String(row.created_at ?? ""),
  };
}

function mapEvent(row: Row) {
  return { id: String(row.id), itemId: String(row.item_id), actorId: String(row.actor_id), actorName: String(row.actor_name), action: String(row.action), comment: String(row.comment ?? ""), createdAt: String(row.created_at ?? "") };
}

function mapMedia(row: Row) {
  return {
    id: String(row.id), itemId: String(row.item_id), version: Number(row.version), originalName: String(row.original_name),
    mimeType: String(row.mime_type), sizeBytes: Number(row.size_bytes), uploaderName: String(row.uploader_name ?? ""),
    createdAt: String(row.created_at), url: `/api/media?key=${encodeURIComponent(String(row.storage_key))}`,
  };
}

function mapItem(row: Row, reviewers: ReturnType<typeof mapReviewer>[], events: ReturnType<typeof mapEvent>[], media: ReturnType<typeof mapMedia>[]) {
  return {
    id: String(row.id), contentType: String(row.content_type ?? "script"), reviewSection: String(row.review_section), scriptType: String(row.script_type ?? ""),
    cooperationType: String(row.cooperation_type ?? ""), materialName: String(row.material_name),
    authorId: String(row.author_id ?? ""), authorName: String(row.author_name), product: String(row.product ?? ""),
    feishuUrl: String(row.feishu_url), artistName: String(row.artist_name ?? ""), projectName: String(row.project_name ?? ""),
    priority: String(row.priority), dueDate: String(row.due_date ?? ""), note: String(row.note ?? ""),
    submitterId: String(row.submitter_id), submitterName: String(row.submitter_name), status: String(row.status),
    currentStep: Number(row.current_step), archivedAt: String(row.archived_at ?? ""), createdAt: String(row.created_at),
    updatedAt: String(row.updated_at), reviewers, events, media,
  };
}

function validFeishuUrl(value: string) {
  try {
    const url = new URL(value);
    const allowedHost = url.hostname.endsWith("feishu.cn") || url.hostname.endsWith("larksuite.com");
    return url.protocol === "https:" && allowedHost && /\/(docx|docs|sheets|slides|wiki)\//.test(url.pathname);
  } catch { return false; }
}

async function loadAll() {
  const itemRows = (await env.DB.prepare("SELECT * FROM creative_work_items ORDER BY updated_at DESC LIMIT 500").all<Row>()).results ?? [];
  const reviewerRows = (await env.DB.prepare("SELECT * FROM creative_work_reviewers ORDER BY item_id, step_order").all<Row>()).results ?? [];
  const eventRows = (await env.DB.prepare("SELECT * FROM creative_work_events ORDER BY created_at DESC").all<Row>()).results ?? [];
  const mediaRows = (await env.DB.prepare("SELECT * FROM creative_work_media ORDER BY item_id, version DESC, created_at").all<Row>()).results ?? [];
  return itemRows.map((row) => mapItem(
    row,
    reviewerRows.filter((reviewer) => reviewer.item_id === row.id).map(mapReviewer),
    eventRows.filter((event) => event.item_id === row.id).map(mapEvent),
    mediaRows.filter((media) => media.item_id === row.id).map(mapMedia),
  ));
}

async function loadLegacyLibrary() {
  const rows = (await env.DB.prepare(`SELECT id, script_type, product, title, copy, author_name,
    talent_name, created_at FROM creative_scripts ORDER BY created_at DESC LIMIT 1000`).all<Row>()).results ?? [];
  return rows.map((row) => ({
    id: `LEGACY-${String(row.id)}`,
    contentType: "script",
    sourceId: String(row.id),
    reviewSection: "文案审核",
    scriptType: String(row.script_type ?? ""),
    cooperationType: String(row.script_type ?? "历史案例"),
    materialName: String(row.title),
    authorId: "",
    authorName: String(row.author_name ?? "历史素材"),
    product: String(row.product ?? ""),
    feishuUrl: "",
    artistName: String(row.talent_name ?? ""),
    projectName: "",
    priority: "普通",
    dueDate: "",
    note: "历史品牌案例库素材",
    submitterId: "",
    submitterName: "",
    status: "archived",
    currentStep: 0,
    archivedAt: String(row.created_at ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.created_at ?? ""),
    reviewers: [],
    events: [],
    media: [],
    legacy: true,
    copy: String(row.copy ?? ""),
  }));
}

export async function GET(request: Request) {
  try {
    await ensureWorkflowSchema();
    const user = await getCurrentUser(request);
    const [items, legacyLibrary, users, projectResult] = await Promise.all([
      loadAll(), loadLegacyLibrary(), listWorkspaceUsers(), env.DB.prepare("SELECT * FROM creative_artist_projects ORDER BY updated_at DESC").all<Row>(),
    ]);
    const now = Date.now();
    const in24Hours = now + 24 * 60 * 60 * 1000;
    const mySubmitted = items.filter((item) => item.submitterId === user.id || item.authorId === user.id);
    const assigned = items.filter((item) => item.reviewers.some((step) => step.reviewerId === user.id && step.status === "active"));
    const returned = mySubmitted.filter((item) => item.status === "returned");
    const dueSoon = items.filter((item) => {
      if (!["pending_review", "returned"].includes(item.status) || !item.dueDate) return false;
      const due = new Date(`${item.dueDate}T23:59:59+08:00`).getTime();
      const involved = item.submitterId === user.id || item.authorId === user.id || item.reviewers.some((step) => step.reviewerId === user.id);
      return involved && due <= in24Hours;
    });
    const participating = items.filter((item) => item.submitterId === user.id || item.authorId === user.id || item.reviewers.some((step) => step.reviewerId === user.id));
    const library = [...items.filter((item) => item.status === "archived"), ...legacyLibrary];
    const projects = (projectResult.results ?? []).map((row) => ({
      id: String(row.id), artistName: String(row.artist_name), product: String(row.product), projectType: String(row.project_type),
      projectPeriod: String(row.project_period || String(row.eta ?? "").slice(0, 7)), phase: String(row.phase),
      ownerId: String(row.owner_id ?? ""), owner: String(row.owner), creatorId: String(row.creator_id ?? ""), creatorName: String(row.creator_name || row.owner),
      actualFee: String(row.actual_fee ?? ""), rightsScope: String(row.rights_scope ?? ""), rightsStartDate: String(row.rights_start_date ?? ""),
      rightsEndDate: String(row.rights_end_date ?? ""), rightsFileUrl: String(row.rights_file_url ?? ""), valueJudgement: String(row.value_judgement ?? ""),
      decision: String(row.decision || "推进"), decisionBy: String(row.decision_by || row.owner), decisionAt: String(row.decision_at ?? ""),
      shootDate: String(row.shoot_date ?? ""), finalDate: String(row.final_date ?? ""), launchDate: String(row.launch_date ?? ""),
      firstCreationPlan: String(row.first_creation_plan ?? ""), nextMilestone: String(row.next_milestone), eta: String(row.eta), risk: String(row.risk),
      scriptSummary: String(row.script_summary), productionSummary: String(row.production_summary), launchSummary: String(row.launch_summary),
      prepSummary: String(row.prep_summary), updatedAt: String(row.updated_at),
      linkedItems: items.filter((item) => item.artistName === row.artist_name),
    }));
    return Response.json({
      user, users, items, library, projects,
      mine: { submitted: mySubmitted, assigned, returned, dueSoon, participating },
      counts: { submitted: mySubmitted.length, assigned: assigned.length, returned: returned.length, dueSoon: dueSoon.length, participating: participating.length, library: library.length },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "创意创作台读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureWorkflowSchema();
    const user = await getCurrentUser(request);
    const payload = await request.json() as Record<string, unknown>;
    const reviewSection = String(payload.reviewSection ?? "").trim();
    const scriptType = String(payload.scriptType ?? "").trim();
    const cooperationType = String(payload.cooperationType ?? "").trim();
    const materialName = String(payload.materialName ?? "").trim();
    const authorId = String(payload.authorId ?? user.id).trim();
    const product = String(payload.product ?? "").trim();
    const feishuUrl = String(payload.feishuUrl ?? "").trim();
    const artistName = String(payload.artistName ?? "").trim();
    const projectName = String(payload.projectName ?? "").trim();
    const priority = ["紧急", "普通", "低"].includes(String(payload.priority)) ? String(payload.priority) : "普通";
    const dueDate = String(payload.dueDate ?? "").trim();
    const note = String(payload.note ?? "").trim();
    const requested = Array.isArray(payload.reviewers) ? payload.reviewers as Array<Record<string, unknown>> : [];
    if (!SECTIONS.includes(reviewSection)) return Response.json({ error: "请选择审核分类" }, { status: 400 });
    if (reviewSection === "文案审核" && !SCRIPT_TYPES.includes(scriptType)) return Response.json({ error: "请选择脚本类型" }, { status: 400 });
    if (!materialName || materialName.length < 2) return Response.json({ error: "请填写素材名称" }, { status: 400 });
    if (product && !PRODUCTS.includes(product)) return Response.json({ error: "请选择有效单品" }, { status: 400 });
    if (!validFeishuUrl(feishuUrl)) return Response.json({ error: "请粘贴有效的飞书文档、表格、幻灯片或知识库链接" }, { status: 400 });
    if (requested.length < 1) return Response.json({ error: "请至少选择一位审核人" }, { status: 400 });

    const users = await listWorkspaceUsers();
    const author = users.find((entry) => entry.id === authorId) ?? user;
    const normalized = requested.map((entry) => ({ reviewerId: String(entry.reviewerId ?? ""), role: String(entry.role ?? "") }))
      .filter((entry) => entry.reviewerId && ROLE_ORDER[entry.role])
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
    if (new Set(normalized.map((entry) => entry.role)).size !== normalized.length) return Response.json({ error: "同一审核层级只能选择一位同事" }, { status: 400 });
    if (new Set(normalized.map((entry) => entry.reviewerId)).size !== normalized.length) return Response.json({ error: "同一位同事不能重复出现在审核路径中" }, { status: 400 });
    const reviewerUsers = normalized.map((entry) => ({ ...entry, person: users.find((person) => person.id === entry.reviewerId) }));
    if (reviewerUsers.length !== requested.length || reviewerUsers.some((entry) => !entry.person)) return Response.json({ error: "审核人信息无效，请重新选择" }, { status: 400 });

    const id = uid("CW");
    const now = new Date().toISOString();
    const statements = [
      env.DB.prepare(`INSERT INTO creative_work_items
        (id, review_section, script_type, cooperation_type, material_name, author_id, author_name, product, feishu_url, artist_name, project_name, priority, due_date, note, submitter_id, submitter_name, status, current_step, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', 1, ?, ?)`)
        .bind(id, reviewSection, reviewSection === "文案审核" ? scriptType : "", cooperationType, materialName, author.id, author.name, product, feishuUrl, artistName, projectName, priority, dueDate, note, user.id, user.name, now, now),
      env.DB.prepare("INSERT INTO creative_work_events (id, item_id, actor_id, actor_name, action, comment, created_at) VALUES (?, ?, ?, ?, 'submit', ?, ?)")
        .bind(uid("CWE"), id, user.id, user.name, note || "提交审核", now),
      ...reviewerUsers.map((entry, index) => env.DB.prepare(`INSERT INTO creative_work_reviewers
        (id, item_id, reviewer_id, reviewer_name, reviewer_role, step_order, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(uid("CWR"), id, entry.person!.id, entry.person!.name, entry.role, index + 1, index === 0 ? "active" : "waiting", now)),
    ];
    await env.DB.batch(statements);
    const created = (await loadAll()).find((item) => item.id === id);
    return Response.json({ item: created }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "审核任务提交失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureWorkflowSchema();
    const user = await getCurrentUser(request);
    const payload = await request.json() as Record<string, unknown>;
    const id = String(payload.id ?? "");
    const action = String(payload.action ?? "");
    const comment = String(payload.comment ?? "").trim();
    const row = await env.DB.prepare("SELECT * FROM creative_work_items WHERE id = ? LIMIT 1").bind(id).first<Row>();
    if (!row) return Response.json({ error: "审核任务不存在" }, { status: 404 });
    const reviewers = ((await env.DB.prepare("SELECT * FROM creative_work_reviewers WHERE item_id = ? ORDER BY step_order").bind(id).all<Row>()).results ?? []).map(mapReviewer);
    const now = new Date().toISOString();
    if (action === "return" || action === "pass") {
      const active = reviewers.find((step) => step.status === "active");
      if (!active || active.reviewerId !== user.id) return Response.json({ error: "当前任务不在你的审核节点" }, { status: 403 });
      if (action === "return" && !comment) return Response.json({ error: "退回稿件时必须填写审核意见" }, { status: 400 });
      if (action === "return") {
        await env.DB.batch([
          env.DB.prepare("UPDATE creative_work_reviewers SET status='returned', comment=?, decided_at=? WHERE id=?").bind(comment, now, active.id),
          env.DB.prepare("UPDATE creative_work_items SET status='returned', updated_at=? WHERE id=?").bind(now, id),
          env.DB.prepare("INSERT INTO creative_work_events (id, item_id, actor_id, actor_name, action, comment, created_at) VALUES (?, ?, ?, ?, 'return', ?, ?)").bind(uid("CWE"), id, user.id, user.name, comment, now),
        ]);
      } else {
        const next = reviewers.find((step) => step.stepOrder > active.stepOrder && step.status === "waiting");
        const statements = [
          env.DB.prepare("UPDATE creative_work_reviewers SET status='passed', comment=?, decided_at=? WHERE id=?").bind(comment, now, active.id),
          env.DB.prepare("INSERT INTO creative_work_events (id, item_id, actor_id, actor_name, action, comment, created_at) VALUES (?, ?, ?, ?, 'pass', ?, ?)").bind(uid("CWE"), id, user.id, user.name, comment, now),
        ];
        if (next) {
          statements.push(env.DB.prepare("UPDATE creative_work_reviewers SET status='active' WHERE id=?").bind(next.id));
          statements.push(env.DB.prepare("UPDATE creative_work_items SET current_step=?, updated_at=? WHERE id=?").bind(next.stepOrder, now, id));
        } else {
          statements.push(env.DB.prepare("UPDATE creative_work_items SET status='archived', archived_at=?, updated_at=? WHERE id=?").bind(now, now, id));
          statements.push(env.DB.prepare("INSERT INTO creative_work_events (id, item_id, actor_id, actor_name, action, comment, created_at) VALUES (?, ?, ?, ?, 'archive', '全部审核人已通过，系统自动存档', ?)").bind(uid("CWE"), id, user.id, user.name, now));
        }
        await env.DB.batch(statements);
      }
    } else if (action === "resubmit") {
      if (String(row.submitter_id) !== user.id && String(row.author_id) !== user.id) return Response.json({ error: "仅发起人或作者可以重新提交" }, { status: 403 });
      if (String(row.status) !== "returned") return Response.json({ error: "只有退回稿件可以重新提交" }, { status: 400 });
      await env.DB.batch([
        env.DB.prepare("UPDATE creative_work_reviewers SET status=CASE WHEN step_order=1 THEN 'active' ELSE 'waiting' END, comment='', decided_at='' WHERE item_id=?").bind(id),
        env.DB.prepare("UPDATE creative_work_items SET status='pending_review', current_step=1, updated_at=? WHERE id=?").bind(now, id),
        env.DB.prepare("INSERT INTO creative_work_events (id, item_id, actor_id, actor_name, action, comment, created_at) VALUES (?, ?, ?, ?, 'resubmit', ?, ?)").bind(uid("CWE"), id, user.id, user.name, comment || "已在原飞书文档完成修改并重新提交", now),
      ]);
    } else {
      return Response.json({ error: "不支持的操作" }, { status: 400 });
    }
    const updated = (await loadAll()).find((item) => item.id === id);
    return Response.json({ item: updated });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "审核操作失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureWorkflowSchema();
    const user = await getCurrentUser(request);
    const payload = await request.json() as Record<string, unknown>;
    const id = String(payload.id ?? "").trim();
    const isAdmin = user.name === "李雨橦" || user.id.toUpperCase() === "FD-023794";
    if (!id) return Response.json({ error: "缺少要删除的素材" }, { status: 400 });

    if (id.startsWith("LEGACY-")) {
      if (!isAdmin) return Response.json({ error: "历史素材仅管理员可以删除" }, { status: 403 });
      const sourceId = id.slice("LEGACY-".length);
      const legacy = await env.DB.prepare("SELECT id FROM creative_scripts WHERE id=? LIMIT 1").bind(sourceId).first<Row>();
      if (!legacy) return Response.json({ error: "素材不存在或已删除" }, { status: 404 });
      await env.DB.batch([
        env.DB.prepare("DELETE FROM creative_videos WHERE script_id=?").bind(sourceId),
        env.DB.prepare("DELETE FROM creative_scripts WHERE id=?").bind(sourceId),
      ]);
      return Response.json({ ok: true });
    }

    const item = await env.DB.prepare("SELECT * FROM creative_work_items WHERE id=? LIMIT 1").bind(id).first<Row>();
    if (!item) return Response.json({ error: "素材不存在或已删除" }, { status: 404 });
    const ownsItem = [String(item.submitter_id ?? ""), String(item.author_id ?? "")].includes(user.id);
    if (!isAdmin && !ownsItem) return Response.json({ error: "仅作者、发起人或管理员可以删除" }, { status: 403 });
    const mediaRows = (await env.DB.prepare("SELECT storage_key FROM creative_work_media WHERE item_id=?").bind(id).all<Row>()).results ?? [];
    const commentRows = (await env.DB.prepare("SELECT screenshot_key FROM creative_video_comments WHERE item_id=? AND screenshot_key!=''").bind(id).all<Row>()).results ?? [];
    await env.DB.batch([
      env.DB.prepare("DELETE FROM creative_work_reviewers WHERE item_id=?").bind(id),
      env.DB.prepare("DELETE FROM creative_work_events WHERE item_id=?").bind(id),
      env.DB.prepare("DELETE FROM creative_video_comments WHERE item_id=?").bind(id),
      env.DB.prepare("DELETE FROM creative_work_media WHERE item_id=?").bind(id),
      env.DB.prepare("DELETE FROM notifications WHERE draft_id=?").bind(id),
      env.DB.prepare("DELETE FROM creative_work_items WHERE id=?").bind(id),
    ]);
    await Promise.all([...mediaRows.map((row) => String(row.storage_key)), ...commentRows.map((row) => String(row.screenshot_key))]
      .map((key) => env.MEDIA.delete(key).catch(() => undefined)));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 500 });
  }
}
