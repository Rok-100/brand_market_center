export type RestrictReason = 'supply_chain' | 'qualification' | 'profit_margin' | 'other';
export interface ReasonDistributionItem {
    reason: RestrictReason;
    count: number;
    ratio: number;
}
export interface RestrictedProductsSummary {
    totalCount: number;
    impactAmount7d: number;
    reasonDistribution: ReasonDistributionItem[];
}
export interface RestrictedProductItem {
    id: string;
    name: string;
    sku: string;
    category: string;
    restrictReason: RestrictReason;
    suggestion: string;
    sales7d: number;
    quantity7d: number;
    isHighImpact: boolean;
}
export interface RestrictedProductDetail extends RestrictedProductItem {
    canScale: boolean;
    remark: string;
    avgPrice: number;
    scaleHistory: Array<{
        date: string;
        action: string;
        result: string;
    }>;
    reasonAnalysis: string;
    optimizeSteps: string[];
}
export interface RestrictedProductsListResponse {
    items: RestrictedProductItem[];
    total: number;
}
export interface ProductBasic {
    id: string;
    name: string;
    sku: string;
    category: string;
}
export interface ProductItem extends ProductBasic {
    canScale: boolean;
    restrictReason: RestrictReason | null;
    remark: string;
}
export interface ProductsListResponse {
    items: ProductItem[];
    total: number;
}
export interface CreateProductRequest {
    name: string;
    sku: string;
    category: string;
    canScale: boolean;
    restrictReason?: RestrictReason;
    suggestion?: string;
    remark?: string;
}
export interface UpdateProductRequest extends CreateProductRequest {
}
export interface SetScaleStatusRequest {
    canScale: boolean;
    restrictReason?: RestrictReason;
}
