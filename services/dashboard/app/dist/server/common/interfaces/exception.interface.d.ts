import { HttpStatus } from '@nestjs/common';
import { ResponseCode } from '../constants/api_response_code';
export declare class BusinessException extends Error {
    readonly code: ResponseCode;
    readonly message: string;
    readonly httpStatus: HttpStatus;
    readonly details?: string;
    readonly fieldErrors?: Record<string, string[]>;
    constructor(code: ResponseCode, message: string, httpStatus?: HttpStatus, details?: string, fieldErrors?: Record<string, string[]>);
    getHttpStatus(): HttpStatus;
}
