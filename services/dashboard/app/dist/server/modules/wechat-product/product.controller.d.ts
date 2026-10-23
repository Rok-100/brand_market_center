import { ProductService } from './product.service';
import type { CreateProductRequest, UpdateProductRequest, SetScaleStatusRequest } from '@shared/product';
export declare class ProductController {
    private readonly productService;
    constructor(productService: ProductService);
    getRestrictedSummary(): Promise<{
        totalCount: number;
        impactAmount7d: number;
        reasonDistribution: {
            reason: import("@shared/product").RestrictReason;
            count: number;
            ratio: number;
        }[];
    }>;
    getRestrictedList(keyword?: string, reason?: string, sortBy?: string, sortOrder?: string, page?: string, pageSize?: string): Promise<{
        items: {
            id: string;
            name: string;
            sku: string;
            category: string;
            restrictReason: import("@shared/product").RestrictReason;
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
        restrictReason: import("@shared/product").RestrictReason;
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
    getProducts(keyword?: string, category?: string, canScale?: string, page?: string, pageSize?: string): Promise<import("@shared/product").ProductsListResponse>;
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
