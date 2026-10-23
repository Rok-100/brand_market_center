export declare function isDirectMysqlConfigured(): boolean;
export declare function assertReadOnlySql(sql: string): void;
export declare function directMysqlQueryTimeoutMs(): number;
export declare function buildDirectMysqlQueryOptions(sql: string): {
    sql: string;
    timeout: number;
};
export declare function executeDirectSql<T extends Record<string, unknown>>(sql: string, limit?: number): Promise<{
    rows: T[];
    row_count: number;
    truncated: boolean;
}>;
export declare function closeDirectMysqlPool(): Promise<void>;
