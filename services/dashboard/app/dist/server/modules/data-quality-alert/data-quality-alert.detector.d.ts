export type QuarterBucket = {
    date: string;
    quarterIndex: number;
    effectiveOrders: number;
    effectiveGsvYuan: number;
};
export type OrderGapAlert = {
    date: string;
    startQuarter: number;
    endQuarter: number;
    actualOrders: number;
    baselineOrders: number;
    actualGsvYuan: number;
    baselineGsvYuan: number;
    estimatedMissingGsvYuan: number;
    baselineDayCount: number;
};
export declare function quarterLabel(quarterIndex: number): string;
export declare function detectOrderGaps(rows: QuarterBucket[], targetDate: string, cutoffQuarter?: number): OrderGapAlert[];
