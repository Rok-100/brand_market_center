import type { AdmissionStatus } from './types';

export function admissionInput(value: string): {realName: string; userNumber: string} {
  const input = value.trim();
  const number = /^([a-z]{2})-?(\d{3,8})$/iu.exec(input);
  if (number) return {realName: '', userNumber: `${number[1].toUpperCase()}-${number[2]}`};
  if (/^[a-z]{2}[-\s]*\d/iu.test(input) || /^(?:FD|OD)[-－—–]/iu.test(input)) throw new Error('工号格式不正确，请填写完整 OA 工号，例如 FD-068989。');
  if (input.length < 2 || /[,，;；\n\r]/u.test(input)) throw new Error('请填写一位同事的完整 OA 工号或真实姓名。');
  return {realName: input, userNumber: ''};
}

export function admissionPresentation(row: AdmissionStatus & {active?: boolean; login_active?: boolean; login_blocked?: boolean}) {
  if (row.login_blocked) return {label: '禁止登录', tone: 'blocked', reason: row.admission_reason || '账号已被禁止登录，请核对成员状态。'};
  if (row.identity_status === 'conflict') return {label: '身份需核对', tone: 'pending', reason: row.admission_reason || '授权身份存在冲突，请核对工号。'};
  if (row.admission_status === 'blocked') return {label: '禁止登录', tone: 'blocked', reason: row.admission_reason || '账号已被禁止登录，请核对成员状态。'};
  if (row.admission_status === 'revoked') return {label: '例外已取消', tone: 'revoked', reason: row.admission_reason || '已取消跨部门例外准入。'};
  if (row.admission_status === 'allowed' && row.identity_status === 'number_bound' && row.effective_login_active === true) {
    return {label: '工号已授权', tone: 'active', reason: row.admission_reason || 'OA 账号校验通过后，可按已授权界面进入。'};
  }
  if (row.identity_status === 'name_pending' || row.verification_required) return {label: '姓名待核验', tone: 'pending', reason: row.admission_reason || '首次 OA 登录匹配姓名后生效；建议使用工号授权。'};
  if (row.active === false || row.login_active === false) return {label: '例外已取消', tone: 'revoked', reason: row.admission_reason || '已取消跨部门例外准入。'};
  return {label: '已保存 · 待核验', tone: 'pending', reason: row.admission_reason || '尚未取得完整准入状态，请刷新核验。'};
}
