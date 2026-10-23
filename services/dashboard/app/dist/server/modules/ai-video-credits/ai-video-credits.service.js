"use strict";
var AiVideoCreditsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiVideoCreditsService = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const ai_video_credits_daily_1 = require("./ai-video-credits.daily");
const ai_video_credits_parser_1 = require("./ai-video-credits.parser");
const ai_video_credits_snapshot_1 = require("./ai-video-credits.snapshot");
const ai_video_credits_store_1 = require("./ai-video-credits.store");
const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';
const SPREADSHEET_TOKEN = 'Rgj5sNTAQhhPpCtXcJBcglJAnrc';
const SHEET_ID = 'Y1s02K';
const READ_RANGE = 'A1:BM500';
const LIVE_CACHE_MS = 5 * 60 * 1000;
const FALLBACK_CACHE_MS = 60 * 1000;
const DAILY_SYNC_HOUR = 8;
const DAILY_SYNC_MINUTE = 0;
let AiVideoCreditsService = AiVideoCreditsService_1 = class AiVideoCreditsService {
    store;
    logger = new common_1.Logger(AiVideoCreditsService_1.name);
    tenantToken = null;
    responseCache = null;
    scheduleTimer = null;
    syncInFlight = null;
    constructor(store) {
        this.store = store;
    }
    async onModuleInit() {
        if (process.env.HUB_MIGRATION_VALIDATION === '1') return;
        await this.store.initialize();
        this.scheduleNextRun();
        const catchUpTimer = setTimeout(() => {
            void this.syncLiveToStore('startup').catch((error) => {
                this.logger.warn(`AI video credits startup catch-up unavailable: ${String(error)}`);
            });
        }, 2000);
        catchUpTimer.unref?.();
    }
    onModuleDestroy() {
        if (this.scheduleTimer)
            clearTimeout(this.scheduleTimer);
    }
    scheduleNextRun() {
        if (this.scheduleTimer)
            clearTimeout(this.scheduleTimer);
        const delay = (0, ai_video_credits_daily_1.millisecondsUntilNextShanghaiRun)(Date.now(), DAILY_SYNC_HOUR, DAILY_SYNC_MINUTE);
        this.scheduleTimer = setTimeout(() => {
            void this.syncLiveToStore('daily')
                .catch((error) => {
                this.logger.warn(`AI video credits 08:00 sync unavailable: ${String(error)}`);
            })
                .finally(() => this.scheduleNextRun());
        }, delay);
        this.scheduleTimer.unref?.();
    }
    async getTenantToken() {
        if (this.tenantToken && this.tenantToken.expiresAt > Date.now()) {
            return this.tenantToken.value;
        }
        const appId = process.env.FEISHU_AI_CREDITS_APP_ID?.trim() ||
            process.env.FEISHU_BRIEFING_APP_ID?.trim();
        const appSecret = process.env.FEISHU_AI_CREDITS_APP_SECRET?.trim() ||
            process.env.FEISHU_BRIEFING_APP_SECRET?.trim();
        if (!appId || !appSecret) {
            throw new Error('AI video credits app credentials are not configured');
        }
        const response = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
        });
        const payload = (await response.json());
        if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
            throw new Error(`AI video credits tenant token failed: ${payload.code ?? response.status}`);
        }
        const expiresInSeconds = Math.max(60, Number(payload.expire ?? 7200) - 60);
        this.tenantToken = {
            value: payload.tenant_access_token,
            expiresAt: Date.now() + expiresInSeconds * 1000,
        };
        return this.tenantToken.value;
    }
    async readLive() {
        const token = await this.getTenantToken();
        const toolInput = JSON.stringify({
            excel_id: SPREADSHEET_TOKEN,
            max_chars: 500000,
            max_rows: 1000000000,
            range: READ_RANGE,
            sheet_id: SHEET_ID,
        });
        const response = await fetch(`${FEISHU_API_BASE}/sheet_ai/v2/spreadsheets/${SPREADSHEET_TOKEN}/tools/invoke_read`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify({
                tool_name: 'get_range_as_csv',
                input: toolInput,
            }),
        });
        const payload = (await response.json());
        if (!response.ok || payload.code !== 0 || !payload.data?.output) {
            throw new Error(`AI video credits sheet read failed: ${payload.code ?? response.status}`);
        }
        const output = JSON.parse(payload.data.output);
        if (!output.annotated_csv) {
            throw new Error('AI video credits sheet returned no CSV data');
        }
        if (output.has_more) {
            throw new Error('AI video credits sheet response is truncated');
        }
        return (0, ai_video_credits_parser_1.parseAiVideoCredits)({
            annotatedCsv: output.annotated_csv,
            range: output.actual_range || output.current_region || READ_RANGE,
            revision: Number.isFinite(output.revision)
                ? Number(output.revision)
                : null,
            fetchedAt: new Date().toISOString(),
            mode: 'live',
        });
    }
    readSnapshot() {
        return (0, ai_video_credits_parser_1.parseAiVideoCredits)({
            annotatedCsv: ai_video_credits_snapshot_1.AI_VIDEO_CREDITS_SNAPSHOT_CSV,
            range: ai_video_credits_snapshot_1.AI_VIDEO_CREDITS_SNAPSHOT_RANGE,
            revision: ai_video_credits_snapshot_1.AI_VIDEO_CREDITS_SNAPSHOT_REVISION,
            fetchedAt: ai_video_credits_snapshot_1.AI_VIDEO_CREDITS_SNAPSHOT_FETCHED_AT,
            mode: 'snapshot',
        });
    }
    async withStoredSnapshots(response) {
        const stored = await this.store.readSnapshots();
        return (0, ai_video_credits_daily_1.mergeDailySnapshots)(response, stored);
    }
    syncLiveToStore(reason) {
        if (this.syncInFlight)
            return this.syncInFlight;
        this.syncInFlight = this.readLive()
            .then(async (response) => {
            const persisted = await this.store.persistResponse(response);
            const merged = await this.withStoredSnapshots(response);
            this.responseCache = {
                value: merged,
                expiresAt: Date.now() + LIVE_CACHE_MS,
            };
            if (persisted) {
                this.logger.log(`AI video credits ${reason} snapshot stored through ${merged.source.dataThroughDate ?? 'unavailable'}`);
            }
            else {
                this.logger.warn(`AI video credits ${reason} live read completed, but daily snapshot persistence is unavailable`);
            }
            return merged;
        })
            .finally(() => {
            this.syncInFlight = null;
        });
        return this.syncInFlight;
    }
    async getOverview(forceRefresh = false) {
        if (!forceRefresh &&
            this.responseCache &&
            this.responseCache.expiresAt > Date.now()) {
            return this.responseCache.value;
        }
        try {
            return await this.syncLiveToStore('request');
        }
        catch (error) {
            const detail = error instanceof Error ? error.stack || error.message : String(error);
            this.logger.warn(`AI video credits live read unavailable; using verified snapshot. ${detail}`);
            const snapshotResponse = await this.withStoredSnapshots(this.readSnapshot());
            this.responseCache = {
                value: snapshotResponse,
                expiresAt: Date.now() + FALLBACK_CACHE_MS,
            };
            return snapshotResponse;
        }
    }
};
exports.AiVideoCreditsService = AiVideoCreditsService;
exports.AiVideoCreditsService = AiVideoCreditsService = AiVideoCreditsService_1 = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__metadata("design:paramtypes", [ai_video_credits_store_1.AiVideoCreditsStore])
], AiVideoCreditsService);
