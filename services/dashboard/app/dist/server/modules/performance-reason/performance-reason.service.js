"use strict";
var PerformanceReasonService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerformanceReasonService = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const fullstack_nestjs_core_1 = require("@lark-apaas/fullstack-nestjs-core");
const drizzle_orm_1 = require("drizzle-orm");
const director_briefing_service_1 = require("../director-briefing/director-briefing.service");
const SOURCE_NAME = 'WIS项目数据群';
const SOURCE_CHAT_ID = 'oc_934b947c15572b4427bc9e91c6817ba9';
const SCHEDULE_HOUR = 8;
const SCHEDULE_MINUTE = 55;
const DAY_MS = 86400000;
// Stored summaries created before this classifier revision may contain
// brand-wide/e-commerce notes that were incorrectly assigned to Douyin.
// Treat them as stale so the first request rebuilds the requested dates.
const CHANNEL_CLASSIFIER_UPDATED_AT = Date.parse('2026-08-13T08:30:00.000Z');
function addDays(date, days) {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
function dateRange(startDate, endDate) {
    const dates = [];
    for (let date = startDate; date <= endDate; date = addDays(date, 1))
        dates.push(date);
    return dates;
}
function timeText(value) {
    if (!value)
        return null;
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function messageTime(message) {
    const raw = Number(message.create_time || 0);
    if (!raw)
        return null;
    return new Date(raw < 1e12 ? raw * 1000 : raw).toISOString();
}
let PerformanceReasonService = PerformanceReasonService_1 = class PerformanceReasonService {
    db;
    directorBriefingService;
    logger = new common_1.Logger(PerformanceReasonService_1.name);
    memoryCache = new Map();
    tableReady = false;
    scheduleTimer = null;
    writeAttempts = 0;
    writeSuccesses = 0;
    lastWriteError = null;
    constructor(db, directorBriefingService) {
        this.db = db;
        this.directorBriefingService = directorBriefingService;
    }
    async onModuleInit() {
        if (process.env.HUB_MIGRATION_VALIDATION === '1') return;
        await this.initialize();
    }
    onModuleDestroy() {
        if (this.scheduleTimer)
            clearTimeout(this.scheduleTimer);
    }
    async initialize() {
        await this.ensureTable();
        this.scheduleNextRun();
        const latestEligible = this.latestEligibleDate();
        setTimeout(() => {
            void this.aggregateDates([latestEligible]).catch((error) => {
                this.logger.warn(`08:55 reason catch-up failed: ${String(error)}`);
            });
        }, 2000).unref?.();
    }
    async ensureTable() {
        // Production database roles can read/write application tables but may not
        // have schema DDL privileges. Probe the pre-provisioned table first so a
        // harmless CREATE TABLE permission failure cannot disable persistence.
        try {
            await this.db.execute(drizzle_orm_1.sql.raw(`
        SELECT 1
        FROM performance_fluctuation_reason
        LIMIT 1
      `));
            this.tableReady = true;
            return;
        }
        catch {
            // The table is created below for local/test environments and first runs.
        }
        try {
            await this.db.execute(drizzle_orm_1.sql.raw(`
        CREATE TABLE IF NOT EXISTS performance_fluctuation_reason (
          data_date date NOT NULL,
          channel varchar(16) NOT NULL,
          status varchar(24) NOT NULL,
          summary text,
          source_name varchar(128) NOT NULL DEFAULT 'WIS项目数据群',
          source_chat_id varchar(128) NOT NULL,
          source_message_ids text NOT NULL DEFAULT '[]',
          source_latest_at timestamptz,
          aggregated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (data_date, channel),
          CONSTRAINT performance_fluctuation_reason_channel_check
            CHECK (channel IN ('douyin', 'wechat')),
          CONSTRAINT performance_fluctuation_reason_status_check
            CHECK (status IN ('available', 'not_mentioned'))
        )
      `));
            await this.db.execute(drizzle_orm_1.sql.raw(`
        CREATE INDEX IF NOT EXISTS idx_performance_fluctuation_reason_aggregated_at
          ON performance_fluctuation_reason (aggregated_at DESC)
      `));
            this.tableReady = true;
        }
        catch (error) {
            this.tableReady = false;
            this.logger.warn(`performance reason table unavailable; using live memory cache: ${String(error)}`);
        }
    }
    shanghaiToday(now = Date.now()) {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date(now));
    }
    latestEligibleDate(now = Date.now()) {
        const today = this.shanghaiToday(now);
        const todayCutoff = Date.parse(`${today}T08:55:00+08:00`);
        return addDays(today, now >= todayCutoff ? -1 : -2);
    }
    eligible(date, now = Date.now()) {
        return now >= Date.parse(`${addDays(date, 1)}T08:55:00+08:00`);
    }
    scheduleNextRun() {
        if (this.scheduleTimer)
            clearTimeout(this.scheduleTimer);
        const today = this.shanghaiToday();
        const now = Date.now();
        let next = Date.parse(`${today}T${String(SCHEDULE_HOUR).padStart(2, '0')}:${String(SCHEDULE_MINUTE).padStart(2, '0')}:00+08:00`);
        if (next <= now)
            next += DAY_MS;
        this.scheduleTimer = setTimeout(() => {
            const dataDate = addDays(this.shanghaiToday(), -1);
            void this.aggregateDates([dataDate], true)
                .catch((error) => this.logger.error(`08:55 performance reason aggregation failed: ${String(error)}`))
                .finally(() => this.scheduleNextRun());
        }, Math.max(1000, next - now));
        this.scheduleTimer.unref?.();
    }
    cacheKey(date, channel) {
        return `${date}:${channel}`;
    }
    dateText(value) {
        return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
    }
    rowToItem(row) {
        let messageIds = [];
        try {
            const parsed = JSON.parse(row.source_message_ids || '[]');
            if (Array.isArray(parsed))
                messageIds = parsed.map(String);
        }
        catch {
            messageIds = [];
        }
        return {
            date: this.dateText(row.data_date),
            channel: row.channel,
            status: row.status,
            summary: row.summary,
            sourceName: SOURCE_NAME,
            sourceMessageIds: messageIds,
            sourceLatestAt: timeText(row.source_latest_at),
            aggregatedAt: timeText(row.aggregated_at),
        };
    }
    async readStored(startDate, endDate) {
        if (!this.tableReady)
            return [];
        try {
            const result = await this.db.execute((0, drizzle_orm_1.sql) `
        SELECT data_date, channel, status, summary, source_message_ids,
               source_latest_at, aggregated_at
        FROM performance_fluctuation_reason
        WHERE data_date >= ${startDate}::date
          AND data_date <= ${endDate}::date
        ORDER BY data_date, channel
      `);
            return result
                .map((row) => this.rowToItem(row))
                .filter((item) => {
                const aggregatedAt = item.aggregatedAt ? Date.parse(item.aggregatedAt) : Number.NaN;
                return Number.isFinite(aggregatedAt) && aggregatedAt >= CHANNEL_CLASSIFIER_UPDATED_AT;
            });
        }
        catch (error) {
            this.tableReady = false;
            this.logger.warn(`performance reason read failed; using live cache: ${String(error)}`);
            return [];
        }
    }
    async storageStatus() {
        if (!this.tableReady) {
            return {
                ready: false,
                database: null,
                schema: null,
                rowCount: null,
                writeAttempts: this.writeAttempts,
                writeSuccesses: this.writeSuccesses,
                lastWriteError: this.lastWriteError,
            };
        }
        try {
            const result = await this.db.execute((0, drizzle_orm_1.sql) `
        SELECT current_database() AS database_name,
               current_schema() AS schema_name,
               COUNT(*)::int AS row_count
        FROM performance_fluctuation_reason
      `);
            const row = result[0];
            return {
                ready: true,
                database: row?.database_name || null,
                schema: row?.schema_name || null,
                rowCount: row ? Number(row.row_count) : 0,
                writeAttempts: this.writeAttempts,
                writeSuccesses: this.writeSuccesses,
                lastWriteError: this.lastWriteError,
            };
        }
        catch (error) {
            this.logger.warn(`performance reason storage probe failed: ${String(error)}`);
            return {
                ready: false,
                database: null,
                schema: null,
                rowCount: null,
                writeAttempts: this.writeAttempts,
                writeSuccesses: this.writeSuccesses,
                lastWriteError: this.lastWriteError,
            };
        }
    }
    messageMatchesDate(text, date) {
        const [year, monthText, dayText] = date.split('-');
        const month = Number(monthText);
        const day = Number(dayText);
        const variants = [
            `${year}-${monthText}-${dayText}`,
            `${year}/${month}/${day}`,
            `${month}\\.${day}`,
            `${month}/${day}`,
            `${month}月${day}日?`,
        ];
        return variants.some((variant) => new RegExp(`(^|[^\\d])${variant}(?=$|[^\\d])`).test(text));
    }
    detectChannels(text) {
        const channels = [];
        if (/视频号|微信小店|微信豆|\bADQ\b|海豚智投/i.test(text))
            channels.push('wechat');
        if (/抖店|抖音|千川/.test(text))
            channels.push('douyin');
        if (channels.length === 0) {
            const header = text.match(/【([^】]{1,80})】/)?.[1] || '';
            const isDouyinProductReport = /WIS\s*(?:水润|眼膜|黑晶|次抛|燕窝|凝颜|乳糖酸)/i.test(header);
            const isOtherChannelOrBrandWide = /电商|品牌|全渠道|天猫|京东|快手|拼多多|唯品会|得物|小红书|KOC|达播|线下/.test(header);
            if (isDouyinProductReport && !isOtherChannelOrBrandWide)
                channels.push('douyin');
        }
        return channels;
    }
    cleanMessageText(message) {
        return this.directorBriefingService.briefingMessageText(message)
            .replace(/https?:\/\/\S+/gi, '')
            .replace(/<at\b[^>]*>.*?<\/at>/gi, '')
            .replace(/@_[a-z0-9_]+/gi, '')
            .replace(/\b(?:ou|om)_[a-z0-9_]+\b/gi, '')
            .replace(/\b(?:bold|italic|underline)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    reasonClauses(text) {
        const withoutHeader = text.replace(/^.*?【[^】]{1,60}】\s*/, '');
        const strongSignal = /(原因|来源于|起量|放量|跑出|上涨|增长|提升|回落|下降|下滑|掉量|减少|卡审|下架|封禁|暂停|恢复|退款|预售|素材|直播|活动|大促|缺货|库存|夸大|不实|异常|波动|导致|贡献|换房|讲师|上新|新品)/i;
        const clauses = withoutHeader
            .split(/[；。\n]+/)
            .map((part) => part.trim())
            .filter((part) => part.length >= 4 && strongSignal.test(part))
            .map((part) => part
            .replace(/^营收(?:约)?[\d.]+\s*(?:w|万)?(?:元)?(?:\([^)]*\))?[，,：:]?\s*/i, '')
            .replace(/^成交(?:约)?[\d.]+\s*(?:w|万)?(?:元)?[，,：:]?\s*/i, '')
            .replace(/\s+/g, ' ')
            .trim())
            .filter((part) => part && !/^占比(?:正常|[\d.]+%?)$/i.test(part));
        return [...new Set(clauses)].slice(0, 4);
    }
    contextForMessage(message, text, dates, contexts) {
        const explicitDate = dates.find((date) => this.messageMatchesDate(text, date));
        const inherited = contexts.get(String(message.parent_id || ''))
            || contexts.get(String(message.root_id || ''));
        const date = explicitDate || inherited?.date;
        const directChannels = this.detectChannels(text);
        const channels = directChannels.length > 0 ? directChannels : inherited?.channels || [];
        if (!date || channels.length === 0)
            return null;
        return { date, channels: [...new Set(channels)] };
    }
    async persist(item) {
        this.memoryCache.set(this.cacheKey(item.date, item.channel), item);
        if (!['available', 'not_mentioned'].includes(item.status))
            return;
        if (!this.tableReady)
            await this.ensureTable();
        if (!this.tableReady)
            return;
        this.writeAttempts += 1;
        try {
            await this.db.execute((0, drizzle_orm_1.sql) `
        INSERT INTO performance_fluctuation_reason (
          data_date, channel, status, summary, source_name, source_chat_id,
          source_message_ids, source_latest_at, aggregated_at
        ) VALUES (
          ${item.date}::date, ${item.channel}, ${item.status}, ${item.summary},
          ${SOURCE_NAME}, ${SOURCE_CHAT_ID}, ${JSON.stringify(item.sourceMessageIds)},
          ${item.sourceLatestAt}::timestamptz, CURRENT_TIMESTAMP
        )
        ON CONFLICT (data_date, channel)
        DO UPDATE SET
          status = EXCLUDED.status,
          summary = EXCLUDED.summary,
          source_name = EXCLUDED.source_name,
          source_chat_id = EXCLUDED.source_chat_id,
          source_message_ids = EXCLUDED.source_message_ids,
          source_latest_at = EXCLUDED.source_latest_at,
          aggregated_at = CURRENT_TIMESTAMP
      `);
            this.writeSuccesses += 1;
            this.lastWriteError = null;
        }
        catch (error) {
            this.tableReady = false;
            this.lastWriteError = String(error);
            this.logger.warn(`performance reason write failed; retained in memory: ${String(error)}`);
        }
    }
    async aggregateDates(dates, force = false) {
        const uniqueDates = [...new Set(dates)].sort();
        if (uniqueDates.length === 0)
            return [];
        if (!force) {
            const stored = await this.readStored(uniqueDates[0], uniqueDates[uniqueDates.length - 1]);
            const storedKeys = new Set(stored.map((item) => this.cacheKey(item.date, item.channel)));
            const fullyStored = uniqueDates.every((date) => storedKeys.has(this.cacheKey(date, 'douyin')) && storedKeys.has(this.cacheKey(date, 'wechat')));
            if (fullyStored)
                return stored;
        }
        const startIso = `${addDays(uniqueDates[0], 1)}T00:00:00+08:00`;
        const endIso = `${addDays(uniqueDates[uniqueDates.length - 1], 1)}T08:55:59+08:00`;
        const messages = await this.directorBriefingService.readBriefingMessages(startIso, endIso, false, SOURCE_CHAT_ID);
        const sortedMessages = [...messages].sort((a, b) => Number(a.create_time || 0) - Number(b.create_time || 0));
        const contexts = new Map();
        const reasons = new Map();
        for (const message of sortedMessages) {
            if (message.deleted || !['text', 'post'].includes(String(message.msg_type || '')))
                continue;
            const text = this.cleanMessageText(message);
            if (!text)
                continue;
            const context = this.contextForMessage(message, text, uniqueDates, contexts);
            if (!context)
                continue;
            if (message.message_id)
                contexts.set(message.message_id, context);
            const clauses = this.reasonClauses(text);
            if (clauses.length === 0)
                continue;
            for (const clause of clauses) {
                const directClauseChannels = this.detectChannels(clause);
                const clauseChannels = directClauseChannels.length === 1
                    ? directClauseChannels
                    : directClauseChannels.length === 0 && context.channels.length === 1
                        ? context.channels
                        : [];
                // A clause that explicitly or contextually spans multiple channels is
                // ambiguous. Do not duplicate it into both charts.
                for (const channel of clauseChannels) {
                    const key = this.cacheKey(context.date, channel);
                    const values = reasons.get(key) || [];
                    values.push({
                        clause,
                        messageId: String(message.message_id || ''),
                        createdAt: messageTime(message),
                    });
                    reasons.set(key, values);
                }
            }
        }
        const aggregatedAt = new Date().toISOString();
        const items = [];
        for (const date of uniqueDates) {
            for (const channel of ['douyin', 'wechat']) {
                const matches = reasons.get(this.cacheKey(date, channel)) || [];
                const uniqueClauses = [...new Set(matches.map((match) => match.clause))].slice(0, 3);
                const messageIds = [...new Set(matches.map((match) => match.messageId).filter(Boolean))];
                const sourceLatestAt = matches
                    .map((match) => match.createdAt)
                    .filter((value) => Boolean(value))
                    .sort()
                    .at(-1) || null;
                const summary = uniqueClauses.length > 0
                    ? uniqueClauses.join('；').slice(0, 360)
                    : null;
                const item = {
                    date,
                    channel,
                    status: summary ? 'available' : 'not_mentioned',
                    summary,
                    sourceName: SOURCE_NAME,
                    sourceMessageIds: messageIds,
                    sourceLatestAt,
                    aggregatedAt,
                };
                await this.persist(item);
                items.push(item);
            }
        }
        return items;
    }
    async getRange(startDate, endDate) {
        const dates = dateRange(startDate, endDate);
        if (!this.tableReady)
            await this.ensureTable();
        const stored = await this.readStored(startDate, endDate);
        for (const item of stored)
            this.memoryCache.set(this.cacheKey(item.date, item.channel), item);
        const storedKeys = new Set(stored.map((item) => this.cacheKey(item.date, item.channel)));
        const missingEligible = dates.filter((date) => this.eligible(date)
            && ['douyin', 'wechat'].some((channel) => {
                return !storedKeys.has(this.cacheKey(date, channel));
            }));
        if (missingEligible.length > 0) {
            try {
                await this.aggregateDates(missingEligible);
            }
            catch (error) {
                this.logger.warn(`performance reason backfill failed: ${String(error)}`);
                for (const date of missingEligible) {
                    for (const channel of ['douyin', 'wechat']) {
                        const key = this.cacheKey(date, channel);
                        if (!this.memoryCache.has(key)) {
                            this.memoryCache.set(key, {
                                date,
                                channel,
                                status: 'unavailable',
                                summary: null,
                                sourceName: SOURCE_NAME,
                                sourceMessageIds: [],
                                sourceLatestAt: null,
                                aggregatedAt: null,
                            });
                        }
                    }
                }
            }
        }
        const items = dates.flatMap((date) => ['douyin', 'wechat'].map((channel) => {
            const cached = this.memoryCache.get(this.cacheKey(date, channel));
            if (cached)
                return cached;
            return {
                date,
                channel,
                status: this.eligible(date) ? 'unavailable' : 'pending',
                summary: null,
                sourceName: SOURCE_NAME,
                sourceMessageIds: [],
                sourceLatestAt: null,
                aggregatedAt: null,
            };
        }));
        const storage = await this.storageStatus();
        return {
            storage,
            items,
            startDate,
            endDate,
            scheduledAt: '08:55',
            timezone: 'Asia/Shanghai',
        };
    }
};
exports.PerformanceReasonService = PerformanceReasonService;
exports.PerformanceReasonService = PerformanceReasonService = PerformanceReasonService_1 = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__param(0, (0, common_1.Inject)(fullstack_nestjs_core_1.DRIZZLE_DATABASE)),
    tslib_1.__metadata("design:paramtypes", [Function, director_briefing_service_1.DirectorBriefingService])
], PerformanceReasonService);
