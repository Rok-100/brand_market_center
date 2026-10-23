"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalExceptionFilter = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const exception_interface_1 = require("../interfaces/exception.interface");
const api_response_code_1 = require("../constants/api_response_code");
// 全局异常过滤器，用于捕获所有未处理的异常
let GlobalExceptionFilter = class GlobalExceptionFilter {
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        // 如果响应头已发送，则不处理
        if (response.headersSent) {
            return;
        }
        let errorResponse;
        let httpStatus;
        if (exception instanceof exception_interface_1.BusinessException) {
            // 业务异常
            httpStatus = exception.httpStatus;
            errorResponse = {
                error: {
                    code: exception.code,
                    message: exception.message,
                    details: exception.details,
                    fieldErrors: exception.fieldErrors,
                    timestamp: Date.now(),
                },
            };
        }
        else if (exception instanceof common_1.HttpException) {
            // HTTP异常
            httpStatus = exception.getStatus();
            const exceptionResponse = exception.getResponse();
            errorResponse = {
                error: {
                    code: api_response_code_1.HTTP_STATUS_TO_RESPONSE_CODE_MAP[httpStatus],
                    message: typeof exceptionResponse === 'string' ? exceptionResponse : exception.message,
                    details: typeof exceptionResponse === 'object' ? JSON.stringify(exceptionResponse) : undefined,
                    timestamp: Date.now(),
                },
            };
        }
        else if (typeof exception === 'object' &&
            exception !== null &&
            exception.code === '22P02') {
            // Postgres invalid_text_representation：路径/查询参数与列类型不匹配（最常见是非法 UUID）
            // 与「合法 UUID 但记录不存在」走同一条 not-found 语义，避免 500 噪声
            httpStatus = common_1.HttpStatus.NOT_FOUND;
            errorResponse = {
                error: {
                    code: api_response_code_1.ResponseCode.NOT_FOUND,
                    message: '资源不存在',
                    timestamp: Date.now(),
                },
            };
        }
        else if (exception instanceof Error && /FANDOM_DATA_MCP_TOKEN 未配置|公司登录状态无效/.test(exception.message)) {
            httpStatus = common_1.HttpStatus.SERVICE_UNAVAILABLE;
            errorResponse = { error: { code: 'SOURCE_AUTH_UNAVAILABLE', message: '根数据来源授权待恢复，暂不能读取最新经营数据。已有历史数据未删除，请勿重复导入。', timestamp: Date.now() } };
        }
        else {
            // 未知异常
            httpStatus = common_1.HttpStatus.INTERNAL_SERVER_ERROR;
            errorResponse = {
                error: {
                    code: api_response_code_1.ResponseCode.INTERNAL_ERROR,
                    message: '服务器内部错误',
                    timestamp: Date.now(),
                },
            };
        }
        response.status(httpStatus).json(errorResponse);
    }
};
exports.GlobalExceptionFilter = GlobalExceptionFilter;
exports.GlobalExceptionFilter = GlobalExceptionFilter = tslib_1.__decorate([
    (0, common_1.Catch)()
], GlobalExceptionFilter);
