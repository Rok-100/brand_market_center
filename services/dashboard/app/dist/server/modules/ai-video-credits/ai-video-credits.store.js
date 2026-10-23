"use strict";
var AiVideoCreditsStore_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiVideoCreditsStore = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const fullstack_nestjs_core_1 = require("@lark-apaas/fullstack-nestjs-core");
const drizzle_orm_1 = require("drizzle-orm");
const ai_video_credits_daily_1 = require("./ai-video-credits.daily");
function numberOrNull(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
}
function dateText(value) {
    return value instanceof Date
        ? value.toISOString().slice(0, 10)
        : String(value).slice(0, 10);
}
function timestampText(value) {
    return value instanceof Date ? value.toISOString() : String(value);
}
let AiVideoCreditsStore = AiVideoCreditsStore_1 = class AiVideoCreditsStore {
    db;
    logger = new common_1.Logger(AiVideoCreditsStore_1.name);
    tableReady = false;
    constructor(db) {
        this.db = db;
    }
    async initialize() {
        await this.ensureTable();
    }
    async ensureTable() {
        try {
            await this.db.execute(drizzle_orm_1.sql.raw(`
        SELECT 1
        FROM ai_video_credit_daily_snapshot
        LIMIT 1
      `));
            this.tableReady = true;
            return;
        }
        catch {
            // Local/dev first run may need to create the table. Production normally
            // receives it through the application schema during release.
        }
        try {
            await this.db.execute(drizzle_orm_1.sql.raw(`
        CREATE TABLE IF NOT EXISTS ai_video_credit_daily_snapshot (
          data_date date NOT NULL,
          platform varchar(16) NOT NULL,
          daily_credits numeric,
          cumulative_credits numeric,
          balance_credits numeric,
          reported_accounts integer NOT NULL DEFAULT 0,
          tracked_accounts integer NOT NULL DEFAULT 0,
          status varchar(24) NOT NULL,
          source varchar(32) NOT NULL,
          source_revision integer,
          source_note text,
          collected_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (data_date, platform),
          CONSTRAINT ai_video_credit_daily_platform_check
            CHECK (platform IN ('kling', 'libtv')),
          CONSTRAINT ai_video_credit_daily_status_check
            CHECK (status IN ('available', 'partial', 'unavailable'))
        )
      `));
            await this.db.execute(drizzle_orm_1.sql.raw(`
        CREATE INDEX IF NOT EXISTS idx_ai_video_credit_daily_collected_at
          ON ai_video_credit_daily_snapshot (collected_at DESC)
      `));
            this.tableReady = true;
        }
        catch (error) {
            this.tableReady = false;
            this.logger.warn(`AI video credits snapshot table unavailable: ${String(error)}`);
        }
    }
    async persistResponse(response) {
        if (response.source.mode !== 'live')
            return false;
        if (!this.tableReady)
            await this.ensureTable();
        if (!this.tableReady)
            return false;
        const rows = (0, ai_video_credits_daily_1.snapshotsFromResponse)(response);
        if (!rows.length)
            return false;
        const payload = JSON.stringify(rows.map((item) => ({
            data_date: item.date,
            platform: item.platform,
            daily_credits: item.dailyCredits,
            cumulative_credits: item.cumulativeCredits,
            balance_credits: item.balanceCredits,
            reported_accounts: item.reportedAccounts,
            tracked_accounts: item.trackedAccounts,
            status: item.status,
            source: item.source,
            source_revision: item.sourceRevision,
            source_note: item.sourceNote,
            collected_at: item.collectedAt,
        })));
        try {
            await this.db.execute((0, drizzle_orm_1.sql) `
        WITH incoming AS (
          SELECT *
          FROM jsonb_to_recordset(${payload}::jsonb) AS item(
            data_date text,
            platform text,
            daily_credits numeric,
            cumulative_credits numeric,
            balance_credits numeric,
            reported_accounts integer,
            tracked_accounts integer,
            status text,
            source text,
            source_revision integer,
            source_note text,
            collected_at timestamptz
          )
        )
        INSERT INTO ai_video_credit_daily_snapshot (
          data_date, platform, daily_credits, cumulative_credits,
          balance_credits, reported_accounts, tracked_accounts, status,
          source, source_revision, source_note, collected_at, updated_at
        )
        SELECT
          data_date::date, platform, daily_credits, cumulative_credits,
          balance_credits, reported_accounts, tracked_accounts, status,
          source, source_revision, source_note, collected_at, CURRENT_TIMESTAMP
        FROM incoming
        ON CONFLICT (data_date, platform)
        DO UPDATE SET
          daily_credits = COALESCE(
            EXCLUDED.daily_credits,
            ai_video_credit_daily_snapshot.daily_credits
          ),
          cumulative_credits = COALESCE(
            EXCLUDED.cumulative_credits,
            ai_video_credit_daily_snapshot.cumulative_credits
          ),
          balance_credits = COALESCE(
            EXCLUDED.balance_credits,
            ai_video_credit_daily_snapshot.balance_credits
          ),
          reported_accounts = CASE
            WHEN EXCLUDED.daily_credits IS NULL
              AND ai_video_credit_daily_snapshot.daily_credits IS NOT NULL
              THEN ai_video_credit_daily_snapshot.reported_accounts
            ELSE EXCLUDED.reported_accounts
          END,
          tracked_accounts = GREATEST(
            ai_video_credit_daily_snapshot.tracked_accounts,
            EXCLUDED.tracked_accounts
          ),
          status = CASE
            WHEN EXCLUDED.daily_credits IS NULL
              AND ai_video_credit_daily_snapshot.daily_credits IS NOT NULL
              THEN ai_video_credit_daily_snapshot.status
            ELSE EXCLUDED.status
          END,
          source = CASE
            WHEN EXCLUDED.daily_credits IS NULL
              AND ai_video_credit_daily_snapshot.daily_credits IS NOT NULL
              THEN ai_video_credit_daily_snapshot.source
            ELSE EXCLUDED.source
          END,
          source_revision = COALESCE(
            EXCLUDED.source_revision,
            ai_video_credit_daily_snapshot.source_revision
          ),
          source_note = COALESCE(
            EXCLUDED.source_note,
            ai_video_credit_daily_snapshot.source_note
          ),
          collected_at = CASE
            WHEN EXCLUDED.daily_credits IS NULL
              AND ai_video_credit_daily_snapshot.daily_credits IS NOT NULL
              THEN ai_video_credit_daily_snapshot.collected_at
            ELSE EXCLUDED.collected_at
          END,
          updated_at = CURRENT_TIMESTAMP
      `);
            return true;
        }
        catch (error) {
            this.tableReady = false;
            this.logger.warn(`AI video credits snapshot write failed: ${String(error)}`);
            return false;
        }
    }
    async readSnapshots() {
        if (!this.tableReady)
            return [];
        try {
            const result = await this.db.execute((0, drizzle_orm_1.sql) `
        SELECT
          data_date, platform, daily_credits, cumulative_credits,
          balance_credits, reported_accounts, tracked_accounts, status,
          source, source_revision, source_note, collected_at
        FROM ai_video_credit_daily_snapshot
        ORDER BY data_date, platform
      `);
            return result
                .filter((row) => row.platform === 'kling' || row.platform === 'libtv')
                .map((row) => ({
                date: dateText(row.data_date),
                platform: row.platform,
                dailyCredits: numberOrNull(row.daily_credits),
                cumulativeCredits: numberOrNull(row.cumulative_credits),
                balanceCredits: numberOrNull(row.balance_credits),
                reportedAccounts: Number(row.reported_accounts) || 0,
                trackedAccounts: Number(row.tracked_accounts) || 0,
                status: row.status,
                source: row.source,
                sourceRevision: numberOrNull(row.source_revision),
                sourceNote: row.source_note,
                collectedAt: timestampText(row.collected_at),
            }));
        }
        catch (error) {
            this.tableReady = false;
            this.logger.warn(`AI video credits snapshot read failed: ${String(error)}`);
            return [];
        }
    }
};
exports.AiVideoCreditsStore = AiVideoCreditsStore;
exports.AiVideoCreditsStore = AiVideoCreditsStore = AiVideoCreditsStore_1 = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__param(0, (0, common_1.Inject)(fullstack_nestjs_core_1.DRIZZLE_DATABASE)),
    tslib_1.__metadata("design:paramtypes", [Function])
], AiVideoCreditsStore);
