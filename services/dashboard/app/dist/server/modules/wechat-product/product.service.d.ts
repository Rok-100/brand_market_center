import { type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { CreateProductRequest, UpdateProductRequest, SetScaleStatusRequest, ProductsListResponse, RestrictReason } from '@shared/product';
interface ListParams {
    keyword?: string;
    reason?: string;
    sortBy?: string;
    sortOrder?: string;
    page: number;
    pageSize: number;
}
interface ProductListParams {
    keyword?: string;
    category?: string;
    canScale?: string;
    page: number;
    pageSize: number;
}
export declare class ProductService {
    private readonly db;
    private readonly logger;
    constructor(db: PostgresJsDatabase);
    getRestrictedSummary(): Promise<{
        totalCount: number;
        impactAmount7d: number;
        reasonDistribution: {
            reason: RestrictReason;
            count: number;
            ratio: number;
        }[];
    }>;
    getRestrictedList(params: ListParams): Promise<{
        items: {
            id: string;
            name: string;
            sku: string;
            category: string;
            restrictReason: RestrictReason;
            suggestion: string;
            sales7d: number;
            quantity7d: number;
            isHighImpact: boolean;
        }[];
        total: number;
    }>;
    getRestrictedDetail(id: string): Promise<{
        id: string;
        name: string;
        sku: string;
        category: string;
        restrictReason: RestrictReason;
        suggestion: string;
        sales7d: number;
        quantity7d: number;
        isHighImpact: boolean;
        canScale: boolean;
        remark: string;
        avgPrice: number;
        scaleHistory: {
            date: string;
            action: string;
            result: string;
        }[];
        reasonAnalysis: string;
        optimizeSteps: string[];
    }>;
    getProducts(params: ProductListParams): Promise<ProductsListResponse>;
    createProduct(dto: CreateProductRequest): Promise<{
        id: string;
    }>;
    updateProduct(id: string, dto: UpdateProductRequest): Promise<{
        success: boolean;
    }>;
    setScaleStatus(id: string, dto: SetScaleStatusRequest): Promise<{
        success: boolean;
    }>;
    deleteProduct(id: string): Promise<{
        success: boolean;
    }>;
}
export {};
