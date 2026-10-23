"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViewController = void 0;
const tslib_1 = require("tslib");
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const view_platform_1 = require("./view-platform");
let ViewController = class ViewController {
    async render(req) {
        // you can add custom render params here
        const platformData = req.__platform_data__ ?? {};
        return {
            // don't delete this line, it's used by client to get platform info
            __platform__: JSON.stringify((0, view_platform_1.platformDataForRender)(platformData)),
        };
    }
};
exports.ViewController = ViewController;
tslib_1.__decorate([
    (0, common_1.Get)(['/', '*']),
    (0, common_1.Render)('index'),
    openapi.ApiResponse({ status: 200 }),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], ViewController.prototype, "render", null);
exports.ViewController = ViewController = tslib_1.__decorate([
    (0, common_1.Controller)()
], ViewController);
