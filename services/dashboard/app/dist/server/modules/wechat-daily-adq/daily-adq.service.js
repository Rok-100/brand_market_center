"use strict";
var DailyAdqService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DailyAdqService = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const fullstack_nestjs_core_1 = require("@lark-apaas/fullstack-nestjs-core");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../database/schema");
let DailyAdqService = DailyAdqService_1 = class DailyAdqService {
    db;
    logger = new common_1.Logger(DailyAdqService_1.name);
    constructor(db) {
        this.db = db;
    }
    async getList(params) {
        const { startDate, endDate, page, pageSize } = params;
        const conditions = [];
        if (startDate)
            conditions.push((0, drizzle_orm_1.gte)(schema_1.wechatDailyAdq.adqDate, startDate));
        if (endDate)
            conditions.push((0, drizzle_orm_1.lte)(schema_1.wechatDailyAdq.adqDate, endDate));
        const whereClause = conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined;
        const [totalResult, items] = await Promise.all([
            this.db.select({ count: (0, drizzle_orm_1.count)() }).from(schema_1.wechatDailyAdq).where(whereClause),
            this.db
                .select()
                .from(schema_1.wechatDailyAdq)
                .where(whereClause)
                .orderBy((0, drizzle_orm_1.desc)(schema_1.wechatDailyAdq.adqDate))
                .limit(pageSize)
                .offset((page - 1) * pageSize),
        ]);
        const total = Number(totalResult[0]?.count ?? 0);
        const formattedItems = items.map((item) => ({
            id: item.id,
            adqDate: String(item.adqDate),
            spend: Number(item.spend),
            revenue: Number(item.revenue),
            spendRatio: Number(item.spendRatio),
            isPartial: item.isPartial,
            remark: item.remark ?? '',
        }));
        return { items: formattedItems, total };
    }
    async create(dto) {
        const { adqDate, spend, revenue, spendRatio, isPartial, remark } = dto;
        // Check duplicate date
        const existing = await this.db
            .select({ id: schema_1.wechatDailyAdq.id })
            .from(schema_1.wechatDailyAdq)
            .where((0, drizzle_orm_1.eq)(schema_1.wechatDailyAdq.adqDate, adqDate))
            .limit(1);
        if (existing.length > 0) {
            throw new common_1.ConflictException('该日期的ADQ数据已存在');
        }
        try {
            const result = await this.db
                .insert(schema_1.wechatDailyAdq)
                .values({
                adqDate,
                spend: String(spend),
                revenue: String(revenue),
                spendRatio: String(spendRatio),
                isPartial: isPartial ?? false,
                remark,
            })
                .returning({ id: schema_1.wechatDailyAdq.id });
            return { id: result[0].id };
        }
        catch (error) {
            this.logger.error(`创建ADQ数据失败: ${JSON.stringify(error)}`);
            throw error;
        }
    }
    async update(id, dto) {
        const { adqDate, spend, revenue, spendRatio, isPartial, remark } = dto;
        // Check duplicate date (excluding current record)
        const dateConflict = await this.db
            .select({ id: schema_1.wechatDailyAdq.id })
            .from(schema_1.wechatDailyAdq)
            .where((0, drizzle_orm_1.eq)(schema_1.wechatDailyAdq.adqDate, adqDate))
            .limit(2);
        if (dateConflict.length > 0 && dateConflict[0].id !== id) {
            throw new common_1.ConflictException('该日期的ADQ数据已存在');
        }
        const result = await this.db
            .update(schema_1.wechatDailyAdq)
            .set({
            adqDate,
            spend: String(spend),
            revenue: String(revenue),
            spendRatio: String(spendRatio),
            isPartial: isPartial ?? false,
            remark,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.wechatDailyAdq.id, id))
            .returning({ id: schema_1.wechatDailyAdq.id });
        if (result.length === 0) {
            throw new common_1.NotFoundException('ADQ数据不存在');
        }
        return { success: true };
    }
    async delete(id) {
        const result = await this.db
            .delete(schema_1.wechatDailyAdq)
            .where((0, drizzle_orm_1.eq)(schema_1.wechatDailyAdq.id, id))
            .returning({ id: schema_1.wechatDailyAdq.id });
        if (result.length === 0) {
            throw new common_1.NotFoundException('ADQ数据不存在');
        }
        return { success: true };
    }
};
exports.DailyAdqService = DailyAdqService;
exports.DailyAdqService = DailyAdqService = DailyAdqService_1 = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__param(0, (0, common_1.Inject)(fullstack_nestjs_core_1.DRIZZLE_DATABASE)),
    tslib_1.__metadata("design:paramtypes", [Function])
], DailyAdqService);
