interface McpCallOptions {
    maxAttempts?: number;
    timeoutMs?: number;
}
export declare function callMcpTool<T = unknown>(name: string, args: Record<string, unknown>, options?: McpCallOptions): Promise<T>;
export declare function resetMcpSessionPoolForTest(): void;
export declare function validateSql(sql: string): Promise<{
    valid: boolean;
    stage: string;
    reason: string;
}>;
export declare function executeSql<T extends Record<string, unknown>>(sql: string, limit?: number): Promise<{
    rows: T[];
    row_count: number;
    truncated: boolean;
}>;
/** 仅经营驾驶舱使用直连，避免数据库账号权限范围影响其他 MCP 数据模块。 */
export declare function executeCockpitSql<T extends Record<string, unknown>>(sql: string, limit?: number): Promise<{
    rows: T[];
    row_count: number;
    truncated: boolean;
}>;
export {};
