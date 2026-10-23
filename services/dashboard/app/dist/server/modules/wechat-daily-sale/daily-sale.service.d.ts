import { type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { CreateDailySaleRequest, UpdateDailySaleRequest, DailySaleListResponse } from '@shared/daily-sale';
interface ListParams {
    startDate?: string;
    endDate?: string;
    page: number;
    pageSize: number;
}
export declare class DailySaleService {
    private readonly db;
    private readonly logger;
    constructor(db: PostgresJsDatabase);
    getList(params: ListParams): Promise<DailySaleListResponse>;
    create(dto: CreateDailySaleRequest): Promise<{
        id: string;
    }>;
    update(id: string, dto: UpdateDailySaleRequest): Promise<{
        success: boolean;
    }>;
    delete(id: string): Promise<{
        success: boolean;
    }>;
}
export {};
