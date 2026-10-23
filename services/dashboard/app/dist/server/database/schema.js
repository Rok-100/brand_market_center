"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wechatProductDailySaleTable = exports.wechatProductTable = exports.wechatDailySaleTable = exports.wechatDailyAdqTable = exports.aiVideoCreditDailySnapshotTable = exports.directorDailySummaryTable = exports.directorDailyKeyWorkTable = exports.wechatProduct = exports.wechatDailySale = exports.wechatDailyAdq = exports.wechatProductDailySale = exports.aiVideoCreditDailySnapshot = exports.performanceFluctuationReason = exports.directorDailySummary = exports.directorDailyKeyWork = exports.fileAttachmentArray = exports.userProfileArray = exports.fileAttachment = exports.userProfile = exports.customTimestamptz = void 0;
exports.escapeLiteral = escapeLiteral;
/* eslint-disable */
/** auto generated, do not edit */
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
exports.customTimestamptz = (0, pg_core_1.customType)({
    dataType(config) {
        const precision = typeof config?.precision !== 'undefined'
            ? ` (${config.precision})`
            : '';
        return `timestamptz${precision}`;
    },
    toDriver(value) {
        if (value == null)
            return value;
        if (typeof value === 'number')
            return new Date(value).toISOString();
        if (typeof value === 'string')
            return value;
        if (value instanceof Date)
            return value.toISOString();
        throw new Error('Invalid timestamp value');
    },
    fromDriver(value) {
        if (value instanceof Date)
            return value;
        return new Date(value);
    },
});
exports.userProfile = (0, pg_core_1.customType)({
    dataType() {
        return 'user_profile';
    },
    toDriver(value) {
        return (0, drizzle_orm_1.sql) `ROW(${value})::user_profile`;
    },
    fromDriver(value) {
        const [userId] = value.slice(1, -1).split(',');
        return userId.trim();
    },
});
exports.fileAttachment = (0, pg_core_1.customType)({
    dataType() {
        return 'file_attachment';
    },
    toDriver(value) {
        return (0, drizzle_orm_1.sql) `ROW(${value.bucket_id},${value.file_path})::file_attachment`;
    },
    fromDriver(value) {
        const [bucketId, filePath] = value.slice(1, -1).split(',');
        return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
    },
});
function escapeLiteral(str) {
    return "'" + str.replace(/'/g, "''") + "'";
}
exports.userProfileArray = (0, pg_core_1.customType)({
    dataType() {
        return 'user_profile[]';
    },
    toDriver(value) {
        if (!value || value.length === 0) {
            return (0, drizzle_orm_1.sql) `'{}'::user_profile[]`;
        }
        const elements = value.map(id => `ROW(${escapeLiteral(id)})::user_profile`).join(',');
        return drizzle_orm_1.sql.raw(`ARRAY[${elements}]::user_profile[]`);
    },
    fromDriver(value) {
        if (!value || value === '{}')
            return [];
        const inner = value.slice(1, -1);
        const matches = inner.match(/\([^)]*\)/g) || [];
        return matches.map(m => m.slice(1, -1).split(',')[0].trim());
    },
});
exports.fileAttachmentArray = (0, pg_core_1.customType)({
    dataType() {
        return 'file_attachment[]';
    },
    toDriver(value) {
        if (!value || value.length === 0) {
            return (0, drizzle_orm_1.sql) `'{}'::file_attachment[]`;
        }
        const elements = value.map(f => `ROW(${escapeLiteral(f.bucket_id)},${escapeLiteral(f.file_path)})::file_attachment`).join(',');
        return drizzle_orm_1.sql.raw(`ARRAY[${elements}]::file_attachment[]`);
    },
    fromDriver(value) {
        if (!value || value === '{}')
            return [];
        const inner = value.slice(1, -1);
        const matches = inner.match(/\([^)]*\)/g) || [];
        return matches.map(m => {
            const [bucketId, filePath] = m.slice(1, -1).split(',');
            return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
        });
    },
});
exports.directorDailyKeyWork = (0, pg_core_1.pgTable)("director_daily_key_work", {
    workDate: (0, pg_core_1.date)("work_date").primaryKey(),
    content: (0, pg_core_1.text)("content").notNull(),
    updatedBy: (0, pg_core_1.varchar)("updated_by", { length: 128 }),
    updatedAt: (0, exports.customTimestamptz)("updated_at", { precision: 6 }).notNull().default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
}, (table) => [
    (0, pg_core_1.index)("idx_director_daily_key_work_updated_at").on(table.updatedAt),
]);
exports.directorDailySummary = (0, pg_core_1.pgTable)("director_daily_summary", {
    workDate: (0, pg_core_1.date)("work_date").notNull(),
    summaryType: (0, pg_core_1.varchar)("summary_type", { length: 32 }).notNull(),
    content: (0, pg_core_1.text)("content").notNull().default(''),
    updatedBy: (0, pg_core_1.varchar)("updated_by", { length: 128 }),
    updatedAt: (0, exports.customTimestamptz)("updated_at", { precision: 6 }).notNull().default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("director_daily_summary_pk").on(table.workDate, table.summaryType),
    (0, pg_core_1.index)("idx_director_daily_summary_updated_at").on(table.updatedAt),
]);
exports.performanceFluctuationReason = (0, pg_core_1.pgTable)("performance_fluctuation_reason", {
    dataDate: (0, pg_core_1.date)("data_date").notNull(),
    channel: (0, pg_core_1.varchar)("channel", { length: 16 }).notNull(),
    status: (0, pg_core_1.varchar)("status", { length: 24 }).notNull(),
    summary: (0, pg_core_1.text)("summary"),
    sourceName: (0, pg_core_1.varchar)("source_name", { length: 128 }).notNull().default('WIS项目数据群'),
    sourceChatId: (0, pg_core_1.varchar)("source_chat_id", { length: 128 }).notNull(),
    sourceMessageIds: (0, pg_core_1.text)("source_message_ids").notNull().default('[]'),
    sourceLatestAt: (0, exports.customTimestamptz)("source_latest_at", { precision: 6 }),
    aggregatedAt: (0, exports.customTimestamptz)("aggregated_at", { precision: 6 }).notNull().default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("performance_fluctuation_reason_pk").on(table.dataDate, table.channel),
    (0, pg_core_1.index)("idx_performance_fluctuation_reason_aggregated_at").on(table.aggregatedAt),
]);
exports.aiVideoCreditDailySnapshot = (0, pg_core_1.pgTable)("ai_video_credit_daily_snapshot", {
    dataDate: (0, pg_core_1.date)("data_date").notNull(),
    platform: (0, pg_core_1.varchar)("platform", { length: 16 }).notNull(),
    dailyCredits: (0, pg_core_1.numeric)("daily_credits"),
    cumulativeCredits: (0, pg_core_1.numeric)("cumulative_credits"),
    balanceCredits: (0, pg_core_1.numeric)("balance_credits"),
    reportedAccounts: (0, pg_core_1.integer)("reported_accounts").notNull().default(0),
    trackedAccounts: (0, pg_core_1.integer)("tracked_accounts").notNull().default(0),
    status: (0, pg_core_1.varchar)("status", { length: 24 }).notNull(),
    source: (0, pg_core_1.varchar)("source", { length: 32 }).notNull(),
    sourceRevision: (0, pg_core_1.integer)("source_revision"),
    sourceNote: (0, pg_core_1.text)("source_note"),
    collectedAt: (0, exports.customTimestamptz)("collected_at", { precision: 6 }).notNull(),
    updatedAt: (0, exports.customTimestamptz)("updated_at", { precision: 6 }).notNull().default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("ai_video_credit_daily_snapshot_pk").on(table.dataDate, table.platform),
    (0, pg_core_1.index)("idx_ai_video_credit_daily_collected_at").on(table.collectedAt),
]);
exports.wechatProductDailySale = (0, pg_core_1.pgTable)("wechat_product_daily_sale", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    productId: (0, pg_core_1.uuid)("product_id").notNull(),
    saleDate: (0, pg_core_1.date)("sale_date").notNull(),
    salesAmount: (0, pg_core_1.numeric)("sales_amount").notNull().default('0'),
    salesQuantity: (0, pg_core_1.integer)("sales_quantity").notNull().default(0),
    avgPrice: (0, pg_core_1.numeric)("avg_price").notNull().default('0'),
    // System field: Creation time (auto-filled, do not modify)
    createdAt: (0, exports.customTimestamptz)("_created_at", { precision: 3 }).notNull().default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
    // System field: Creator (auto-filled, do not modify)
    createdBy: (0, exports.userProfile)("_created_by"),
    // System field: Update time (auto-filled, do not modify)
    updatedAt: (0, exports.customTimestamptz)("_updated_at", { precision: 3 }).notNull().default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
    // System field: Updater (auto-filled, do not modify)
    updatedBy: (0, exports.userProfile)("_updated_by"),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("wechat_product_daily_sale_product_date_key").on(table.productId, table.saleDate),
    (0, pg_core_1.index)("idx_wechat_product_daily_sale_date").on(table.saleDate),
    (0, pg_core_1.foreignKey)({
        columns: [table.productId],
        foreignColumns: [exports.wechatProduct.id],
        name: "wechat_product_daily_sale_product_id_fkey",
    }).onDelete("cascade"),
]);
exports.wechatDailyAdq = (0, pg_core_1.pgTable)("wechat_daily_adq", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    adqDate: (0, pg_core_1.date)("adq_date").notNull().unique(),
    spend: (0, pg_core_1.numeric)("spend").notNull().default('0'),
    revenue: (0, pg_core_1.numeric)("revenue").notNull().default('0'),
    spendRatio: (0, pg_core_1.numeric)("spend_ratio").notNull().default('0'),
    isPartial: (0, pg_core_1.boolean)("is_partial").notNull().default(false),
    remark: (0, pg_core_1.text)("remark"),
    // System field: Creation time (auto-filled, do not modify)
    createdAt: (0, exports.customTimestamptz)("_created_at", { precision: 3 }).notNull().default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
    // System field: Creator (auto-filled, do not modify)
    createdBy: (0, exports.userProfile)("_created_by"),
    // System field: Update time (auto-filled, do not modify)
    updatedAt: (0, exports.customTimestamptz)("_updated_at", { precision: 3 }).notNull().default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
    // System field: Updater (auto-filled, do not modify)
    updatedBy: (0, exports.userProfile)("_updated_by"),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("wechat_daily_adq_adq_date_key").on(table.adqDate),
    (0, pg_core_1.index)("idx_wechat_daily_adq_date").on(table.adqDate),
]);
exports.wechatDailySale = (0, pg_core_1.pgTable)("wechat_daily_sale", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    saleDate: (0, pg_core_1.date)("sale_date").notNull().unique(),
    gsvAmount: (0, pg_core_1.numeric)("gsv_amount").notNull().default('0'),
    orderCount: (0, pg_core_1.integer)("order_count").notNull().default(0),
    avgOrderValue: (0, pg_core_1.numeric)("avg_order_value").notNull().default('0'),
    isPartial: (0, pg_core_1.boolean)("is_partial").notNull().default(false),
    remark: (0, pg_core_1.text)("remark"),
    // System field: Creation time (auto-filled, do not modify)
    createdAt: (0, exports.customTimestamptz)("_created_at", { precision: 3 }).notNull().default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
    // System field: Creator (auto-filled, do not modify)
    createdBy: (0, exports.userProfile)("_created_by"),
    // System field: Update time (auto-filled, do not modify)
    updatedAt: (0, exports.customTimestamptz)("_updated_at", { precision: 3 }).notNull().default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
    // System field: Updater (auto-filled, do not modify)
    updatedBy: (0, exports.userProfile)("_updated_by"),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("wechat_daily_sale_sale_date_key").on(table.saleDate),
]);
exports.wechatProduct = (0, pg_core_1.pgTable)("wechat_product", {
    id: (0, pg_core_1.uuid)("id").primaryKey().defaultRandom(),
    name: (0, pg_core_1.varchar)("name", { length: 255 }).notNull(),
    sku: (0, pg_core_1.varchar)("sku", { length: 100 }).notNull().unique(),
    category: (0, pg_core_1.varchar)("category", { length: 100 }),
    canScale: (0, pg_core_1.boolean)("can_scale").notNull().default(true),
    restrictReason: (0, pg_core_1.varchar)("restrict_reason", { length: 50 }),
    suggestion: (0, pg_core_1.text)("suggestion"),
    remark: (0, pg_core_1.text)("remark"),
    // System field: Creation time (auto-filled, do not modify)
    createdAt: (0, exports.customTimestamptz)("_created_at", { precision: 3 }).notNull().default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
    // System field: Creator (auto-filled, do not modify)
    createdBy: (0, exports.userProfile)("_created_by"),
    // System field: Update time (auto-filled, do not modify)
    updatedAt: (0, exports.customTimestamptz)("_updated_at", { precision: 3 }).notNull().default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
    // System field: Updater (auto-filled, do not modify)
    updatedBy: (0, exports.userProfile)("_updated_by"),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("wechat_product_sku_key").on(table.sku),
    (0, pg_core_1.index)("idx_wechat_product_category").on(table.category),
    (0, pg_core_1.index)("idx_wechat_product_can_scale").on(table.canScale),
]);
// table aliases
exports.directorDailyKeyWorkTable = exports.directorDailyKeyWork;
exports.directorDailySummaryTable = exports.directorDailySummary;
exports.aiVideoCreditDailySnapshotTable = exports.aiVideoCreditDailySnapshot;
exports.wechatDailyAdqTable = exports.wechatDailyAdq;
exports.wechatDailySaleTable = exports.wechatDailySale;
exports.wechatProductTable = exports.wechatProduct;
exports.wechatProductDailySaleTable = exports.wechatProductDailySale;
