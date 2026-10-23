"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HTTP_STATUS_TO_RESPONSE_CODE_MAP = exports.RESPONSE_CODE_TO_HTTP_STATUS_MAP = exports.ResponseCode = void 0;
const common_1 = require("@nestjs/common");
// 业务状态码与HTTP状态码的映射
var ResponseCode;
(function (ResponseCode) {
    // 成功状态
    ResponseCode["SUCCESS"] = "SUCCESS";
    ResponseCode["CREATED"] = "CREATED";
    ResponseCode["ACCEPTED"] = "ACCEPTED";
    ResponseCode["NO_CONTENT"] = "NO_CONTENT";
    // 客户端错误
    ResponseCode["BAD_REQUEST"] = "BAD_REQUEST";
    ResponseCode["UNAUTHORIZED"] = "UNAUTHORIZED";
    ResponseCode["FORBIDDEN"] = "FORBIDDEN";
    ResponseCode["NOT_FOUND"] = "NOT_FOUND";
    ResponseCode["VALIDATION_ERROR"] = "VALIDATION_ERROR";
    ResponseCode["CONFLICT"] = "CONFLICT";
    ResponseCode["TOO_MANY_REQUESTS"] = "TOO_MANY_REQUESTS";
    // 服务端错误
    ResponseCode["INTERNAL_ERROR"] = "INTERNAL_ERROR";
    ResponseCode["BAD_GATEWAY"] = "BAD_GATEWAY";
    ResponseCode["SERVICE_UNAVAILABLE"] = "SERVICE_UNAVAILABLE";
    // 业务错误
    ResponseCode["BUSINESS_ERROR"] = "BUSINESS_ERROR";
})(ResponseCode || (exports.ResponseCode = ResponseCode = {}));
// 状态码映射配置
exports.RESPONSE_CODE_TO_HTTP_STATUS_MAP = {
    [ResponseCode.SUCCESS]: common_1.HttpStatus.OK,
    [ResponseCode.CREATED]: common_1.HttpStatus.CREATED,
    [ResponseCode.ACCEPTED]: common_1.HttpStatus.ACCEPTED,
    [ResponseCode.NO_CONTENT]: common_1.HttpStatus.NO_CONTENT,
    [ResponseCode.BAD_REQUEST]: common_1.HttpStatus.BAD_REQUEST,
    [ResponseCode.UNAUTHORIZED]: common_1.HttpStatus.UNAUTHORIZED,
    [ResponseCode.FORBIDDEN]: common_1.HttpStatus.FORBIDDEN,
    [ResponseCode.NOT_FOUND]: common_1.HttpStatus.NOT_FOUND,
    [ResponseCode.VALIDATION_ERROR]: common_1.HttpStatus.UNPROCESSABLE_ENTITY,
    [ResponseCode.CONFLICT]: common_1.HttpStatus.CONFLICT,
    [ResponseCode.TOO_MANY_REQUESTS]: common_1.HttpStatus.TOO_MANY_REQUESTS,
    [ResponseCode.INTERNAL_ERROR]: common_1.HttpStatus.INTERNAL_SERVER_ERROR,
    [ResponseCode.BAD_GATEWAY]: common_1.HttpStatus.BAD_GATEWAY,
    [ResponseCode.SERVICE_UNAVAILABLE]: common_1.HttpStatus.SERVICE_UNAVAILABLE,
    [ResponseCode.BUSINESS_ERROR]: common_1.HttpStatus.UNPROCESSABLE_ENTITY, // 通用业务错误状态码
};
// 自动生成的HTTP状态码映射
exports.HTTP_STATUS_TO_RESPONSE_CODE_MAP = Object.fromEntries(Object.entries(exports.RESPONSE_CODE_TO_HTTP_STATUS_MAP).map(([code, status]) => [status, code]));
