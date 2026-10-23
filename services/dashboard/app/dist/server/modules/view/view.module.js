"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViewModule = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const view_controller_1 = require("./view.controller");
let ViewModule = class ViewModule {
};
exports.ViewModule = ViewModule;
exports.ViewModule = ViewModule = tslib_1.__decorate([
    (0, common_1.Module)({
        controllers: [view_controller_1.ViewController],
        providers: [],
    })
], ViewModule);
