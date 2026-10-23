"use strict";
var ProductService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductService = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const fullstack_nestjs_core_1 = require("@lark-apaas/fullstack-nestjs-core");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../database/schema");
let ProductService = ProductService_1 = class ProductService {
    db;
    logger = new common_1.Logger(ProductService_1.name);
    constructor(db) {
        this.db = db;
    }
    async getRestrictedSummary() {
        const restrictedProducts = await this.db
            .select({ id: schema_1.wechatProduct.id, restrictReason: schema_1.wechatProduct.restrictReason })
            .from(schema_1.wechatProduct)
            .where((0, drizzle_orm_1.eq)(schema_1.wechatProduct.canScale, false));
        const totalCount = restrictedProducts.length;
        const restrictedIds = restrictedProducts.map((p) => p.id);
        let impactAmount7d = 0;
        if (restrictedIds.length > 0) {
            const maxDateResult = await this.db
                .select({ maxDate: (0, drizzle_orm_1.sql) `MAX(${schema_1.wechatProductDailySale.saleDate})`.as('max_date') })
                .from(schema_1.wechatProductDailySale);
            const maxDate = maxDateResult[0]?.maxDate;
            if (maxDate) {
                const sevenDaysAgo = new Date(maxDate);
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
                const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];
                const impactResult = await this.db
                    .select({ total: (0, drizzle_orm_1.sum)(schema_1.wechatProductDailySale.salesAmount) })
                    .from(schema_1.wechatProductDailySale)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `${schema_1.wechatProductDailySale.productId} = ANY(ARRAY[${drizzle_orm_1.sql.join(restrictedIds, (0, drizzle_orm_1.sql) `, `)}]::uuid[])`, (0, drizzle_orm_1.sql) `${schema_1.wechatProductDailySale.saleDate} >= ${sevenDaysAgoStr}::date`));
                impactAmount7d = Number(impactResult[0]?.total ?? 0);
            }
        }
        const reasonCount = new Map();
        for (const p of restrictedProducts) {
            const reason = p.restrictReason ?? 'other';
            reasonCount.set(reason, (reasonCount.get(reason) ?? 0) + 1);
        }
        const reasonDistribution = Array.from(reasonCount.entries()).map(([reason, count]) => ({
            reason: reason,
            count,
            ratio: totalCount > 0 ? Number((count / totalCount).toFixed(2)) : 0,
        }));
        return { totalCount, impactAmount7d, reasonDistribution };
    }
    async getRestrictedList(params) {
        const { keyword, reason, sortBy, sortOrder, page, pageSize } = params;
        const conditions = [(0, drizzle_orm_1.eq)(schema_1.wechatProduct.canScale, false)];
        if (keyword) {
            conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.wechatProduct.name, `%${keyword}%`), (0, drizzle_orm_1.like)(schema_1.wechatProduct.sku, `%${keyword}%`)));
        }
        if (reason) {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.wechatProduct.restrictReason, reason));
        }
        const whereClause = (0, drizzle_orm_1.and)(...conditions);
        const [totalResult, restrictedItems] = await Promise.all([
            this.db.select({ count: (0, drizzle_orm_1.count)() }).from(schema_1.wechatProduct).where(whereClause),
            this.db
                .select()
                .from(schema_1.wechatProduct)
                .where(whereClause)
                .limit(pageSize)
                .offset((page - 1) * pageSize),
        ]);
        const total = Number(totalResult[0]?.count ?? 0);
        const ids = restrictedItems.map((item) => item.id);
        let salesMap = new Map();
        if (ids.length > 0) {
            const maxDateResult = await this.db
                .select({ maxDate: (0, drizzle_orm_1.sql) `MAX(${schema_1.wechatProductDailySale.saleDate})`.as('max_date') })
                .from(schema_1.wechatProductDailySale);
            const maxDate = maxDateResult[0]?.maxDate;
            if (maxDate) {
                const sevenDaysAgo = new Date(maxDate);
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
                const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];
                const salesResults = await this.db
                    .select({
                    productId: schema_1.wechatProductDailySale.productId,
                    sales7d: (0, drizzle_orm_1.sum)(schema_1.wechatProductDailySale.salesAmount),
                    quantity7d: (0, drizzle_orm_1.sum)(schema_1.wechatProductDailySale.salesQuantity),
                })
                    .from(schema_1.wechatProductDailySale)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `${schema_1.wechatProductDailySale.productId} = ANY(ARRAY[${drizzle_orm_1.sql.join(ids, (0, drizzle_orm_1.sql) `, `)}]::uuid[])`, (0, drizzle_orm_1.sql) `${schema_1.wechatProductDailySale.saleDate} >= ${sevenDaysAgoStr}::date`))
                    .groupBy(schema_1.wechatProductDailySale.productId);
                for (const r of salesResults) {
                    salesMap.set(r.productId, {
                        sales7d: Number(r.sales7d ?? 0),
                        quantity7d: Number(r.quantity7d ?? 0),
                    });
                }
            }
        }
        let items = restrictedItems.map((item) => {
            const sales = salesMap.get(item.id) ?? { sales7d: 0, quantity7d: 0 };
            return {
                id: item.id,
                name: item.name,
                sku: item.sku,
                category: item.category ?? '',
                restrictReason: item.restrictReason ?? 'other',
                suggestion: item.suggestion ?? '',
                sales7d: sales.sales7d,
                quantity7d: sales.quantity7d,
                isHighImpact: sales.sales7d > 200000,
            };
        });
        if (sortBy === 'sales_amount') {
            items.sort((a, b) => sortOrder === 'asc' ? a.sales7d - b.sales7d : b.sales7d - a.sales7d);
        }
        else if (sortBy === 'quantity') {
            items.sort((a, b) => sortOrder === 'asc' ? a.quantity7d - b.quantity7d : b.quantity7d - a.quantity7d);
        }
        return { items, total };
    }
    async getRestrictedDetail(id) {
        const result = await this.db
            .select()
            .from(schema_1.wechatProduct)
            .where((0, drizzle_orm_1.eq)(schema_1.wechatProduct.id, id))
            .limit(1);
        if (result.length === 0) {
            throw new common_1.NotFoundException('商品不存在');
        }
        const item = result[0];
        const maxDateResult = await this.db
            .select({ maxDate: (0, drizzle_orm_1.sql) `MAX(${schema_1.wechatProductDailySale.saleDate})`.as('max_date') })
            .from(schema_1.wechatProductDailySale);
        const maxDate = maxDateResult[0]?.maxDate;
        let sales7d = 0;
        let quantity7d = 0;
        let avgPrice = 0;
        if (maxDate) {
            const sevenDaysAgo = new Date(maxDate);
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
            const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];
            const salesResult = await this.db
                .select({
                sales7d: (0, drizzle_orm_1.sum)(schema_1.wechatProductDailySale.salesAmount),
                quantity7d: (0, drizzle_orm_1.sum)(schema_1.wechatProductDailySale.salesQuantity),
            })
                .from(schema_1.wechatProductDailySale)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.wechatProductDailySale.productId, id), (0, drizzle_orm_1.sql) `${schema_1.wechatProductDailySale.saleDate} >= ${sevenDaysAgoStr}::date`));
            sales7d = Number(salesResult[0]?.sales7d ?? 0);
            quantity7d = Number(salesResult[0]?.quantity7d ?? 0);
            avgPrice = quantity7d > 0 ? Number((sales7d / quantity7d).toFixed(2)) : 0;
        }
        const reasonAnalysisMap = {
            supply_chain: '当前核心供应商产能紧张，订单交付周期从7天延长至14天，无法支撑大规模投放带来的销量增长。建议尽快引入第二供应商，分散供应风险。',
            qualification: '商品涉及特殊功效成分，当前化妆品备案资质文件已过期，新备案正在药监部门审核中，预计2周内完成。在此期间不可进行付费推广。',
            profit_margin: '经测算，该商品综合毛利率为26%，低于30%的放量门槛。扣除投放费用、平台佣金和物流成本后，净利润空间有限，需先优化供应链成本。',
            other: '该商品目前处于包装升级阶段，新包装设计稿已确认，正在打样中。为避免品牌形象不一致，暂不进行大规模推广。',
        };
        const optimizeStepsMap = {
            supply_chain: [
                '联系现有供应商协商扩产计划，确认最快交付周期',
                '启动第二供应商寻源，3天内完成3家候选供应商初筛',
                '进行小批量试产验证，确保品质一致性',
                '建立安全库存机制，目标备货量提升至30天用量',
                '供应链稳定后逐步恢复投放，先从50%量级开始测试',
            ],
            qualification: [
                '跟进药监部门审核进度，每周更新备案状态',
                '准备完整的功效检测报告和安全评估资料',
                '同步准备新包装文案，确保合规表述',
                '备案通过后进行小规模测试，验证转化效果',
            ],
            profit_margin: [
                '与采购团队协商，目标采购成本下降8-10%',
                '优化包装设计，降低包材成本',
                '评估物流方案，寻找更优配送合作',
                '测算新毛利率，达到35%以上再启动放量',
                '考虑搭配高毛利商品组合销售',
            ],
            other: [
                '确认新包装打样完成时间，锁定上线日期',
                '准备新包装素材，提前完成图片和视频拍摄',
                '制定包装切换计划，确保库存平滑过渡',
                '新包装上线后先进行小规模投放测试',
            ],
        };
        const reason = item.restrictReason ?? 'other';
        const scaleHistory = [
            { date: '2026-07-10', action: '尝试信息流放量', result: '因供应不足，投放3天后暂停' },
            { date: '2026-07-05', action: '达人种草测试', result: 'ROI 1:2.8，转化效果良好' },
            { date: '2026-06-28', action: '首次放量评估', result: '识别限制因素，暂不建议放量' },
        ];
        return {
            id: item.id,
            name: item.name,
            sku: item.sku,
            category: item.category ?? '',
            restrictReason: reason,
            suggestion: item.suggestion ?? '',
            sales7d,
            quantity7d,
            isHighImpact: sales7d > 200000,
            canScale: item.canScale,
            remark: item.remark ?? '',
            avgPrice,
            scaleHistory,
            reasonAnalysis: reasonAnalysisMap[reason] ?? reasonAnalysisMap.other,
            optimizeSteps: optimizeStepsMap[reason] ?? optimizeStepsMap.other,
        };
    }
    async getProducts(params) {
        const { keyword, category, canScale, page, pageSize } = params;
        const conditions = [];
        if (keyword) {
            conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.wechatProduct.name, `%${keyword}%`), (0, drizzle_orm_1.like)(schema_1.wechatProduct.sku, `%${keyword}%`)));
        }
        if (category) {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.wechatProduct.category, category));
        }
        if (canScale !== undefined && canScale !== '') {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.wechatProduct.canScale, canScale === 'true'));
        }
        const whereClause = conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined;
        const [totalResult, items] = await Promise.all([
            this.db.select({ count: (0, drizzle_orm_1.count)() }).from(schema_1.wechatProduct).where(whereClause),
            this.db
                .select()
                .from(schema_1.wechatProduct)
                .where(whereClause)
                .orderBy((0, drizzle_orm_1.desc)(schema_1.wechatProduct.createdAt))
                .limit(pageSize)
                .offset((page - 1) * pageSize),
        ]);
        const total = Number(totalResult[0]?.count ?? 0);
        const formattedItems = items.map((item) => ({
            id: item.id,
            name: item.name,
            sku: item.sku,
            category: item.category ?? '',
            canScale: item.canScale,
            restrictReason: item.restrictReason ?? null,
            remark: item.remark ?? '',
        }));
        return { items: formattedItems, total };
    }
    async createProduct(dto) {
        const { name, sku, category, canScale, restrictReason, suggestion, remark } = dto;
        const existing = await this.db
            .select({ id: schema_1.wechatProduct.id })
            .from(schema_1.wechatProduct)
            .where((0, drizzle_orm_1.eq)(schema_1.wechatProduct.sku, sku))
            .limit(1);
        if (existing.length > 0) {
            throw new common_1.ConflictException('该SKU的商品已存在');
        }
        if (!canScale && !restrictReason) {
            throw new common_1.BadRequestException('不可放量商品必须填写限制原因');
        }
        try {
            const result = await this.db
                .insert(schema_1.wechatProduct)
                .values({
                name,
                sku,
                category,
                canScale,
                restrictReason: restrictReason ?? null,
                suggestion: suggestion ?? null,
                remark: remark ?? null,
            })
                .returning({ id: schema_1.wechatProduct.id });
            return { id: result[0].id };
        }
        catch (error) {
            this.logger.error(`创建商品失败: ${JSON.stringify(error)}`);
            throw error;
        }
    }
    async updateProduct(id, dto) {
        const { name, sku, category, canScale, restrictReason, suggestion, remark } = dto;
        const existing = await this.db
            .select({ id: schema_1.wechatProduct.id })
            .from(schema_1.wechatProduct)
            .where((0, drizzle_orm_1.eq)(schema_1.wechatProduct.id, id))
            .limit(1);
        if (existing.length === 0) {
            throw new common_1.NotFoundException('商品不存在');
        }
        if (!canScale && !restrictReason) {
            throw new common_1.BadRequestException('不可放量商品必须填写限制原因');
        }
        const skuConflict = await this.db
            .select({ id: schema_1.wechatProduct.id })
            .from(schema_1.wechatProduct)
            .where((0, drizzle_orm_1.eq)(schema_1.wechatProduct.sku, sku))
            .limit(2);
        if (skuConflict.length > 0 && skuConflict[0].id !== id) {
            throw new common_1.ConflictException('该SKU的商品已存在');
        }
        const result = await this.db
            .update(schema_1.wechatProduct)
            .set({
            name,
            sku,
            category,
            canScale,
            restrictReason: restrictReason ?? null,
            suggestion: suggestion ?? null,
            remark: remark ?? null,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.wechatProduct.id, id))
            .returning({ id: schema_1.wechatProduct.id });
        if (result.length === 0) {
            throw new common_1.NotFoundException('商品不存在');
        }
        return { success: true };
    }
    async setScaleStatus(id, dto) {
        const { canScale, restrictReason } = dto;
        const existing = await this.db
            .select({ id: schema_1.wechatProduct.id })
            .from(schema_1.wechatProduct)
            .where((0, drizzle_orm_1.eq)(schema_1.wechatProduct.id, id))
            .limit(1);
        if (existing.length === 0) {
            throw new common_1.NotFoundException('商品不存在');
        }
        if (!canScale && !restrictReason) {
            throw new common_1.BadRequestException('设置为不可放量时必须填写限制原因');
        }
        const result = await this.db
            .update(schema_1.wechatProduct)
            .set({
            canScale,
            restrictReason: restrictReason ?? null,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.wechatProduct.id, id))
            .returning({ id: schema_1.wechatProduct.id });
        if (result.length === 0) {
            throw new common_1.NotFoundException('商品不存在');
        }
        return { success: true };
    }
    async deleteProduct(id) {
        const result = await this.db
            .delete(schema_1.wechatProduct)
            .where((0, drizzle_orm_1.eq)(schema_1.wechatProduct.id, id))
            .returning({ id: schema_1.wechatProduct.id });
        if (result.length === 0) {
            throw new common_1.NotFoundException('商品不存在');
        }
        return { success: true };
    }
};
exports.ProductService = ProductService;
exports.ProductService = ProductService = ProductService_1 = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__param(0, (0, common_1.Inject)(fullstack_nestjs_core_1.DRIZZLE_DATABASE)),
    tslib_1.__metadata("design:paramtypes", [Function])
], ProductService);
