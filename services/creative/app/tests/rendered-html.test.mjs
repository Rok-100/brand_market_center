import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("defines the finished creative platform shell", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /IDEA OS｜创意智能中枢/);
  assert.match(page, /创意总览/);
  assert.match(page, /日常脚本创作/);
  assert.match(page, /AI 脚本创作/);
  assert.match(page, /command-sidebar/);
  assert.match(page, /工作空间/);
  assert.doesNotMatch(page + layout, /codex-preview|Your site is taking shape/);
});

test("includes persistent script creation and iterative review", async () => {
  const [page, createApi, reviewApi, engine, schema] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/scripts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/scripts/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/script-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /补充需求/);
  assert.match(page, /搜索案例库脚本/);
  assert.match(page, /确定并送审/);
  assert.match(page, /AI 按意见生成新稿/);
  assert.match(page, /重新生成此版本/);
  assert.match(page, /AI 新稿（未覆盖原稿）/);
  assert.match(page, /历史版本（全文）/);
  assert.match(page, /主管终审并归档/);
  assert.match(createApi, /generateScripts/);
  assert.match(reviewApi, /pending_team_lead/);
  assert.match(reviewApi, /pending_supervisor/);
  assert.match(reviewApi, /returned_to_creator/);
  assert.match(reviewApi, /creativeScripts/);
  assert.match(engine, /AI改稿/);
  assert.match(engine, /30\+熟龄女性/);
  assert.match(engine, /容貌焦虑/);
  assert.match(engine, /肤感/);
  assert.match(engine, /价格机制/);
  assert.doesNotMatch(engine, /避免夸张功效/);
  assert.doesNotMatch(engine, /空调房|第二天上妆/);
  assert.match(schema, /creative_drafts/);
  assert.match(schema, /script_versions/);
  assert.match(schema, /review_actions/);
  assert.match(schema, /script_alternatives/);
});

test("binds OA identity to personal workbench, reviewer directory and attribution", async () => {
  const [page, identity, workbench, usersApi, schema, nginx] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/current-user.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workbench/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/users/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../deploy/fandow-nginx.conf", import.meta.url), "utf8"),
  ]);
  assert.match(page, /MY WORKBENCH/);
  assert.match(page, /作者 \/ 达人名/);
  assert.doesNotMatch(page, /团队与审核人/);
  assert.match(page, /输入姓名搜索/);
  assert.match(page, /PersonCombobox/);
  assert.match(identity, /api\.fandow\.com\/auth\/userinfo/);
  assert.match(identity, /deptJobName/);
  assert.match(workbench, /currentReviewerId/);
  assert.match(usersApi, /只有管理角色可以维护团队成员/);
  assert.match(identity, /preloaded = 1/);
  assert.match(identity, /login_registered=1/);
  assert.match(identity, /ALLOW_LOCAL_IDENTITY !== "true"/);
  assert.match(identity, /login_registered = 1 OR preloaded = 1/);
  assert.match(schema, /workspace_users/);
  assert.match(nginx, /X-OA-Token/);
});

test("enforces owner deletion and Li Yutong administrator access without uploader labels", async () => {
  const [page, scriptsApi, casesApi, workflow, identity] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/scripts/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cases/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/workflow-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/current-user.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(page, /上传人/);
  assert.match(page, /删除脚本/);
  assert.match(scriptsApi, /export async function DELETE/);
  assert.match(scriptsApi, /只能删除自己的脚本/);
  assert.match(casesApi, /只能删除自己的案例/);
  assert.match(workflow, /name = '李雨橦' THEN 'admin'/);
  assert.match(identity, /identity\.name === "李雨橦"/);
});

test("includes daily script submission, preset colleagues, media and Word export", async () => {
  const [page, dailyApi, mediaApi, schema, workflow, exportApi] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/daily-scripts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/draft-media/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/workflow-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cases/[id]/export/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /提交一条新脚本/);
  assert.match(page, /合作达人/);
  assert.match(page, /上传脚本文档/);
  assert.match(page, /上传关联视频/);
  assert.doesNotMatch(page.match(/const navItems[\s\S]*?\];/)?.[0] ?? "", /投放追踪|自动复盘/);
  assert.match(dailyApi, /pending_team_lead/);
  assert.match(mediaApi, /video_links/);
  assert.match(schema, /talent_name/);
  assert.match(workflow, /杨凯琳/);
  assert.match(exportApi, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
});

test("includes the script-first case library and import workflow", async () => {
  const [page, api, schema, hosting] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cases/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /剧情脚本/);
  assert.match(page, /付费KOC脚本/);
  assert.match(page, /唠嗑KOC脚本/);
  assert.match(page, /水油\/蛋白喷雾/);
  assert.match(page, /批量导入文档/);
  assert.match(page, /查看全文 \/ 编辑/);
  assert.match(page, /MP4 \/ MOV/);
  assert.match(api, /creativeScripts/);
  assert.match(schema, /creative_videos/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": "MEDIA"/);
});

test("includes a persistent competitor library with batch confirmation", async () => {
  const [page, api, schema] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/competitor-cases/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /竞对案例库/);
  assert.match(page, /批量导入竞对脚本/);
  assert.match(page, /识别全部脚本/);
  assert.match(page, /逐条确认/);
  assert.match(api, /competitorScripts/);
  assert.match(api, /slice\(0, 100\)/);
  assert.match(schema, /competitor_scripts/);
});

test("includes creator collaboration workflow and live overview stats", async () => {
  const [page, collaborationApi, statsApi, schema] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/collaborations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stats/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /达人合作进度/);
  assert.match(page, /待建联/);
  assert.match(collaborationApi, /creatorCollaborations/);
  assert.match(statsApi, /SELECT COUNT/);
  assert.match(schema, /creator_collaborations/);
});

test("adds script and video review centers with versioned MP4 MOV storage", async () => {
  const [page, videoApi, workflow] = await Promise.all([
    readFile(new URL("../app/creative-workbench/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/creative-workbench-videos/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/workflow-schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /脚本审核中心/);
  assert.match(page, /脚本内容库/);
  assert.match(page, /视频审核中心/);
  assert.match(page, /视频内容库/);
  assert.match(page, /videoTypeText/);
  assert.match(page, /平台不设置业务大小上限/);
  assert.doesNotMatch(videoApi, /200 \* 1024 \* 1024/);
  assert.doesNotMatch(videoApi, /800 \* 1024 \* 1024/);
  assert.match(page, /multiple/);
  assert.match(videoApi, /video\/mp4/);
  assert.match(videoApi, /video\/quicktime/);
  assert.match(videoApi, /MAX\(version\)/);
  assert.match(workflow, /creative_work_media/);
});
