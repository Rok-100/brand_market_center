"use strict";
var DataQualityAlertService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataQualityAlertService = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const mcp_1 = require("../dashboard/mcp");
const director_briefing_service_1 = require("../director-briefing/director-briefing.service");
const data_quality_alert_detector_1 = require("./data-quality-alert.detector");
const ORDER_TABLE = 'd_root_project_mid_db_brandmarketing.platform_order_item_api_field';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 15 * 1000;
const DATA_SETTLE_MINUTES = 45;
const DAY_MS = 86400000;
function addDays(date, days) {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
function shanghaiParts(now = Date.now()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(now));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
        date: `${values.year}-${values.month}-${values.day}`,
        hour: Number(values.hour),
        minute: Number(values.minute),
    };
}
function dateText(value) {
    return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
function amountWan(value) {
    return `${(value / 10000).toFixed(2)}万`;
}
let DataQualityAlertService = DataQualityAlertService_1 = class DataQualityAlertService {
    directorBriefingService;
    logger = new common_1.Logger(DataQualityAlertService_1.name);
    timer = null;
    checking = false;
    sentInProcess = new Set();
    constructor(directorBriefingService) {
        this.directorBriefingService = directorBriefingService;
    }
    onModuleInit() {
        if (process.env.HUB_MIGRATION_VALIDATION === '1') return;
        this.timer = setTimeout(() => {
            void this.checkNow().finally(() => this.scheduleNext());
        }, FIRST_CHECK_DELAY_MS);
        this.timer.unref?.();
    }
    onModuleDestroy() {
        if (this.timer)
            clearTimeout(this.timer);
    }
    scheduleNext() {
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            void this.checkNow().finally(() => this.scheduleNext());
        }, CHECK_INTERVAL_MS);
        this.timer.unref?.();
    }
    configuredShopIds() {
        const ids = (process.env.WIS_DOUYIN_SHOP_IDS || '1099,1100')
            .split(',')
            .map((value) => value.trim())
            .filter((value) => /^\d+$/.test(value));
        return ids.length ? [...new Set(ids)].join(',') : '1099,1100';
    }
    targetChatId() {
        return process.env.FEISHU_DATA_QUALITY_ALERT_CHAT_ID?.trim()
            || process.env.FEISHU_BRIEFING_CHAT_ID?.trim()
            || null;
    }
    enabled() {
        return !/^(0|false|no|off)$/i.test(process.env.FEISHU_DATA_QUALITY_ALERT_ENABLED || 'true');
    }
    buildQuery(startDate, endDateExclusive) {
        return `
SELECT
  DATE(o.pay_time) AS pay_date,
  FLOOR((HOUR(o.pay_time) * 60 + MINUTE(o.pay_time)) / 15) AS quarter_index,
  SUM(CASE WHEN o.order_status <> '4' THEN 1 ELSE 0 END) AS effective_orders,
  ROUND(SUM(CASE WHEN o.order_status <> '4' THEN o.order_pay_amount ELSE 0 END) / 100, 2) AS effective_gsv_yuan
FROM ${ORDER_TABLE} o FORCE INDEX (idx_shop_pay_time)
WHERE o.shop_id IN (${this.configuredShopIds()})
  AND o.pay_time >= '${startDate}'
  AND o.pay_time < '${endDateExclusive}'
GROUP BY DATE(o.pay_time), FLOOR((HOUR(o.pay_time) * 60 + MINUTE(o.pay_time)) / 15)
ORDER BY pay_date, quarter_index`;
    }
    fingerprint(alert) {
        return `WIS-DQ:DOUYIN-ORDER-GAP:${alert.date}:${alert.startQuarter}`;
    }
    idempotencyKey(fingerprint) {
        return `wis-dq-${(0, crypto_1.createHash)('sha256').update(fingerprint).digest('hex').slice(0, 32)}`;
    }
    async alreadySent(fingerprint, chatId) {
        if (this.sentInProcess.has(fingerprint))
            return true;
        const end = new Date();
        const start = new Date(end.getTime() - 8 * DAY_MS);
        const messages = await this.directorBriefingService.readBriefingMessages(start.toISOString(), end.toISOString(), false, chatId);
        const found = messages.some((message) => this.directorBriefingService.briefingMessageText(message).includes(`告警编号：${fingerprint}`));
        if (found)
            this.sentInProcess.add(fingerprint);
        return found;
    }
    message(alert, fingerprint) {
        const start = (0, data_quality_alert_detector_1.quarterLabel)(alert.startQuarter);
        const endMinutes = Math.min(24 * 60, (alert.endQuarter + 1) * 15);
        const end = endMinutes === 24 * 60
            ? '24:00'
            : `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
        return [
            '【WIS数据异常告警｜抖音根数据】',
            `数据日期：${alert.date}`,
            `异常类型：订单采集疑似断档（${start}–${end}）`,
            `异常时段有效订单：${alert.actualOrders} 单；近 ${alert.baselineDayCount} 个完整日同时间中位基线约 ${alert.baselineOrders} 单`,
            `异常时段有效GSV：${amountWan(alert.actualGsvYuan)}；按历史中位基线估算可能少计约 ${amountWan(alert.estimatedMissingGsvYuan)}`,
            '影响范围：看板有效GSV、利润额、利润率和广告占比可能偏低。',
            '处理口径：异常数据标记“待回补”，不按 0 处理；估算值仅用于定位，不写回看板。',
            '状态：待上游检查并回补。',
            `告警编号：${fingerprint}`,
        ].join('\n');
    }
    async checkNow(now = Date.now()) {
        if (!this.enabled() || this.checking)
            return;
        const chatId = this.targetChatId();
        if (!chatId) {
            this.logger.warn('data quality alert chat id is not configured');
            return;
        }
        this.checking = true;
        try {
            const current = shanghaiParts(now);
            const yesterday = addDays(current.date, -1);
            // Three complete comparison days are enough for a robust median while
            // keeping the recurring root-table scan bounded and inexpensive.
            const startDate = addDays(yesterday, -3);
            const endDateExclusive = addDays(current.date, 1);
            const result = await (0, mcp_1.executeCockpitSql)(this.buildQuery(startDate, endDateExclusive), 1000);
            const rows = result.rows.map((row) => ({
                date: dateText(row.pay_date),
                quarterIndex: Number(row.quarter_index),
                effectiveOrders: Number(row.effective_orders || 0),
                effectiveGsvYuan: Number(row.effective_gsv_yuan || 0),
            }));
            const settledMinutes = current.hour * 60 + current.minute - DATA_SETTLE_MINUTES;
            const todayCutoff = Math.min(95, Math.floor(settledMinutes / 15));
            const alerts = [
                ...(0, data_quality_alert_detector_1.detectOrderGaps)(rows, yesterday, 95),
                ...(todayCutoff >= 0 ? (0, data_quality_alert_detector_1.detectOrderGaps)(rows, current.date, todayCutoff) : []),
            ];
            for (const alert of alerts) {
                const fingerprint = this.fingerprint(alert);
                if (await this.alreadySent(fingerprint, chatId))
                    continue;
                await this.directorBriefingService.sendBriefingText(this.message(alert, fingerprint), chatId, this.idempotencyKey(fingerprint));
                this.sentInProcess.add(fingerprint);
                this.logger.warn(`sent data quality alert ${fingerprint}`);
            }
        }
        catch (error) {
            this.logger.error(`data quality alert check failed: ${String(error)}`);
        }
        finally {
            this.checking = false;
        }
    }
};
exports.DataQualityAlertService = DataQualityAlertService;
exports.DataQualityAlertService = DataQualityAlertService = DataQualityAlertService_1 = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__metadata("design:paramtypes", [director_briefing_service_1.DirectorBriefingService])
], DataQualityAlertService);
