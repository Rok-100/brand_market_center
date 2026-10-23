import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source = ts.transpileModule(fs.readFileSync(new URL("../lib/calendar.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { chinaToday, overdueReasons, validDate, safeCalendarUrl } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
test("Reminders use owner-scoped bottom-right popup only, no global banner", () => {
  const page = fs.readFileSync(new URL("../app/creative-workbench/page.tsx", import.meta.url), "utf8");
  assert.ok(!page.includes('className="cw-calendar-alert"'));
  assert.ok(page.includes('className="cw-overdue-toast"'));
  assert.ok(page.includes('entry.ownerId === data?.user.id : entry.owner === data?.user.name'));
});
test("Shanghai midnight and date-only expiry", () => {
  assert.equal(chinaToday(new Date("2026-09-15T16:01:00Z")), "2026-09-16");
  assert.equal(overdueReasons({ stage: "待拍摄", shootingDate: "2026-09-16", launchDate: "" }, "2026-09-16").length, 0);
  assert.equal(overdueReasons({ stage: "待拍摄", shootingDate: "2026-09-15", launchDate: "2026-09-15" }, "2026-09-16").length, 2);
});
test("No prelaunch reminder; confirmed completed milestones clear reminders", () => {
  assert.equal(overdueReasons({ stage: "待发布", shootingDate: "2026-09-10", launchDate: "2026-09-18" }, "2026-09-16").length, 0);
  assert.equal(overdueReasons({ stage: "已发布", shootingDate: "2026-09-10", launchDate: "2026-09-11" }, "2026-09-16").length, 0);
  assert.equal(overdueReasons({ stage: "已拍摄", shootingDate: "2026-09-10", launchDate: "" }, "2026-09-16").length, 0);
  assert.equal(overdueReasons({ stage: "已完成", shootingDate: "2026-09-10", launchDate: "" }, "2026-09-16").length, 1);
});
test("Invalid calendar dates and unsafe links rejected", () => {
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(safeCalendarUrl("javascript:alert(1)"), "");
  assert.equal(safeCalendarUrl("https://example.com/video"), "https://example.com/video");
});
test("Isolated local API creates, previews, detects duplicates and preserves associations", { skip: !process.env.CALENDAR_TEST_BASE }, async () => {
  const base = process.env.CALENDAR_TEST_BASE;
  assert.match(base, /^http:\/\/127\.0\.0\.1:3217$/);
  const call = async (method, body) => {
    const response = await fetch(base + "/api/collaborations", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const input = { creatorName: "自动测试-" + Date.now(), product: "眼膜", materialType: "付费KOC原片", shootingDate: "2026-09-15", finishedDate: "2026-09-16", launchDate: "2026-09-17", stage: "待拍摄", linkedItemIds: '["test-script"]' };
  const preview = await call("POST", { items: [input], preview: true });
  assert.equal(preview.data.plan[0].action, "新增");
  const created = await call("POST", input);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.items[0].id;
  try {
    const dupe = await call("POST", input);
    assert.equal(dupe.status, 409);
    const update = await call("PATCH", { id, stage: "已拍摄", actualShootingDate: "2026-09-15" });
    assert.equal(update.status, 200, JSON.stringify(update.data));
    assert.equal(update.data.item.linkedItemIds, '["test-script"]');
    assert.equal(update.data.item.finishedDate, "2026-09-16");
    const invalid = await call("PATCH", { id, launchDate: "2026-02-30" });
    assert.equal(invalid.status, 400);
    const bulk = await call("POST", { upsert: true, items: [{ id, stage: "待发布" }] });
    assert.equal(bulk.status, 201, JSON.stringify(bulk.data));
    assert.equal(bulk.data.items[0].linkedItemIds, '["test-script"]');
  } finally { await fetch(base + "/api/collaborations?id=" + id, { method: "DELETE" }); }
});
