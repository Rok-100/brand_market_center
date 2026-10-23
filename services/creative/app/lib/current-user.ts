import { env } from "cloudflare:workers";
import { ensureWorkflowSchema } from "./workflow-schema";
import { oaTokenFromHeaders } from "./oa-identity-token";
import { verifiedCreativeIdentity } from "./central-creative-access";

export type WorkspaceUser = {
  id: string;
  employeeNo: string;
  externalUserId: string;
  email: string;
  name: string;
  department: string;
  center: string;
  jobTitle: string;
  feishuUserId: string;
  role: "contributor" | "team_lead" | "supervisor" | "director" | "admin";
  active: boolean;
  loginRegistered: boolean;
  preloaded: boolean;
  lastSeenAt: string;
};

type Identity = Omit<WorkspaceUser, "id" | "role" | "active" | "loginRegistered" | "preloaded" | "lastSeenAt">;

async function identityFromRequest(request: Request): Promise<Identity> {
  const headers = request.headers;
  // On hub.fandow.com the ingress does not authenticate requests. Client-set
  // oai-authenticated-user-* headers cannot establish an identity here.
  const oaToken = oaTokenFromHeaders(headers);
  const runtime = env as unknown as { CENTRAL_AUTHORITY_BASE?: string };
  if (oaToken) {
    const authorityBase = String(runtime.CENTRAL_AUTHORITY_BASE ?? "").replace(/\/+$/, "");
    if (!authorityBase) throw new Error("统一权限服务尚未配置");
    const response = await fetch(`${authorityBase}/central-auth/me`, { headers: { "X-OA-Token": oaToken } });
    if (!response.ok) throw new Error(response.status === 403 ? "当前账号未获授权" : "统一身份读取失败");
    return verifiedCreativeIdentity(await response.json());
  }

  throw new Error("统一登录未向应用传递员工身份，请重新登录后再试");
}

function mapUser(row: Record<string, unknown>): WorkspaceUser {
  return {
    id: String(row.id), employeeNo: String(row.employee_no), externalUserId: String(row.external_user_id ?? ""),
    email: String(row.email ?? ""), name: String(row.name), department: String(row.department ?? ""), center: String(row.center ?? ""),
    jobTitle: String(row.job_title ?? ""), feishuUserId: String(row.feishu_user_id ?? ""),
    role: String(row.role ?? "contributor") as WorkspaceUser["role"], active: Number(row.active ?? 1) === 1,
    loginRegistered: Number(row.login_registered ?? 0) === 1, lastSeenAt: String(row.last_seen_at ?? ""),
    preloaded: Number(row.preloaded ?? 0) === 1,
  };
}

function isEmployeeNumber(value: string) {
  return /^[A-Za-z]{2}-\d+$/.test(value.trim());
}

export async function getCurrentUser(request: Request): Promise<WorkspaceUser> {
  await ensureWorkflowSchema();
  const identity = await identityFromRequest(request);
  const id = `USR-${identity.employeeNo.replace(/[^a-zA-Z0-9_-]/g, "-").toUpperCase()}`;
  const canonical = await env.DB.prepare("SELECT * FROM workspace_users WHERE UPPER(employee_no) = UPPER(?) LIMIT 1")
    .bind(identity.employeeNo).first<Record<string, unknown>>();
  const canonicalId = String(canonical?.id ?? id);
  const storedRole = String(canonical?.role ?? "contributor");
  const role = (["team_lead", "supervisor", "director", "admin"].includes(storedRole) ? storedRole : "contributor");

  const production = env.DB as typeof env.DB & {isProductionMysql?: boolean; isWritable: () => Promise<boolean>};
  if (canonical && production.isProductionMysql) {
    // Preserve deployed OA verification, read-only support and profile write coalescing.
    if (!(await production.isWritable())) {
      if (Number(canonical.active ?? 1) !== 1) throw new Error("当前账号未启用");
      return mapUser(canonical);
    }
    const sameProfile = String(canonical.name ?? "") === identity.name &&
      String(canonical.department ?? "") === identity.department &&
      String(canonical.center ?? "") === identity.center &&
      String(canonical.job_title ?? "") === identity.jobTitle &&
      String(canonical.email ?? "") === (identity.email || String(canonical.email ?? "")) &&
      String(canonical.employee_no ?? "") === identity.employeeNo &&
      String(canonical.external_user_id ?? "") === identity.externalUserId &&
      String(canonical.feishu_user_id ?? "") === (identity.feishuUserId || String(canonical.feishu_user_id ?? "")) &&
      Number(canonical.active) === 1 && Number(canonical.login_registered) === 1;
    const lastSeen = Date.parse(String(canonical.last_seen_at ?? ""));
    if (sameProfile && Number.isFinite(lastSeen) && Date.now() - lastSeen >= 0 && Date.now() - lastSeen < 60000) return mapUser(canonical);
  }
  if (canonical) {
    const employeeNo = isEmployeeNumber(String(canonical.employee_no ?? "")) && !isEmployeeNumber(identity.employeeNo)
      ? String(canonical.employee_no)
      : identity.employeeNo;
    const email = identity.email || String(canonical.email ?? "");
    const externalUserId = isEmployeeNumber(employeeNo) && !isEmployeeNumber(identity.employeeNo)
      ? String(canonical.external_user_id ?? "")
      : identity.externalUserId;
    await env.DB.prepare(`UPDATE workspace_users SET external_user_id=?, email=?, name=?, department=?, center=?, job_title=?,
      feishu_user_id=?, employee_no=?, role=?, active=1, login_registered=1, last_seen_at=? WHERE id=?`)
      .bind(externalUserId, email, identity.name, identity.department, identity.center, identity.jobTitle,
        identity.feishuUserId || String(canonical.feishu_user_id ?? ""), employeeNo, role, new Date().toISOString(), canonicalId).run();
  } else {
    await env.DB.prepare(`INSERT INTO workspace_users
      (id, employee_no, external_user_id, email, name, department, center, job_title, feishu_user_id, role, active, login_registered, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`)
      .bind(id, identity.employeeNo, identity.externalUserId, identity.email, identity.name, identity.department, identity.center, identity.jobTitle, identity.feishuUserId, role, new Date().toISOString()).run();
  }
  const result = await env.DB.prepare("SELECT * FROM workspace_users WHERE id = ? LIMIT 1").bind(canonicalId).first<Record<string, unknown>>();
  if (!result) throw new Error("用户初始化失败");
  return mapUser(result);
}

export async function listWorkspaceUsers(): Promise<WorkspaceUser[]> {
  await ensureWorkflowSchema();
  const result = await env.DB.prepare("SELECT * FROM workspace_users WHERE active = 1 AND (login_registered = 1 OR preloaded = 1) ORDER BY name ASC").all<Record<string, unknown>>();
  const users: WorkspaceUser[] = (result.results ?? []).map(mapUser).sort((a, b) => Number(b.loginRegistered) - Number(a.loginRegistered));
  return Array.from(new Map<string, WorkspaceUser>(users.map((user) => [user.employeeNo || user.id, user])).values())
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || a.employeeNo.localeCompare(b.employeeNo));
}

export function isManager(user: WorkspaceUser) {
  return ["team_lead", "supervisor", "director", "admin"].includes(user.role);
}
