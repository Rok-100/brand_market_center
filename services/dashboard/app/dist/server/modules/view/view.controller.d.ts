import type { Request } from 'express';
export declare class ViewController {
    render(req: Request): Promise<{
        __platform__: string;
    }>;
}
