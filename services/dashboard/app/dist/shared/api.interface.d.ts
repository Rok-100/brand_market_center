export type AiVideoCreditPlatform = 'kling' | 'libtv';
export type AiVideoCreditSourceMode = 'live' | 'mixed' | 'database' | 'snapshot';
export interface AiVideoCreditCoverage {
    credits: number | null;
    reportedAccounts: number;
    trackedAccounts: number;
    status?: 'available' | 'partial' | 'unavailable';
    balanceCredits?: number | null;
    collectedAt?: string | null;
    source?: string | null;
}
export interface AiVideoCreditTrendPoint {
    date: string;
    kling: AiVideoCreditCoverage;
    libtv: AiVideoCreditCoverage;
}
export interface AiVideoCreditAccount {
    platform: AiVideoCreditPlatform;
    center: string | null;
    accountId: string | null;
    accountName: string | null;
    owner: string | null;
    monthlyCredits: number | null;
    balanceSnapshotCredits: number | null;
}
export interface AiVideoCreditPlatformSummary {
    platform: AiVideoCreditPlatform;
    monthlyCredits: number | null;
    reportedAccounts: number;
    balanceSnapshotCredits: number | null;
    balanceReportedAccounts: number;
}
export interface AiVideoCreditSource {
    mode: AiVideoCreditSourceMode;
    spreadsheetTitle: string;
    sheetName: string;
    sheetId: string;
    range: string;
    revision: number | null;
    fetchedAt: string;
    dataThroughDate: string | null;
    sourceUrl: string;
    notice: string;
}
export interface AiVideoCreditsResponse {
    monthlyPeriod: string;
    summaries: AiVideoCreditPlatformSummary[];
    trends: AiVideoCreditTrendPoint[];
    accounts: AiVideoCreditAccount[];
    source: AiVideoCreditSource;
}
