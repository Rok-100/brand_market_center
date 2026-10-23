export const CALENDAR_STAGES = ["待拍摄", "已拍摄", "待发布", "已发布"];
export function chinaToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function validDate(value: string) {
  if (!value) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function overdueReasons(item: { stage: string; shootingDate: string; launchDate: string }, today = chinaToday()) {
  const reasons: string[] = [];
  if (item.shootingDate && item.shootingDate < today && !["已拍摄", "待发布", "已发布"].includes(item.stage)) reasons.push("拍摄日期已过，请确认拍摄进度");
  if (item.launchDate && item.launchDate < today && item.stage !== "已发布") reasons.push("发布日期已过，请确认上线进度");
  return reasons;
}
export function safeCalendarUrl(value: string) {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : ""; } catch { return ""; }
}
