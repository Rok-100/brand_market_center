"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const fullstack_nestjs_core_1 = require("@lark-apaas/fullstack-nestjs-core");
const path_1 = require("path");
const hbs_1 = require("hbs");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        abortOnError: process.env.NODE_ENV !== 'development',
    });
    await (0, fullstack_nestjs_core_1.configureApp)(app, {
        disableSwagger: true,
    });
    const logger = new common_1.Logger('Bootstrap');
    const host = process.env.SERVER_HOST || 'localhost';
    const port = Number(process.env.SERVER_PORT || '3000');
    const clientBasePath = (process.env.CLIENT_BASE_PATH || '').replace(/\/+$/, '');
    const companyOaEnabled = /^(1|true|yes|on)$/i.test(process.env.COMPANY_OA_AUTH_ENABLED || '');
    // 注册视图引擎, 渲染 client 目录下的 html 文件
    app.setBaseViewsDir((0, path_1.join)(process.cwd(), 'dist/client'));
    app.setViewEngine('html');
    app.engine('html', hbs_1.__express);
    // 妙搭平台会代管前端构建产物；公司服务器没有这层静态资源代理，
    // 因此仅在公司 OA 模式下从生产包的 client 目录显式提供 JS/CSS/图片。
    if (companyOaEnabled) {
        app.useStaticAssets((0, path_1.join)(process.cwd(), 'client'), {
            prefix: clientBasePath ? `${clientBasePath}/` : '/',
            index: false,
            redirect: false,
        });
    }
    await app.listen(port, host);
    logger.log(`Server running on ${host}:${port}`);
    logger.log(`API endpoints ready at http://${host}:${port}/api`);
}
bootstrap();
