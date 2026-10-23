"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompanyOaIdentityGuard = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const OA_CACHE_TTL_MS = 5 * 60 * 1000;
const OA_CACHE_MAX_ENTRIES = 256;
function firstText(source, keys) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.trim())
            return value.trim();
        if (typeof value === 'number' && Number.isFinite(value))
            return String(value);
    }
    return '';
}
function tokenFromHeader(req) {
    const raw = req.headers['x-oa-token'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string')
        return '';
    return value.replace(/^Bearer\s+/i, '').trim();
}
function tokenCacheKey(token) {
    return (0, crypto_1.createHash)('sha256').update(token).digest('hex');
}
let CompanyOaIdentityGuard = class CompanyOaIdentityGuard {
    cache = new Map();
    enabled() {
        return /^(1|true|yes|on)$/i.test(process.env.COMPANY_OA_AUTH_ENABLED || '');
    }
    async readOaUser(token) {
        const key = tokenCacheKey(token);
        const cached = this.cache.get(key);
        if (cached && cached.expiresAt > Date.now())
            return cached.user;
        if (cached)
            this.cache.delete(key);
        const baseUrl = (process.env.COMPANY_OA_API_BASE_URL || 'https://api.fandow.com').replace(/\/$/, '');
        let response;
        try {
            response = await fetch(`${baseUrl}/auth/userinfo`, {
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                signal: AbortSignal.timeout(12_000),
            });
        }
        catch {
            throw new common_1.ServiceUnavailableException('公司 OA 身份服务暂时不可用');
        }
        let payload = {};
        try {
            payload = (await response.json());
        }
        catch {
            payload = {};
        }
        const user = payload.data && typeof payload.data === 'object'
            ? payload.data
            : null;
        if (!response.ok || Number(payload.code) !== 0 || !user) {
            throw new common_1.UnauthorizedException('公司 OA 登录状态已失效');
        }
        if (this.cache.size >= OA_CACHE_MAX_ENTRIES) {
            const oldest = this.cache.keys().next().value;
            if (oldest)
                this.cache.delete(oldest);
        }
        this.cache.set(key, { expiresAt: Date.now() + OA_CACHE_TTL_MS, user });
        return user;
    }
    async canActivate(context) {
        if (!this.enabled() || context.getType() !== 'http')
            return true;
        const request = context.switchToHttp().getRequest();
        const path = request.originalUrl || request.url || request.path;
        if (/\/api\/health(?:\?|$)/.test(path))
            return true;
        // The company Nginx gateway protects page and asset routes. API routes also
        // validate the forwarded OA token here before constructing userContext.
        if (!/\/api(?:\/|\?|$)/.test(path))
            return true;
        if (/^(1|true)$/i.test(process.env.HUB_INTEGRATED_MODE || '')) {
            const { readCentralIdentity } = require('./central-identity.cjs');
            try {
                request.userContext = await readCentralIdentity(request, process.env.CENTRAL_AUTHORITY_BASE);
            } catch (error) {
                if (error.status === 401) throw new common_1.UnauthorizedException(error.message);
                if (error.status === 403) throw new common_1.ForbiddenException(error.message);
                throw new common_1.ServiceUnavailableException('中枢身份服务暂时不可用');
            }
            return true;
        }
        const token = tokenFromHeader(request);
        if (!token)
            throw new common_1.UnauthorizedException('请使用公司 OA 账号登录');
        const user = await this.readOaUser(token);
        const userId = firstText(user, ['open_id', 'openId', 'userId', 'user_id', 'id', 'number']);
        const userName = firstText(user, ['realName', 'name', 'userName', 'username']);
        const jobTitle = firstText(user, ['deptJobName', 'jobName', 'title', 'roleName']);
        if (!userId || !userName)
            throw new common_1.UnauthorizedException('公司 OA 用户信息不完整');
        const roles = Array.isArray(user.roles)
            ? user.roles
            : [user.roleName, user.jobName, user.deptJobName].filter(Boolean);
        request.userContext = {
            ...(request.userContext || {}),
            userId,
            userName,
            roles: roles,
            userType: 'company_oa',
            env: 'runtime',
        };
        Object.assign(request.userContext, {
            jobTitle: jobTitle || null,
            userProfile: {
                ...user,
                name: userName,
                displayName: userName,
                jobTitle: jobTitle || null,
            },
        });
        return true;
    }
};
exports.CompanyOaIdentityGuard = CompanyOaIdentityGuard;
exports.CompanyOaIdentityGuard = CompanyOaIdentityGuard = tslib_1.__decorate([
    (0, common_1.Injectable)()
], CompanyOaIdentityGuard);
