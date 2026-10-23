import { type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { AiVideoCreditsResponse } from '@shared/api.interface';
import { AiVideoCreditsStore } from './ai-video-credits.store';
export declare class AiVideoCreditsService implements OnModuleInit, OnModuleDestroy {
    private readonly store;
    private readonly logger;
    private tenantToken;
    private responseCache;
    private scheduleTimer;
    private syncInFlight;
    constructor(store: AiVideoCreditsStore);
    onModuleInit(): Promise<void>;
    onModuleDestroy(): void;
    private scheduleNextRun;
    private getTenantToken;
    private readLive;
    private readSnapshot;
    private withStoredSnapshots;
    private syncLiveToStore;
    getOverview(forceRefresh?: boolean): Promise<AiVideoCreditsResponse>;
}
