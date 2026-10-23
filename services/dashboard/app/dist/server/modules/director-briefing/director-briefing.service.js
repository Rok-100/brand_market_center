"use strict";
var DirectorBriefingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DirectorBriefingService = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const fullstack_nestjs_core_1 = require("@lark-apaas/fullstack-nestjs-core");
const drizzle_orm_1 = require("drizzle-orm");
const DIRECTOR_DAILY_REPORT_DOC_URL = 'https://jqx28l0j4lx.feishu.cn/docx/FMaHdSi40ok4IEx2ZeWctYtynpb';
const OPERATING_IMAGE_SYSTEM_DATE = '2999-12-31';
const DIRECTOR_CALENDAR_SYSTEM_DATE = '2999-12-30';
const DIRECTOR_INSIGHT_SOURCE = '品牌营销部-核心干将';
const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';
const INSIGHT_CACHE_MS = 5 * 60 * 1000;
const DAILY_SUMMARY_TYPES = ['morning_report', 'transcript'];
let DirectorBriefingService = DirectorBriefingService_1 = class DirectorBriefingService {
    db;
    logger = new common_1.Logger(DirectorBriefingService_1.name);
    tenantToken = null;
    insightCache = new Map();
    constructor(db) {
        this.db = db;
    }
    dateText(value) {
        if (value instanceof Date)
            return value.toISOString().slice(0, 10);
        return String(value).slice(0, 10);
    }
    timeText(value) {
        if (!value)
            return null;
        return value instanceof Date ? value.toISOString() : String(value);
    }
    missingTable(error) {
        const record = error;
        return record?.code === '42P01'
            || String(record?.message || '').includes('director_daily_key_work')
            || String(record?.message || '').includes('director_daily_summary')
            || String(record?.message || '').includes('director_daily_operating_image');
    }
    shanghaiDayBounds(date) {
        const startMs = Date.parse(`${date}T00:00:00+08:00`);
        const endMs = Date.parse(`${date}T23:59:59+08:00`);
        return {
            start: String(Math.floor(startMs / 1000)),
            end: String(Math.floor(endMs / 1000)),
        };
    }
    async getTenantToken() {
        if (this.tenantToken && this.tenantToken.expiresAt > Date.now()) {
            return this.tenantToken.value;
        }
        const appId = process.env.FEISHU_BRIEFING_APP_ID?.trim();
        const appSecret = process.env.FEISHU_BRIEFING_APP_SECRET?.trim();
        if (!appId || !appSecret)
            throw new Error('briefing app credentials are not configured');
        const response = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
        });
        const payload = await response.json();
        if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
            throw new Error(`tenant token request failed: ${payload.code ?? response.status}`);
        }
        this.tenantToken = {
            value: payload.tenant_access_token,
            expiresAt: Date.now() + Math.max(60, Number(payload.expire || 7200) - 60) * 1000,
        };
        return this.tenantToken.value;
    }
    async readBriefingMessages(startIso, endIso, onlyThreadRootMessages = false, chatIdOverride) {
        const chatId = chatIdOverride?.trim() || process.env.FEISHU_BRIEFING_CHAT_ID?.trim();
        if (!chatId)
            throw new Error('briefing chat id is not configured');
        const token = await this.getTenantToken();
        const startMs = Date.parse(startIso);
        const endMs = Date.parse(endIso);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
            throw new Error('invalid briefing message time range');
        }
        const messages = [];
        let pageToken = '';
        for (let page = 0; page < 20; page += 1) {
            const params = new URLSearchParams({
                container_id_type: 'chat',
                container_id: chatId,
                start_time: String(Math.floor(startMs / 1000)),
                end_time: String(Math.floor(endMs / 1000)),
                sort_type: 'ByCreateTimeAsc',
                page_size: '50',
                only_thread_root_messages: String(onlyThreadRootMessages),
            });
            if (pageToken)
                params.set('page_token', pageToken);
            const response = await fetch(`${FEISHU_API_BASE}/im/v1/messages?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const payload = await response.json();
            if (!response.ok || payload.code !== 0) {
                throw new Error(`message request failed: ${payload.code ?? response.status}`);
            }
            messages.push(...(Array.isArray(payload.data?.items) ? payload.data.items : []));
            if (!payload.data?.has_more || !payload.data.page_token)
                break;
            pageToken = payload.data.page_token;
        }
        return messages;
    }
    async sendBriefingText(text, chatIdOverride, idempotencyKey) {
        const chatId = chatIdOverride?.trim() || process.env.FEISHU_BRIEFING_CHAT_ID?.trim();
        if (!chatId)
            throw new Error('briefing chat id is not configured');
        const message = text.trim();
        if (!message)
            throw new Error('briefing message is empty');
        const token = await this.getTenantToken();
        const response = await fetch(`${FEISHU_API_BASE}/im/v1/messages?receive_id_type=chat_id`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify({
                receive_id: chatId,
                msg_type: 'text',
                content: JSON.stringify({ text: message }),
                ...(idempotencyKey ? { uuid: idempotencyKey.slice(0, 50) } : {}),
            }),
        });
        const payload = await response.json();
        if (!response.ok || payload.code !== 0 || !payload.data?.message_id) {
            throw new Error(`message send failed: ${payload.code ?? response.status}`);
        }
        return payload.data.message_id;
    }
    async readInsightMessages(date) {
        const bounds = this.shanghaiDayBounds(date);
        return this.readBriefingMessages(new Date(Number(bounds.start) * 1000).toISOString(), new Date(Number(bounds.end) * 1000).toISOString(), true);
    }
    flattenMessageContent(value, key = '') {
        if (typeof value === 'string') {
            if (/^(href|url|image_key|file_key|open_id|user_id|tag)$/i.test(key))
                return [];
            return [value];
        }
        if (Array.isArray(value)) {
            return value.flatMap((item) => this.flattenMessageContent(item, key));
        }
        if (value && typeof value === 'object') {
            return Object.entries(value)
                .flatMap(([childKey, childValue]) => this.flattenMessageContent(childValue, childKey));
        }
        return [];
    }
    briefingMessageText(message) {
        const raw = message.body?.content;
        if (!raw)
            return '';
        try {
            return this.flattenMessageContent(JSON.parse(raw)).join(' ');
        }
        catch {
            return raw;
        }
    }
    sanitizeInsight(value) {
        return value
            .replace(/https?:\/\/\S+/gi, '')
            .replace(/<at\b[^>]*>.*?<\/at>/gi, '')
            .replace(/@_[a-z0-9_]+/gi, '')
            .replace(/\bou_[a-z0-9_]+\b/gi, '[成员]')
            .replace(/\b1[3-9]\d{9}\b/g, '[手机号]')
            .replace(/\b\d{8,}\b/g, '[编号]')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 180);
    }
    insightCategory(text) {
        const risk = /(异常|问题|卡点|风险|延迟|缺失|下滑|下降|未完成|无法|报错|退款|亏损)/i;
        const result = /(GMV|GSV|ROI|营业额|销售额|成交|利润|成本|消耗|转化|目标|完成率|增长|达成)/i;
        const progress = /(进度|上线|完成|推进|复盘|优化|调整|执行|跟进|负责人|今日|明日|计划)/i;
        const opportunity = /(机会|发现|建议|方案|测试|验证|素材|直播|视频号|抖店|千川|新品|用户反馈)/i;
        if (risk.test(text))
            return { category: '风险提醒', score: 4 };
        if (result.test(text))
            return { category: '业绩信号', score: 3 };
        if (progress.test(text))
            return { category: '执行进展', score: 2 };
        if (opportunity.test(text))
            return { category: '机会发现', score: 1 };
        return null;
    }
    insightFromMessage(message) {
        if (message.deleted || !['text', 'post'].includes(String(message.msg_type || '')))
            return null;
        const content = this.sanitizeInsight(this.briefingMessageText(message));
        if (content.length < 8)
            return null;
        const classified = this.insightCategory(content);
        if (!classified)
            return null;
        const rawTime = Number(message.create_time || 0);
        const createdAt = rawTime > 0
            ? new Date(rawTime < 1e12 ? rawTime * 1000 : rawTime).toISOString()
            : new Date().toISOString();
        return {
            id: String(message.message_id || `${createdAt}-${content.slice(0, 16)}`),
            category: classified.category,
            content,
            createdAt,
            score: classified.score,
        };
    }
    async readOperatingImagePayload() {
        const result = await this.db.execute((0, drizzle_orm_1.sql) `
      SELECT content
      FROM director_daily_key_work
      WHERE work_date = ${OPERATING_IMAGE_SYSTEM_DATE}::date
      LIMIT 1
    `);
        const row = result[0];
        if (!row?.content)
            return null;
        return JSON.parse(row.content);
    }
    async readCalendarPayload() {
        const result = await this.db.execute((0, drizzle_orm_1.sql) `
      SELECT content
      FROM director_daily_key_work
      WHERE work_date = ${DIRECTOR_CALENDAR_SYSTEM_DATE}::date
      LIMIT 1
    `);
        const row = result[0];
        if (!row?.content)
            return null;
        return JSON.parse(row.content);
    }
    async getCalendarDay(date) {
        try {
            const payload = await this.readCalendarPayload();
            if (!payload) {
                return { date, sourceName: '赵佳乐', updatedAt: null, items: [] };
            }
            const day = Array.isArray(payload.days)
                ? payload.days.find((candidate) => candidate.date === date)
                : undefined;
            return {
                date,
                sourceName: payload.sourceName || '赵佳乐',
                updatedAt: payload.updatedAt || null,
                items: Array.isArray(day?.items) ? day.items : [],
            };
        }
        catch (error) {
            if (this.missingTable(error) || error instanceof SyntaxError) {
                return { date, sourceName: '赵佳乐', updatedAt: null, items: [] };
            }
            throw error;
        }
    }
    async getInsights(date) {
        const cached = this.insightCache.get(date);
        if (cached && cached.expiresAt > Date.now())
            return cached.value;
        try {
            const messages = await this.readInsightMessages(date);
            const seen = new Set();
            const items = messages
                .map((message) => this.insightFromMessage(message))
                .filter((item) => Boolean(item))
                .filter((item) => {
                const fingerprint = item.content.toLowerCase();
                if (seen.has(fingerprint))
                    return false;
                seen.add(fingerprint);
                return true;
            })
                .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt))
                .slice(0, 6)
                .map(({ score: _score, ...item }) => item);
            const value = {
                date,
                sourceName: DIRECTOR_INSIGHT_SOURCE,
                updatedAt: new Date().toISOString(),
                status: items.length ? 'live' : 'empty',
                messageCount: messages.length,
                items,
                reason: items.length ? null : '当日暂无符合价值发现规则的文字消息',
            };
            this.insightCache.set(date, { expiresAt: Date.now() + INSIGHT_CACHE_MS, value });
            return value;
        }
        catch (error) {
            this.logger.warn(`Director insight fetch unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
            return {
                date,
                sourceName: DIRECTOR_INSIGHT_SOURCE,
                updatedAt: null,
                status: 'unavailable',
                messageCount: 0,
                items: [],
                reason: '飞书群消息暂时无法读取，请稍后刷新',
            };
        }
    }
    async getOperatingImages(date) {
        try {
            const payload = await this.readOperatingImagePayload();
            if (!payload) {
                return { date: null, sourceDocUrl: DIRECTOR_DAILY_REPORT_DOC_URL, items: [] };
            }
            if (date && payload.date !== date) {
                return { date, sourceDocUrl: DIRECTOR_DAILY_REPORT_DOC_URL, items: [] };
            }
            return {
                date: payload.date,
                sourceDocUrl: DIRECTOR_DAILY_REPORT_DOC_URL,
                items: Array.isArray(payload.items)
                    ? payload.items.map((item) => ({
                        date: item.date,
                        imageType: item.imageType,
                        imageUrl: `/api/director/briefing/operating-images/media?date=${encodeURIComponent(item.date)}&type=${encodeURIComponent(item.imageType)}`,
                        altText: item.altText,
                        sourceBlockId: item.sourceBlockId,
                    }))
                    : [],
            };
        }
        catch (error) {
            if (this.missingTable(error)) {
                return { date: null, sourceDocUrl: DIRECTOR_DAILY_REPORT_DOC_URL, items: [] };
            }
            if (error instanceof SyntaxError) {
                return { date: null, sourceDocUrl: DIRECTOR_DAILY_REPORT_DOC_URL, items: [] };
            }
            throw error;
        }
    }
    async getOperatingImageMedia(date, imageType) {
        try {
            const payload = await this.readOperatingImagePayload();
            if (!payload || payload.date !== date || !Array.isArray(payload.items))
                return null;
            const item = payload.items.find((candidate) => candidate.imageType === imageType);
            if (!item?.imageBase64)
                return null;
            const contentType = item.contentType?.startsWith('image/')
                ? item.contentType
                : 'image/jpeg';
            const buffer = Buffer.from(item.imageBase64, 'base64');
            if (!buffer.length)
                return null;
            return { buffer, contentType };
        }
        catch (error) {
            if (this.missingTable(error) || error instanceof SyntaxError)
                return null;
            throw error;
        }
    }
    async getDailyKeyWork(date) {
        try {
            const result = await this.db.execute((0, drizzle_orm_1.sql) `
        SELECT work_date, content, updated_at
        FROM director_daily_key_work
        WHERE work_date = ${date}::date
        LIMIT 1
      `);
            const row = result[0];
            return row
                ? {
                    date: this.dateText(row.work_date),
                    content: row.content || '',
                    updatedAt: this.timeText(row.updated_at),
                }
                : { date, content: '', updatedAt: null };
        }
        catch (error) {
            if (this.missingTable(error))
                return { date, content: '', updatedAt: null };
            throw error;
        }
    }
    async saveDailyKeyWork(date, content, userId) {
        try {
            const result = await this.db.execute((0, drizzle_orm_1.sql) `
        INSERT INTO director_daily_key_work (work_date, content, updated_by, updated_at)
        VALUES (${date}::date, ${content}, ${userId}, CURRENT_TIMESTAMP)
        ON CONFLICT (work_date)
        DO UPDATE SET
          content = EXCLUDED.content,
          updated_by = EXCLUDED.updated_by,
          updated_at = CURRENT_TIMESTAMP
        RETURNING work_date, content, updated_at
      `);
            const row = result[0];
            return {
                date: this.dateText(row.work_date),
                content: row.content || '',
                updatedAt: this.timeText(row.updated_at),
            };
        }
        catch (error) {
            if (this.missingTable(error)) {
                throw new common_1.ServiceUnavailableException('总监手写关键工作数据表尚未初始化');
            }
            throw error;
        }
    }
    async getDailySummaries(date) {
        const emptyItem = (summaryType) => ({
            date,
            summaryType,
            content: '',
            updatedAt: null,
        });
        const items = {
            morning_report: emptyItem('morning_report'),
            transcript: emptyItem('transcript'),
        };
        try {
            const result = await this.db.execute((0, drizzle_orm_1.sql) `
        SELECT work_date, summary_type, content, updated_at
        FROM director_daily_summary
        WHERE work_date = ${date}::date
          AND summary_type IN ('morning_report', 'transcript')
      `);
            for (const row of result) {
                if (!DAILY_SUMMARY_TYPES.includes(row.summary_type))
                    continue;
                items[row.summary_type] = {
                    date: this.dateText(row.work_date),
                    summaryType: row.summary_type,
                    content: row.content || '',
                    updatedAt: this.timeText(row.updated_at),
                };
            }
            return { date, items };
        }
        catch (error) {
            if (this.missingTable(error))
                return { date, items };
            throw error;
        }
    }
    async saveDailySummary(date, summaryType, content, userId) {
        try {
            const result = await this.db.execute((0, drizzle_orm_1.sql) `
        INSERT INTO director_daily_summary (work_date, summary_type, content, updated_by, updated_at)
        VALUES (${date}::date, ${summaryType}, ${content}, ${userId}, CURRENT_TIMESTAMP)
        ON CONFLICT (work_date, summary_type)
        DO UPDATE SET
          content = EXCLUDED.content,
          updated_by = EXCLUDED.updated_by,
          updated_at = CURRENT_TIMESTAMP
        RETURNING work_date, summary_type, content, updated_at
      `);
            const row = result[0];
            return {
                date: this.dateText(row.work_date),
                summaryType: row.summary_type,
                content: row.content || '',
                updatedAt: this.timeText(row.updated_at),
            };
        }
        catch (error) {
            if (this.missingTable(error)) {
                throw new common_1.ServiceUnavailableException('总监日报总结数据表尚未初始化');
            }
            throw error;
        }
    }
};
exports.DirectorBriefingService = DirectorBriefingService;
exports.DirectorBriefingService = DirectorBriefingService = DirectorBriefingService_1 = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__param(0, (0, common_1.Inject)(fullstack_nestjs_core_1.DRIZZLE_DATABASE)),
    tslib_1.__metadata("design:paramtypes", [Function])
], DirectorBriefingService);
