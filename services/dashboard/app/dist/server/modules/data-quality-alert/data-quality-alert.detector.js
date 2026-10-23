"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quarterLabel = quarterLabel;
exports.detectOrderGaps = detectOrderGaps;
const MIN_BASELINE_DAYS = 3;
const MIN_COMPLETE_BUCKETS = 80;
const MIN_BASELINE_ORDERS = 20;
const MIN_CONSECUTIVE_BUCKETS = 3;
function median(values) {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}
function sum(values) {
    return values.reduce((total, value) => total + value, 0);
}
function quarterLabel(quarterIndex) {
    const minutes = Math.max(0, Math.min(95, quarterIndex)) * 15;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
function detectOrderGaps(rows, targetDate, cutoffQuarter = 95) {
    const byDate = new Map();
    for (const row of rows) {
        const day = byDate.get(row.date) || new Map();
        day.set(row.quarterIndex, row);
        byDate.set(row.date, day);
    }
    const target = byDate.get(targetDate) || new Map();
    const baselineDates = [...byDate.entries()]
        .filter(([date, buckets]) => date < targetDate && buckets.size >= MIN_COMPLETE_BUCKETS)
        .map(([date]) => date)
        .sort()
        .slice(-7);
    if (baselineDates.length < MIN_BASELINE_DAYS)
        return [];
    const abnormal = [];
    for (let quarterIndex = 0; quarterIndex <= Math.min(95, cutoffQuarter); quarterIndex += 1) {
        const actual = target.get(quarterIndex);
        const baselineRows = baselineDates
            .map((date) => byDate.get(date)?.get(quarterIndex))
            .filter((row) => Boolean(row));
        if (baselineRows.length < MIN_BASELINE_DAYS)
            continue;
        const baselineOrders = median(baselineRows.map((row) => row.effectiveOrders));
        const baselineGsvYuan = median(baselineRows.map((row) => row.effectiveGsvYuan));
        const actualOrders = actual?.effectiveOrders || 0;
        const actualGsvYuan = actual?.effectiveGsvYuan || 0;
        const orderFloor = Math.max(2, Math.floor(baselineOrders * 0.1));
        const isAbruptGap = baselineOrders >= MIN_BASELINE_ORDERS
            && actualOrders <= orderFloor
            && actualGsvYuan <= baselineGsvYuan * 0.15;
        if (isAbruptGap) {
            abnormal.push({
                quarterIndex,
                actualOrders,
                baselineOrders,
                actualGsvYuan,
                baselineGsvYuan,
            });
        }
    }
    const groups = [];
    for (const item of abnormal) {
        const group = groups.at(-1);
        if (group?.at(-1)?.quarterIndex === item.quarterIndex - 1)
            group.push(item);
        else
            groups.push([item]);
    }
    return groups
        .filter((group) => group.length >= MIN_CONSECUTIVE_BUCKETS)
        .map((group) => ({
        date: targetDate,
        startQuarter: group[0].quarterIndex,
        endQuarter: group.at(-1).quarterIndex,
        actualOrders: sum(group.map((item) => item.actualOrders)),
        baselineOrders: Math.round(sum(group.map((item) => item.baselineOrders))),
        actualGsvYuan: sum(group.map((item) => item.actualGsvYuan)),
        baselineGsvYuan: sum(group.map((item) => item.baselineGsvYuan)),
        estimatedMissingGsvYuan: sum(group.map((item) => Math.max(0, item.baselineGsvYuan - item.actualGsvYuan))),
        baselineDayCount: baselineDates.length,
    }));
}
