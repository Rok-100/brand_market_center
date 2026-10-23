import { type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { AiVideoCreditsResponse } from '@shared/api.interface';
import { type AiVideoCreditDailySnapshot } from './ai-video-credits.daily';
export declare class AiVideoCreditsStore {
    private readonly db;
    private readonly logger;
    private tableReady;
    constructor(db: PostgresJsDatabase);
    initialize(): Promise<void>;
    private ensureTable;
    persistResponse(response: AiVideoCreditsResponse): Promise<boolean>;
    readSnapshots(): Promise<AiVideoCreditDailySnapshot[]>;
}
