"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessException = void 0;
// 业务异常类
const common_1 = require("@nestjs/common");
const api_response_code_1 = require("../constants/api_response_code");
class BusinessException extends Error {
    code;
    message;
    httpStatus;
    details;
    fieldErrors;
    constructor(code, message, httpStatus = common_1.HttpStatus.BAD_REQUEST, details, fieldErrors) {
        super(message);
        this.code = code;
        this.message = message;
        this.httpStatus = httpStatus;
        this.details = details;
        this.fieldErrors = fieldErrors;
        this.name = 'BusinessException';
    }
    getHttpStatus() {
        return api_response_code_1.RESPONSE_CODE_TO_HTTP_STATUS_MAP[this.code];
    }
}
exports.BusinessException = BusinessException;
