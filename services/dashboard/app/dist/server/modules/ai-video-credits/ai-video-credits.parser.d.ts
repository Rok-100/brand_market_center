import type { AiVideoCreditsResponse, AiVideoCreditSourceMode } from '@shared/api.interface';
interface ParseAiVideoCreditsInput {
    annotatedCsv: string;
    range: string;
    revision: number | null;
    fetchedAt: string;
    mode: AiVideoCreditSourceMode;
}
declare function parseAiVideoCredits(input: ParseAiVideoCreditsInput): AiVideoCreditsResponse;
export { parseAiVideoCredits };
export type { ParseAiVideoCreditsInput };
