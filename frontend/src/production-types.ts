export type ProductionValue = { spend: number | null; gmv: number | null; roi?: number | null }
export type ProductionChannel = ProductionValue & { name: string; gmv_label: string; source: string; rows: number; assets: number; spend_rows: number; gmv_rows: number; roi_rows: number; latest_at: string | null }
export type ProductionAsset = { id: number; filename: string; product: string; creator: string; creator_number: string; tags: string[]; tasks: { id: string; product: string }[]; produced: boolean; reviewed: boolean; passed: boolean; delivered: boolean; channels: Record<string, ProductionValue> }
export type ProductionGroup = { key: string; label: string; assets: number; output: number; reviewed: number; passed: number; delivered: number; returned: number; channels: Record<string, ProductionValue> }
export type ProductionReport = {
  range: { start_date: string; end_date: string }; channel: string; dimension: string; generated_at: string; snapshot_id: string;
  summary: { assets: number; output: number; source: number; remix: number; reviewed: number; passed: number; delivered: number; returned: number; delivery_tasks: number };
  channels: Record<string, ProductionChannel>; daily: { date: string; output: number; channels: Record<string, ProductionValue> }[];
  groups: ProductionGroup[]; items: ProductionAsset[]; total: number; page: number; page_size: number;
  coverage: { daily_rows: number; ambiguous_rows: number; invalid_rows: number; quality_score: number | null; quality_message: string; notes: string[] };
}
