import type { MetricKey } from '@shared/dashboard.types';
export declare const metricSpecs: Record<MetricKey, {
    title: string;
    requirement: string;
    tables: string[];
    refreshPolicy: string;
}>;
export declare const reviewedSql: Record<MetricKey, string>;
