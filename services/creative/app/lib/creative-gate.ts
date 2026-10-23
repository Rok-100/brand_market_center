import { oaTokenFromHeaders } from "./oa-identity-token.ts";
import { verifiedCreativeIdentity } from "./central-creative-access.ts";

export async function authorizeCreativeHttp(
  request: Request,
  authorityBase: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; error?: string }> {
  const token = oaTokenFromHeaders(request.headers);
  if (!token) return { status: 401, error: "请先登录中枢" };
  const base = authorityBase.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/?#]+(?:\/[^?#]*)?$/u.test(base)) {
    return { status: 503, error: "统一权限服务尚未配置" };
  }
  try {
    const response = await fetchImpl(`${base}/central-auth/me`, {
      headers: { "X-OA-Token": token },
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) {
      return { status: response.status, error: "当前账号未获授权" };
    }
    if (!response.ok || response.status >= 300) {
      return { status: 503, error: "统一权限服务暂时不可用" };
    }
    verifiedCreativeIdentity(await response.json());
    return { status: 200 };
  } catch (error) {
    return {
      status: error instanceof Error && /权限|冻结|身份/u.test(error.message) ? 403 : 503,
      error: "无法核验当前账号的创意来源权限",
    };
  }
}
