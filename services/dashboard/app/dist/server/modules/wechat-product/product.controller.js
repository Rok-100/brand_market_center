"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductController = void 0;
const tslib_1 = require("tslib");
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const product_service_1 = require("./product.service");
let ProductController = class ProductController {
    productService;
    constructor(productService) {
        this.productService = productService;
    }
    async getRestrictedSummary() {
        return this.productService.getRestrictedSummary();
    }
    async getRestrictedList(keyword, reason, sortBy, sortOrder, page, pageSize) {
        return this.productService.getRestrictedList({
            keyword,
            reason,
            sortBy,
            sortOrder,
            page: page ? parseInt(page, 10) : 1,
            pageSize: pageSize ? parseInt(pageSize, 10) : 20,
        });
    }
    async getRestrictedDetail(id) {
        return this.productService.getRestrictedDetail(id);
    }
    async getProducts(keyword, category, canScale, page, pageSize) {
        return this.productService.getProducts({
            keyword,
            category,
            canScale,
            page: page ? parseInt(page, 10) : 1,
            pageSize: pageSize ? parseInt(pageSize, 10) : 20,
        });
    }
    async createProduct(dto) {
        return this.productService.createProduct(dto);
    }
    async updateProduct(id, dto) {
        return this.productService.updateProduct(id, dto);
    }
    async setScaleStatus(id, dto) {
        return this.productService.setScaleStatus(id, dto);
    }
    async deleteProduct(id) {
        return this.productService.deleteProduct(id);
    }
};
exports.ProductController = ProductController;
tslib_1.__decorate([
    (0, common_1.Get)('restricted-products/summary'),
    openapi.ApiResponse({ status: 200 }),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", Promise)
], ProductController.prototype, "getRestrictedSummary", null);
tslib_1.__decorate([
    (0, common_1.Get)('restricted-products'),
    openapi.ApiResponse({ status: 200 }),
    tslib_1.__param(0, (0, common_1.Query)('keyword')),
    tslib_1.__param(1, (0, common_1.Query)('reason')),
    tslib_1.__param(2, (0, common_1.Query)('sortBy')),
    tslib_1.__param(3, (0, common_1.Query)('sortOrder')),
    tslib_1.__param(4, (0, common_1.Query)('page')),
    tslib_1.__param(5, (0, common_1.Query)('pageSize')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, String, String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], ProductController.prototype, "getRestrictedList", null);
tslib_1.__decorate([
    (0, common_1.Get)('restricted-products/:id'),
    openapi.ApiResponse({ status: 200 }),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], ProductController.prototype, "getRestrictedDetail", null);
tslib_1.__decorate([
    (0, common_1.Get)('products'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Query)('keyword')),
    tslib_1.__param(1, (0, common_1.Query)('category')),
    tslib_1.__param(2, (0, common_1.Query)('canScale')),
    tslib_1.__param(3, (0, common_1.Query)('page')),
    tslib_1.__param(4, (0, common_1.Query)('pageSize')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], ProductController.prototype, "getProducts", null);
tslib_1.__decorate([
    (0, common_1.Post)('products'),
    openapi.ApiResponse({ status: 201 }),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], ProductController.prototype, "createProduct", null);
tslib_1.__decorate([
    (0, common_1.Put)('products/:id'),
    openapi.ApiResponse({ status: 200 }),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], ProductController.prototype, "updateProduct", null);
tslib_1.__decorate([
    (0, common_1.Patch)('products/:id/scale-status'),
    openapi.ApiResponse({ status: 200 }),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], ProductController.prototype, "setScaleStatus", null);
tslib_1.__decorate([
    (0, common_1.Delete)('products/:id'),
    openapi.ApiResponse({ status: 200 }),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], ProductController.prototype, "deleteProduct", null);
exports.ProductController = ProductController = tslib_1.__decorate([
    (0, common_1.Controller)('api/wechat'),
    tslib_1.__metadata("design:paramtypes", [product_service_1.ProductService])
], ProductController);
