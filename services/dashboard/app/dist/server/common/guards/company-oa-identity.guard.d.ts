import { CanActivate, ExecutionContext } from '@nestjs/common';
export declare class CompanyOaIdentityGuard implements CanActivate {
    private readonly cache;
    private enabled;
    private readOaUser;
    canActivate(context: ExecutionContext): Promise<boolean>;
}
