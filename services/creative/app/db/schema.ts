import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const creativeScripts = sqliteTable(
  "creative_scripts",
  {
    id: text("id").primaryKey(),
    scriptType: text("script_type").notNull(),
    product: text("product").notNull(),
    title: text("title").notNull(),
    copy: text("copy").notNull(),
    status: text("status").notNull().default("待验证"),
    source: text("source").notNull().default("文字导入"),
    authorType: text("author_type").notNull().default("历史素材"),
    authorName: text("author_name").notNull().default("待补充"),
    authorUserId: text("author_user_id").notNull().default(""),
    uploaderId: text("uploader_id").notNull().default(""),
    uploaderName: text("uploader_name").notNull().default("历史导入"),
    finalReviewerId: text("final_reviewer_id").notNull().default(""),
    finalReviewerName: text("final_reviewer_name").notNull().default(""),
    archivedFromDraftId: text("archived_from_draft_id").notNull().default(""),
    talentName: text("talent_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("creative_scripts_type_idx").on(table.scriptType),
    index("creative_scripts_product_idx").on(table.product),
  ],
);

export const creativeVideos = sqliteTable(
  "creative_videos",
  {
    id: text("id").primaryKey(),
    scriptId: text("script_id")
      .notNull()
      .references(() => creativeScripts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url").notNull().default(""),
    duration: text("duration").notNull().default("--:--"),
    coverTone: text("cover_tone").notNull().default("forest"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("creative_videos_script_idx").on(table.scriptId)],
);

export const competitorScripts = sqliteTable(
  "competitor_scripts",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    brand: text("brand").notNull().default("待补充"),
    product: text("product").notNull().default("待补充"),
    scriptType: text("script_type").notNull().default("自产脚本"),
    copy: text("copy").notNull(),
    source: text("source").notNull().default("批量导入"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("competitor_scripts_created_idx").on(table.createdAt)],
);

export const creatorCollaborations = sqliteTable(
  "creator_collaborations",
  {
    id: text("id").primaryKey(),
    sequence: integer("sequence").notNull().default(1),
    creatorName: text("creator_name").notNull(),
    platform: text("platform").notNull().default("抖音"),
    materialType: text("material_type").notNull().default("付费KOC原片"),
    product: text("product").notNull(),
    ownerId: text("owner_id").notNull().default(""),
    owner: text("owner").notNull().default("待分配"),
    stage: text("stage").notNull().default("待建联"),
    dueDate: text("due_date").notNull().default(""),
    shootingDate: text("shooting_date").notNull().default(""),
    finishedDate: text("finished_date").notNull().default(""),
    actualShootingDate: text("actual_shooting_date").notNull().default(""),
    actualFinishedDate: text("actual_finished_date").notNull().default(""),
    actualLaunchDate: text("actual_launch_date").notNull().default(""),
    linkedItemIds: text("linked_item_ids").notNull().default("[]"),
    scriptLink: text("script_link").notNull().default(""),
    source: text("source").notNull().default(""),
    launchDate: text("launch_date").notNull().default(""),
    abnormalStage: text("abnormal_stage").notNull().default(""),
    abnormalNote: text("abnormal_note").notNull().default(""),
    assetLink: text("asset_link").notNull().default(""),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("creator_collaborations_stage_idx").on(table.stage),
    index("creator_collaborations_launch_idx").on(table.launchDate, table.ownerId),
  ],
);

export const creativeDrafts = sqliteTable(
  "creative_drafts",
  {
    id: text("id").primaryKey(),
    product: text("product").notNull(),
    scriptType: text("script_type").notNull(),
    templateId: text("template_id").notNull().default(""),
    templateTitle: text("template_title").notNull().default(""),
    requirements: text("requirements").notNull().default(""),
    title: text("title").notNull(),
    content: text("content").notNull(),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("generated"),
    feedback: text("feedback").notNull().default(""),
    creatorId: text("creator_id").notNull().default(""),
    creatorName: text("creator_name").notNull().default("历史用户"),
    uploaderId: text("uploader_id").notNull().default(""),
    uploaderName: text("uploader_name").notNull().default("历史导入"),
    authorType: text("author_type").notNull().default("内部同事"),
    authorName: text("author_name").notNull().default("待补充"),
    authorUserId: text("author_user_id").notNull().default(""),
    teamLeadReviewerId: text("team_lead_reviewer_id").notNull().default(""),
    teamLeadReviewerName: text("team_lead_reviewer_name").notNull().default(""),
    supervisorReviewerId: text("supervisor_reviewer_id").notNull().default(""),
    supervisorReviewerName: text("supervisor_reviewer_name").notNull().default(""),
    currentReviewerId: text("current_reviewer_id").notNull().default(""),
    priority: text("priority").notNull().default("普通"),
    dueDate: text("due_date").notNull().default(""),
    resumeStage: text("resume_stage").notNull().default("pending_team_lead"),
    talentName: text("talent_name").notNull().default(""),
    videoLinks: text("video_links").notNull().default("[]"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("creative_drafts_status_idx").on(table.status)],
);

export const workspaceUsers = sqliteTable("workspace_users", {
  id: text("id").primaryKey(),
  employeeNo: text("employee_no").notNull().unique(),
  externalUserId: text("external_user_id").notNull().default(""),
  email: text("email").notNull().default(""),
  name: text("name").notNull(),
  department: text("department").notNull().default(""),
  center: text("center").notNull().default(""),
  jobTitle: text("job_title").notNull().default(""),
  feishuUserId: text("feishu_user_id").notNull().default(""),
  role: text("role").notNull().default("contributor"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  loginRegistered: integer("login_registered", { mode: "boolean" }).notNull().default(false),
  preloaded: integer("preloaded", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const scriptVersions = sqliteTable("script_versions", {
  id: text("id").primaryKey(), draftId: text("draft_id").notNull(), version: integer("version").notNull(),
  title: text("title").notNull(), content: text("content").notNull(), editorId: text("editor_id").notNull().default(""),
  editorName: text("editor_name").notNull().default(""), reason: text("reason").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("script_versions_draft_idx").on(table.draftId, table.version)]);

export const scriptAlternatives = sqliteTable("script_alternatives", {
  id: text("id").primaryKey(),
  draftId: text("draft_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  request: text("request").notNull().default(""),
  creatorId: text("creator_id").notNull().default(""),
  creatorName: text("creator_name").notNull().default(""),
  adopted: integer("adopted", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("script_alternatives_draft_idx").on(table.draftId, table.createdAt)]);

export const reviewActions = sqliteTable("review_actions", {
  id: text("id").primaryKey(), draftId: text("draft_id").notNull(), action: text("action").notNull(),
  stage: text("stage").notNull(), actorId: text("actor_id").notNull().default(""), actorName: text("actor_name").notNull().default(""),
  comment: text("comment").notNull().default(""), version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("review_actions_draft_idx").on(table.draftId, table.createdAt)]);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), draftId: text("draft_id").notNull().default(""),
  type: text("type").notNull().default("workflow"), title: text("title").notNull(), detail: text("detail").notNull().default(""),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("notifications_user_idx").on(table.userId, table.isRead, table.createdAt)]);

export const creativeWorkItems = sqliteTable("creative_work_items", {
  id: text("id").primaryKey(),
  contentType: text("content_type").notNull().default("script"),
  reviewSection: text("review_section").notNull(),
  scriptType: text("script_type").notNull().default(""),
  cooperationType: text("cooperation_type").notNull().default(""),
  materialName: text("material_name").notNull(),
  authorId: text("author_id").notNull().default(""),
  authorName: text("author_name").notNull(),
  product: text("product").notNull().default(""),
  feishuUrl: text("feishu_url").notNull(),
  artistName: text("artist_name").notNull().default(""),
  projectName: text("project_name").notNull().default(""),
  priority: text("priority").notNull().default("普通"),
  dueDate: text("due_date").notNull().default(""),
  note: text("note").notNull().default(""),
  submitterId: text("submitter_id").notNull(),
  submitterName: text("submitter_name").notNull(),
  status: text("status").notNull().default("pending_review"),
  currentStep: integer("current_step").notNull().default(1),
  archivedAt: text("archived_at").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("creative_work_items_status_idx").on(table.status, table.updatedAt),
  index("creative_work_items_submitter_idx").on(table.submitterId, table.updatedAt),
]);

export const creativeWorkReviewers = sqliteTable("creative_work_reviewers", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull(),
  reviewerId: text("reviewer_id").notNull(),
  reviewerName: text("reviewer_name").notNull(),
  reviewerRole: text("reviewer_role").notNull(),
  stepOrder: integer("step_order").notNull(),
  status: text("status").notNull().default("waiting"),
  comment: text("comment").notNull().default(""),
  decidedAt: text("decided_at").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("creative_work_reviewers_item_idx").on(table.itemId, table.stepOrder),
  index("creative_work_reviewers_assignee_idx").on(table.reviewerId, table.status),
]);

export const creativeWorkEvents = sqliteTable("creative_work_events", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull(),
  actorId: text("actor_id").notNull(),
  actorName: text("actor_name").notNull(),
  action: text("action").notNull(),
  comment: text("comment").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("creative_work_events_item_idx").on(table.itemId, table.createdAt)]);

export const creativeWorkMedia = sqliteTable("creative_work_media", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull(),
  version: integer("version").notNull().default(1),
  storageKey: text("storage_key").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  uploaderId: text("uploader_id").notNull().default(""),
  uploaderName: text("uploader_name").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("creative_work_media_item_idx").on(table.itemId, table.version, table.createdAt)]);

export const creativeArtistProjects = sqliteTable("creative_artist_projects", {
  id: text("id").primaryKey(),
  artistName: text("artist_name").notNull(),
  product: text("product").notNull(),
  projectType: text("project_type").notNull().default("信息流明星"),
  projectPeriod: text("project_period").notNull().default(""),
  phase: text("phase").notNull().default("筹备中"),
  ownerId: text("owner_id").notNull().default(""),
  owner: text("owner").notNull().default("待分配"),
  creatorId: text("creator_id").notNull().default(""),
  creatorName: text("creator_name").notNull().default(""),
  actualFee: text("actual_fee").notNull().default(""),
  rightsScope: text("rights_scope").notNull().default(""),
  rightsStartDate: text("rights_start_date").notNull().default(""),
  rightsEndDate: text("rights_end_date").notNull().default(""),
  rightsFileUrl: text("rights_file_url").notNull().default(""),
  valueJudgement: text("value_judgement").notNull().default(""),
  decision: text("decision").notNull().default("推进"),
  decisionBy: text("decision_by").notNull().default(""),
  decisionAt: text("decision_at").notNull().default(""),
  shootDate: text("shoot_date").notNull().default(""),
  finalDate: text("final_date").notNull().default(""),
  launchDate: text("launch_date").notNull().default(""),
  firstCreationPlan: text("first_creation_plan").notNull().default(""),
  nextMilestone: text("next_milestone").notNull().default(""),
  eta: text("eta").notNull().default(""),
  risk: text("risk").notNull().default(""),
  scriptSummary: text("script_summary").notNull().default(""),
  productionSummary: text("production_summary").notNull().default(""),
  launchSummary: text("launch_summary").notNull().default(""),
  prepSummary: text("prep_summary").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("creative_artist_projects_artist_idx").on(table.artistName, table.projectPeriod)]);

export const scriptNotificationPayloads = sqliteTable("script_notification_payloads", {
  notificationId: text("notification_id").primaryKey(), payload: text("payload").notNull(),
});
export const scriptNotificationChats = sqliteTable("script_notification_chats", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), chatId: text("chat_id").notNull(),
  updatedAt: text("updated_at").notNull(),
});
