import type { MetricKey } from '@shared/dashboard.types';
export declare function readCache<T>(key: string): Promise<{
    payload: T;
    source: string;
} | null>;
export declare function readCacheAllowStale<T>(key: string, staleWindowMs: number): Promise<{
    payload: T;
    source: string;
    stale: boolean;
    expiresAt: number;
} | null>;
export declare function writeCache(key: string, payload: unknown, expiresAt: string, source?: string): Promise<void>;
export declare function readApprovedSql(_metricKey: MetricKey): Promise<any>;
