import type { AiVideoCreditPlatform, AiVideoCreditsResponse } from '@shared/api.interface';
export type AiVideoCreditDailyStatus = 'available' | 'partial' | 'unavailable';
export interface AiVideoCreditDailySnapshot {
    date: string;
    platform: AiVideoCreditPlatform;
    dailyCredits: number | null;
    cumulativeCredits: number | null;
    balanceCredits: number | null;
    reportedAccounts: number;
    trackedAccounts: number;
    status: AiVideoCreditDailyStatus;
    source: string;
    sourceRevision: number | null;
    sourceNote: string | null;
    collectedAt: string;
}
export declare function snapshotsFromResponse(response: AiVideoCreditsResponse): AiVideoCreditDailySnapshot[];
export declare function mergeDailySnapshots(response: AiVideoCreditsResponse, stored: AiVideoCreditDailySnapshot[]): AiVideoCreditsResponse;
export declare function millisecondsUntilNextShanghaiRun(now: number, hour?: number, minute?: number): number;
