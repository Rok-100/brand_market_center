export function verifiedCreativeIdentity(payload: unknown) {
  const result = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const access = result.access && typeof result.access === "object" ? result.access as Record<string, unknown> : {};
  if (!Array.isArray(access.allowed_modules) || !access.allowed_modules.includes("creative-hub")) {
    throw new Error("当前账号未开通创意来源权限");
  }
  const data = result.user && typeof result.user === "object" ? result.user as Record<string, unknown> : {};
  const employeeNo = String(data.number ?? "").trim();
  const name = String(data.realName ?? data.name ?? "").trim();
  if (!/^[A-Za-z]{2}-\d+$/u.test(employeeNo) || !name || String(data.status ?? "") !== "normal") {
    throw new Error("OA身份信息无效或账号已冻结");
  }
  return {
    employeeNo,
    externalUserId: String(data.userId ?? employeeNo).trim(),
    email: "",
    name,
    department: String(data.department ?? data.groupName ?? "").trim(),
    center: String(data.center ?? data.parentDept ?? "").trim(),
    jobTitle: String(data.jobTitle ?? "").trim(),
    feishuUserId: "",
  };
}
