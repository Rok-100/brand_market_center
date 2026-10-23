import { type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { CreateDailyAdqRequest, UpdateDailyAdqRequest, DailyAdqListResponse } from '@shared/daily-adq';
interface ListParams {
    startDate?: string;
    endDate?: string;
    page: number;
    pageSize: number;
}
export declare class DailyAdqService {
    private readonly db;
    private readonly logger;
    constructor(db: PostgresJsDatabase);
    getList(params: ListParams): Promise<DailyAdqListResponse>;
    create(dto: CreateDailyAdqRequest): Promise<{
        id: string;
    }>;
    update(id: string, dto: UpdateDailyAdqRequest): Promise<{
        success: boolean;
    }>;
    delete(id: string): Promise<{
        success: boolean;
    }>;
}
export {};
