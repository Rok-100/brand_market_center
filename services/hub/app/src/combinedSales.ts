import { businessDate } from "./businessDate";
import type { OmnichannelRealtimeOverview, OmnichannelRealtimePoint } from "./types";

export type CombinedSalesPoint = {
  hour: number;
  today: number | null;
  yesterday: number | null;
  todayDouyin: number | null;
  todayWechat: number | null;
  yesterdayDouyin: number | null;
  yesterdayWechat: number | null;
};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const moneySum = (a: number, b: number) => Math.round((a + b) * 100) / 100;
const hourValid = (hour: unknown): hour is number => finite(hour) && Number.isInteger(hour) && hour >= 0 && hour <= 23;
const completePoint = (point: OmnichannelRealtimePoint | undefined, day: "today" | "yesterday") =>
  !!point && finite(point[`${day}HourlyYuan`]) && finite(point[`${day}CumulativeYuan`]);

/** Sum only aligned, consecutive complete hours. Missing is never zero. */
export function combineSales(data: OmnichannelRealtimeOverview, now = Date.now()) {
  const pending = (reason: string) => ({ reason, todayDate: null as string | null, yesterdayDate: null as string | null,
    throughHour: null as number | null, today: null as number | null, yesterday: null as number | null,
    delta: null as number | null, percent: null as number | null, points: [] as CombinedSalesPoint[] });
  const douyin = data.channels.filter(channel => channel.key === "douyin");
  const wechat = data.channels.filter(channel => channel.key === "wechat");
  if (douyin.length !== 1 || wechat.length !== 1) return pending("抖音与视频号数据尚未齐全，暂不合计。请稍后刷新。");
  const channels = [douyin[0], wechat[0]];
  if (channels.some(channel => channel.unavailableReason || ["missing", "pending"].includes(channel.state)))
    return pending("有渠道数据待更新，暂不合计。请稍后刷新。");
  const todayDate = businessDate(channels[0].todayDate), yesterdayDate = businessDate(channels[0].yesterdayDate);
  if (!todayDate || !yesterdayDate || channels.some(channel => channel.todayDate !== todayDate || channel.yesterdayDate !== yesterdayDate)
    || Date.parse(todayDate) - Date.parse(yesterdayDate) !== 86400_000)
    return pending("两个渠道的对比日期未对齐，暂不合计。请稍后刷新。");
  const localNow = new Date(now + 8 * 3600_000);
  const currentDate = localNow.toISOString().slice(0, 10);
  if (todayDate > currentDate) return pending("业务日期待核验，暂不合计。");
  const hours = channels.map(channel => channel.comparisonThroughHour);
  if (!hours.every(hourValid)) return pending("两个渠道的完整小时数据待更新，暂不合计。");
  const limit = Math.min(...hours as number[], todayDate === currentDate ? localNow.getUTCHours() - 1 : 23);
  const indexed = channels.map(channel => {
    const map = new Map<number, OmnichannelRealtimePoint>();
    for (const point of channel.points) {
      if (!hourValid(point.hour) || map.has(point.hour)) return null;
      map.set(point.hour, point);
    }
    return map;
  });
  if (indexed.some(map => map === null)) return pending("小时数据存在重复或异常，暂不合计。请稍后刷新。");
  let todayContinuous = true, yesterdayContinuous = true, throughHour: number | null = null;
  const points = Array.from({ length: 24 }, (_, hour): CombinedSalesPoint => {
    const a = indexed[0]!.get(hour), b = indexed[1]!.get(hour);
    yesterdayContinuous = yesterdayContinuous && completePoint(a, "yesterday") && completePoint(b, "yesterday");
    todayContinuous = todayContinuous && hour <= limit && yesterdayContinuous && completePoint(a, "today") && completePoint(b, "today");
    if (todayContinuous) throughHour = hour;
    const todayDouyin = todayContinuous ? a!.todayCumulativeYuan! : null;
    const todayWechat = todayContinuous ? b!.todayCumulativeYuan! : null;
    const yesterdayDouyin = yesterdayContinuous ? a!.yesterdayCumulativeYuan! : null;
    const yesterdayWechat = yesterdayContinuous ? b!.yesterdayCumulativeYuan! : null;
    return { hour, todayDouyin, todayWechat, yesterdayDouyin, yesterdayWechat,
      today: todayContinuous ? moneySum(todayDouyin!, todayWechat!) : null,
      yesterday: yesterdayContinuous ? moneySum(yesterdayDouyin!, yesterdayWechat!) : null };
  });
  if (throughHour === null) return { ...pending("两个渠道尚无共同的完整时段，数据更新后自动展示。"), todayDate, yesterdayDate, points };
  const last = points[throughHour], today = last.today!, yesterday = last.yesterday!;
  const delta = Math.round((today - yesterday) * 100) / 100;
  return { reason: "", todayDate, yesterdayDate, throughHour, today, yesterday, delta,
    percent: yesterday > 0 ? delta / yesterday * 100 : null, points };
}
