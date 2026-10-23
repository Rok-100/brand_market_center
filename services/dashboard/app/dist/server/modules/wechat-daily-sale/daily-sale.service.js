"use strict";
var DailySaleService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DailySaleService = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const fullstack_nestjs_core_1 = require("@lark-apaas/fullstack-nestjs-core");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../database/schema");
let DailySaleService = DailySaleService_1 = class DailySaleService {
    db;
    logger = new common_1.Logger(DailySaleService_1.name);
    constructor(db) {
        this.db = db;
    }
    async getList(params) {
        const { startDate, endDate, page, pageSize } = params;
        const conditions = [];
        if (startDate)
            conditions.push((0, drizzle_orm_1.gte)(schema_1.wechatDailySale.saleDate, startDate));
        if (endDate)
            conditions.push((0, drizzle_orm_1.lte)(schema_1.wechatDailySale.saleDate, endDate));
        const whereClause = conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined;
        const [totalResult, items] = await Promise.all([
            this.db.select({ count: (0, drizzle_orm_1.count)() }).from(schema_1.wechatDailySale).where(whereClause),
            this.db
                .select()
                .from(schema_1.wechatDailySale)
                .where(whereClause)
                .orderBy((0, drizzle_orm_1.desc)(schema_1.wechatDailySale.saleDate))
                .limit(pageSize)
                .offset((page - 1) * pageSize),
        ]);
        const total = Number(totalResult[0]?.count ?? 0);
        const formattedItems = items.map((item) => ({
            id: item.id,
            saleDate: String(item.saleDate),
            gsvAmount: Number(item.gsvAmount),
            orderCount: item.orderCount,
            avgOrderValue: Number(item.avgOrderValue),
            isPartial: item.isPartial,
            remark: item.remark ?? '',
        }));
        return { items: formattedItems, total };
    }
    async create(dto) {
        const { saleDate, gsvAmount, orderCount, isPartial, remark } = dto;
        // Check duplicate date
        const existing = await this.db
            .select({ id: schema_1.wechatDailySale.id })
            .from(schema_1.wechatDailySale)
            .where((0, drizzle_orm_1.eq)(schema_1.wechatDailySale.saleDate, saleDate))
            .limit(1);
        if (existing.length > 0) {
            throw new common_1.ConflictException('该日期的销售数据已存在');
        }
        const avgOrderValue = orderCount > 0 ? Number((gsvAmount / orderCount).toFixed(2)) : 0;
        try {
            const result = await this.db
                .insert(schema_1.wechatDailySale)
                .values({
                saleDate,
                gsvAmount: String(gsvAmount),
                orderCount,
                avgOrderValue: String(avgOrderValue),
                isPartial: isPartial ?? false,
                remark,
            })
                .returning({ id: schema_1.wechatDailySale.id });
            return { id: result[0].id };
        }
        catch (error) {
            this.logger.error(`创建每日销售数据失败: ${JSON.stringify(error)}`);
            throw error;
        }
    }
    async update(id, dto) {
        const { saleDate, gsvAmount, orderCount, isPartial, remark } = dto;
        // Check duplicate date (excluding current record)
        const dateConflict = await this.db
            .select({ id: schema_1.wechatDailySale.id })
            .from(schema_1.wechatDailySale)
            .where((0, drizzle_orm_1.eq)(schema_1.wechatDailySale.saleDate, saleDate))
            .limit(2);
        if (dateConflict.length > 0 && dateConflict[0].id !== id) {
            throw new common_1.ConflictException('该日期的销售数据已存在');
        }
        const avgOrderValue = orderCount > 0 ? Number((gsvAmount / orderCount).toFixed(2)) : 0;
        const result = await this.db
            .update(schema_1.wechatDailySale)
            .set({
            saleDate,
            gsvAmount: String(gsvAmount),
            orderCount,
            avgOrderValue: String(avgOrderValue),
            isPartial: isPartial ?? false,
            remark,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.wechatDailySale.id, id))
            .returning({ id: schema_1.wechatDailySale.id });
        if (result.length === 0) {
            throw new common_1.NotFoundException('每日销售数据不存在');
        }
        return { success: true };
    }
    async delete(id) {
        const result = await this.db
            .delete(schema_1.wechatDailySale)
            .where((0, drizzle_orm_1.eq)(schema_1.wechatDailySale.id, id))
            .returning({ id: schema_1.wechatDailySale.id });
        if (result.length === 0) {
            throw new common_1.NotFoundException('每日销售数据不存在');
        }
        return { success: true };
    }
};
exports.DailySaleService = DailySaleService;
exports.DailySaleService = DailySaleService = DailySaleService_1 = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__param(0, (0, common_1.Inject)(fullstack_nestjs_core_1.DRIZZLE_DATABASE)),
    tslib_1.__metadata("design:paramtypes", [Function])
], DailySaleService);
