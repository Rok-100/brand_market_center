"use strict";
var ProductTrendService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductTrendService = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const fullstack_nestjs_core_1 = require("@lark-apaas/fullstack-nestjs-core");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../database/schema");
let ProductTrendService = ProductTrendService_1 = class ProductTrendService {
    db;
    logger = new common_1.Logger(ProductTrendService_1.name);
    constructor(db) {
        this.db = db;
    }
    async getMetrics(id, range) {
        try {
            const refDate = await this.getReferenceDate();
            const currentRange = this.calculateDateRange(range, refDate);
            const prevRange = this.calculatePreviousRange(range, refDate);
            const currentData = await this.queryPeriodData(id, currentRange);
            const prevData = await this.queryPeriodData(id, prevRange);
            const totalSales = Number(currentData.totalSales) || 0;
            const totalQuantity = Number(currentData.totalQuantity) || 0;
            const avgDailySales = currentRange.days > 0 ? totalSales / currentRange.days : 0;
            const prevAvgDailySales = prevRange.days > 0
                ? (Number(prevData.totalSales) || 0) / prevRange.days
                : 0;
            const momChangeRate = prevAvgDailySales > 0
                ? Number(((avgDailySales - prevAvgDailySales) / prevAvgDailySales * 100).toFixed(1))
                : 0;
            const avgPrice = totalQuantity > 0 ? totalSales / totalQuantity : 0;
            const peakRecord = await this.db
                .select({
                saleDate: schema_1.wechatProductDailySale.saleDate,
                salesAmount: schema_1.wechatProductDailySale.salesAmount,
            })
                .from(schema_1.wechatProductDailySale)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.wechatProductDailySale.productId, id), (0, drizzle_orm_1.gte)(schema_1.wechatProductDailySale.saleDate, currentRange.start), (0, drizzle_orm_1.lte)(schema_1.wechatProductDailySale.saleDate, currentRange.end)))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.wechatProductDailySale.salesAmount))
                .limit(1);
            const peakDay = peakRecord.length > 0
                ? this.formatDate(peakRecord[0].saleDate)
                : '';
            const peakValue = peakRecord.length > 0 ? Number(peakRecord[0].salesAmount) || 0 : 0;
            return {
                totalSales: Number(totalSales.toFixed(2)),
                avgDailySales: Number(avgDailySales.toFixed(2)),
                peakDay,
                peakValue: Number(peakValue.toFixed(2)),
                momChangeRate,
                totalQuantity,
                avgPrice: Number(avgPrice.toFixed(2)),
            };
        }
        catch (error) {
            this.logger.error(`获取单品趋势指标失败: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    async getDaily(id, range) {
        try {
            const refDate = await this.getReferenceDate();
            const dateRange = this.calculateDateRange(range, refDate);
            const records = await this.db
                .select({
                saleDate: schema_1.wechatProductDailySale.saleDate,
                salesAmount: schema_1.wechatProductDailySale.salesAmount,
                salesQuantity: schema_1.wechatProductDailySale.salesQuantity,
                avgPrice: schema_1.wechatProductDailySale.avgPrice,
            })
                .from(schema_1.wechatProductDailySale)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.wechatProductDailySale.productId, id), (0, drizzle_orm_1.gte)(schema_1.wechatProductDailySale.saleDate, dateRange.start), (0, drizzle_orm_1.lte)(schema_1.wechatProductDailySale.saleDate, dateRange.end)))
                .orderBy(schema_1.wechatProductDailySale.saleDate);
            const items = records.map((record) => ({
                date: this.formatDate(record.saleDate),
                salesAmount: Number(record.salesAmount) || 0,
                salesQuantity: Number(record.salesQuantity) || 0,
                avgPrice: Number(record.avgPrice) || 0,
            }));
            return {
                items,
                total: items.length,
            };
        }
        catch (error) {
            this.logger.error(`获取单品日销售数据失败: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    async getReferenceDate() {
        const result = await this.db
            .select({ maxDate: (0, drizzle_orm_1.max)(schema_1.wechatProductDailySale.saleDate) })
            .from(schema_1.wechatProductDailySale);
        const maxDate = result[0]?.maxDate;
        if (!maxDate) {
            return this.formatDate(new Date());
        }
        return this.formatDate(maxDate);
    }
    async queryPeriodData(productId, range) {
        const result = await this.db
            .select({
            totalSales: (0, drizzle_orm_1.sum)(schema_1.wechatProductDailySale.salesAmount),
            totalQuantity: (0, drizzle_orm_1.sum)(schema_1.wechatProductDailySale.salesQuantity),
            recordCount: (0, drizzle_orm_1.count)(),
        })
            .from(schema_1.wechatProductDailySale)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.wechatProductDailySale.productId, productId), (0, drizzle_orm_1.gte)(schema_1.wechatProductDailySale.saleDate, range.start), (0, drizzle_orm_1.lte)(schema_1.wechatProductDailySale.saleDate, range.end)));
        return result[0] || { totalSales: 0, totalQuantity: 0, recordCount: 0 };
    }
    calculateDateRange(range, refDateStr) {
        const ref = new Date(refDateStr);
        if (range === 'month') {
            const year = ref.getFullYear();
            const month = ref.getMonth();
            const start = new Date(year, month, 1);
            const end = ref;
            const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            return {
                start: this.formatDate(start),
                end: this.formatDate(end),
                days,
            };
        }
        const daysMap = {
            '7d': 7,
            '15d': 15,
            '30d': 30,
        };
        const days = daysMap[range] || 15;
        const start = new Date(ref);
        start.setDate(ref.getDate() - days + 1);
        return {
            start: this.formatDate(start),
            end: this.formatDate(ref),
            days,
        };
    }
    calculatePreviousRange(range, refDateStr) {
        const current = this.calculateDateRange(range, refDateStr);
        const currentStart = new Date(current.start);
        const prevEnd = new Date(currentStart);
        prevEnd.setDate(currentStart.getDate() - 1);
        const prevStart = new Date(prevEnd);
        prevStart.setDate(prevEnd.getDate() - current.days + 1);
        return {
            start: this.formatDate(prevStart),
            end: this.formatDate(prevEnd),
            days: current.days,
        };
    }
    formatDate(date) {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
};
exports.ProductTrendService = ProductTrendService;
exports.ProductTrendService = ProductTrendService = ProductTrendService_1 = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__param(0, (0, common_1.Inject)(fullstack_nestjs_core_1.DRIZZLE_DATABASE)),
    tslib_1.__metadata("design:paramtypes", [Function])
], ProductTrendService);
