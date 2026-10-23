import { env } from "cloudflare:workers";

type ColumnSpec = { name: string; definition: string };

const draftColumns: ColumnSpec[] = [
  { name: "creator_id", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "creator_name", definition: "TEXT NOT NULL DEFAULT '历史用户'" },
  { name: "uploader_id", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "uploader_name", definition: "TEXT NOT NULL DEFAULT '历史导入'" },
  { name: "author_type", definition: "TEXT NOT NULL DEFAULT '内部同事'" },
  { name: "author_name", definition: "TEXT NOT NULL DEFAULT '待补充'" },
  { name: "author_user_id", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "team_lead_reviewer_id", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "team_lead_reviewer_name", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "supervisor_reviewer_id", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "supervisor_reviewer_name", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "current_reviewer_id", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "priority", definition: "TEXT NOT NULL DEFAULT '普通'" },
  { name: "due_date", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "resume_stage", definition: "TEXT NOT NULL DEFAULT 'pending_team_lead'" },
  { name: "talent_name", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "video_links", definition: "TEXT NOT NULL DEFAULT '[]'" },
];

const scriptColumns: ColumnSpec[] = [
  { name: "author_type", definition: "TEXT NOT NULL DEFAULT '历史素材'" },
  { name: "author_name", definition: "TEXT NOT NULL DEFAULT '待补充'" },
  { name: "author_user_id", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "uploader_id", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "uploader_name", definition: "TEXT NOT NULL DEFAULT '历史导入'" },
  { name: "final_reviewer_id", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "final_reviewer_name", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "archived_from_draft_id", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "talent_name", definition: "TEXT NOT NULL DEFAULT ''" },
];

async function ensureColumns(table: string, columns: ColumnSpec[]) {
  const d1 = env.DB;
  const result = await d1.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const present = new Set((result.results ?? []).map((column) => column.name));
  for (const column of columns) {
    if (present.has(column.name)) continue;
    try {
      await d1.prepare(`ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.definition}`).run();
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate column")) throw error;
    }
  }
}

export async function ensureWorkflowSchema() {
  const d1 = env.DB;
  const production = d1 as typeof d1 & {ensureProductionSchema?: () => Promise<void>};
  if (production.ensureProductionSchema) { await production.ensureProductionSchema(); return; }

  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS script_notification_payloads (
      notification_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS script_notification_chats (
      id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, chat_id TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS creative_scripts (
      id TEXT PRIMARY KEY NOT NULL, script_type TEXT NOT NULL, product TEXT NOT NULL,
      title TEXT NOT NULL, copy TEXT NOT NULL, status TEXT NOT NULL DEFAULT '待验证',
      source TEXT NOT NULL DEFAULT '文字导入', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS creative_drafts (
      id TEXT PRIMARY KEY NOT NULL, product TEXT NOT NULL, script_type TEXT NOT NULL,
      template_id TEXT NOT NULL DEFAULT '', template_title TEXT NOT NULL DEFAULT '',
      requirements TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, content TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'generated',
      feedback TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS workspace_users (
      id TEXT PRIMARY KEY NOT NULL,
      employee_no TEXT NOT NULL UNIQUE,
      external_user_id TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT '',
      center TEXT NOT NULL DEFAULT '',
      job_title TEXT NOT NULL DEFAULT '',
      feishu_user_id TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'contributor',
      active INTEGER NOT NULL DEFAULT 1,
      login_registered INTEGER NOT NULL DEFAULT 0,
      preloaded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS script_versions (
      id TEXT PRIMARY KEY NOT NULL,
      draft_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      editor_id TEXT NOT NULL DEFAULT '',
      editor_name TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS review_actions (
      id TEXT PRIMARY KEY NOT NULL,
      draft_id TEXT NOT NULL,
      action TEXT NOT NULL,
      stage TEXT NOT NULL,
      actor_id TEXT NOT NULL DEFAULT '',
      actor_name TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS script_alternatives (
      id TEXT PRIMARY KEY NOT NULL,
      draft_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      request TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL DEFAULT '',
      creator_name TEXT NOT NULL DEFAULT '',
      adopted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      draft_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'workflow',
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS creative_work_items (
      id TEXT PRIMARY KEY NOT NULL,
      review_section TEXT NOT NULL,
      script_type TEXT NOT NULL DEFAULT '',
      cooperation_type TEXT NOT NULL DEFAULT '',
      material_name TEXT NOT NULL,
      author_id TEXT NOT NULL DEFAULT '',
      author_name TEXT NOT NULL,
      product TEXT NOT NULL DEFAULT '',
      feishu_url TEXT NOT NULL,
      artist_name TEXT NOT NULL DEFAULT '',
      project_name TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT '普通',
      due_date TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      submitter_id TEXT NOT NULL,
      submitter_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_review',
      current_step INTEGER NOT NULL DEFAULT 1,
      archived_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS creative_work_reviewers (
      id TEXT PRIMARY KEY NOT NULL,
      item_id TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      reviewer_name TEXT NOT NULL,
      reviewer_role TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      comment TEXT NOT NULL DEFAULT '',
      decided_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS creative_work_events (
      id TEXT PRIMARY KEY NOT NULL,
      item_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS creative_work_media (
      id TEXT PRIMARY KEY NOT NULL,
      item_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      storage_key TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      uploader_id TEXT NOT NULL DEFAULT '',
      uploader_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS creative_video_comments (
      id TEXT PRIMARY KEY NOT NULL,
      item_id TEXT NOT NULL,
      media_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      time_seconds REAL NOT NULL DEFAULT 0,
      comment TEXT NOT NULL,
      screenshot_key TEXT NOT NULL DEFAULT '',
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT NOT NULL DEFAULT ''
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS creative_artist_projects (
      id TEXT PRIMARY KEY NOT NULL,
      artist_name TEXT NOT NULL,
      product TEXT NOT NULL,
      project_type TEXT NOT NULL DEFAULT '信息流明星',
      project_period TEXT NOT NULL DEFAULT '',
      phase TEXT NOT NULL DEFAULT '筹备中',
      owner_id TEXT NOT NULL DEFAULT '',
      owner TEXT NOT NULL DEFAULT '待分配',
      creator_id TEXT NOT NULL DEFAULT '',
      creator_name TEXT NOT NULL DEFAULT '',
      actual_fee TEXT NOT NULL DEFAULT '',
      rights_scope TEXT NOT NULL DEFAULT '',
      rights_start_date TEXT NOT NULL DEFAULT '',
      rights_end_date TEXT NOT NULL DEFAULT '',
      rights_file_url TEXT NOT NULL DEFAULT '',
      value_judgement TEXT NOT NULL DEFAULT '',
      decision TEXT NOT NULL DEFAULT '推进',
      decision_by TEXT NOT NULL DEFAULT '',
      decision_at TEXT NOT NULL DEFAULT '',
      shoot_date TEXT NOT NULL DEFAULT '',
      final_date TEXT NOT NULL DEFAULT '',
      launch_date TEXT NOT NULL DEFAULT '',
      first_creation_plan TEXT NOT NULL DEFAULT '',
      next_milestone TEXT NOT NULL DEFAULT '',
      eta TEXT NOT NULL DEFAULT '',
      risk TEXT NOT NULL DEFAULT '',
      script_summary TEXT NOT NULL DEFAULT '',
      production_summary TEXT NOT NULL DEFAULT '',
      launch_summary TEXT NOT NULL DEFAULT '',
      prep_summary TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS workspace_users_employee_idx ON workspace_users (employee_no)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS creative_drafts_creator_idx ON creative_drafts (status)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS script_versions_draft_idx ON script_versions (draft_id, version)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS review_actions_draft_idx ON review_actions (draft_id, created_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS script_alternatives_draft_idx ON script_alternatives (draft_id, created_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, is_read, created_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS creative_work_items_status_idx ON creative_work_items (status, updated_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS creative_work_items_submitter_idx ON creative_work_items (submitter_id, updated_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS creative_work_reviewers_item_idx ON creative_work_reviewers (item_id, step_order)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS creative_work_reviewers_assignee_idx ON creative_work_reviewers (reviewer_id, status)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS creative_work_events_item_idx ON creative_work_events (item_id, created_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS creative_work_media_item_idx ON creative_work_media (item_id, version, created_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS creative_video_comments_media_time_idx ON creative_video_comments (media_id, version, time_seconds)"),
  ]);
  await ensureColumns("creative_drafts", draftColumns);
  await ensureColumns("creative_scripts", scriptColumns);
  await ensureColumns("workspace_users", [
    { name: "job_title", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "feishu_user_id", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "login_registered", definition: "INTEGER NOT NULL DEFAULT 0" },
    { name: "preloaded", definition: "INTEGER NOT NULL DEFAULT 0" },
  ]);
  await ensureColumns("creative_work_items", [
    { name: "content_type", definition: "TEXT NOT NULL DEFAULT 'script'" },
  ]);
  await ensureColumns("creative_artist_projects", [
    { name: "project_period", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "owner_id", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "creator_id", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "creator_name", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "actual_fee", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "rights_scope", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "rights_start_date", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "rights_end_date", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "rights_file_url", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "value_judgement", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "decision", definition: "TEXT NOT NULL DEFAULT '推进'" },
    { name: "decision_by", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "decision_at", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "shoot_date", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "final_date", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "launch_date", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "first_creation_plan", definition: "TEXT NOT NULL DEFAULT ''" },
  ]);
  await d1.prepare("CREATE INDEX IF NOT EXISTS creative_artist_projects_artist_idx ON creative_artist_projects (artist_name, project_period)").run();
  const presetNames = ["李雨橦", "张锦香", "穆开元", "吴灿莹", "陶琳婷", "甘凯婷", "陈幸琳", "孙妍", "郭莉想", "杨凯琳"];
  for (const [index, name] of presetNames.entries()) {
    await d1.prepare(`INSERT OR IGNORE INTO workspace_users
      (id, employee_no, name, department, role, active, login_registered, preloaded)
      VALUES (?, ?, ?, '品牌营销部', 'contributor', 1, 0, 1)`)
      .bind(`USR-PRESET-${String(index + 1).padStart(2, "0")}`, `PRESET-${String(index + 1).padStart(2, "0")}`, name).run();
  }
  const groupedReviewers = [
    { id: "USR-FD-021068", employeeNo: "FD-021068", name: "何雨庭", role: "supervisor" },
    { id: "USR-FD-117110", employeeNo: "FD-117110", name: "赵佳乐", role: "director" },
  ];
  for (const person of groupedReviewers) {
    await d1.prepare(`INSERT OR IGNORE INTO workspace_users
      (id, employee_no, name, department, role, active, login_registered, preloaded)
      VALUES (?, ?, ?, '品牌营销部', ?, 1, 0, 1)`)
      .bind(person.id, person.employeeNo, person.name, person.role).run();
    await d1.prepare(`UPDATE workspace_users SET name=?, department='品牌营销部', role=?, active=1,
      preloaded=CASE WHEN login_registered=1 THEN preloaded ELSE 1 END WHERE UPPER(employee_no)=UPPER(?)`)
      .bind(person.name, person.role, person.employeeNo).run();
  }
  await d1.prepare("UPDATE workspace_users SET role = CASE WHEN name = '李雨橦' THEN 'admin' WHEN role = 'admin' THEN 'contributor' ELSE role END").run();
  const artistProjects = [
    ["PRJ-HAIQING", "海清", "黑晶面膜", "实拍艺人", "拍摄筹备", "李雨橦", "完成脚本审核与酒店、妆造确认", "2026-09-08", "", "脚本待关联审核任务，版本数随审核记录自动统计", "9月8日拍摄", "待拍摄", "酒店与妆造方案待审核"],
    ["PRJ-LINXINRU", "林心如", "眼膜", "实拍艺人", "上线追投", "李雨橦", "观察跑速并完成混剪上线", "2026-08-24", "持续观察追投效率", "原片已于8月23日下午上线", "原片已传系统，混剪可上线", "统计文案裂变与框架裂变数量", "拍摄筹备已完成"],
    ["PRJ-LIYING", "李颖", "水润面膜", "实拍艺人", "出片初审", "李雨橦", "完成信息流成片初审", "2026-08-24", "需明确后续优化方向", "脚本版本待关联", "信息流成片预计今日初审", "待记录上线版本数与优化方向", "拍摄筹备已完成"],
    ["PRJ-NIULI", "牛莉", "黑晶面膜", "AI艺人", "AI成片", "李雨橦", "交付首轮AI成片", "2026-08-26", "画面一致性需重点复核", "8月20日已交付脚本并对齐AI画面细则", "预计周三成片", "待配置测试框架", "AI画面细则已对齐"],
    ["PRJ-HUANGYOUMING", "黄宥明", "黑晶面膜", "AI艺人", "AI成片", "李雨橦", "交付首轮AI成片", "2026-08-26", "画面一致性需重点复核", "8月20日已交付脚本并对齐AI画面细则", "预计周三成片", "待配置测试框架", "AI画面细则已对齐"],
    ["PRJ-HESHENGMING", "何晟铭", "黑晶面膜", "AI艺人", "AI成片", "李雨橦", "交付首轮AI成片", "2026-08-26", "画面一致性需重点复核", "8月20日已交付脚本并对齐AI画面细则", "预计周三成片", "待配置测试框架", "AI画面细则已对齐"]
  ];
  for (const project of artistProjects) {
    await d1.prepare(`INSERT OR IGNORE INTO creative_artist_projects
      (id, artist_name, product, project_type, phase, owner, next_milestone, eta, risk, script_summary, production_summary, launch_summary, prep_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(...project).run();
  }
}

export function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}
