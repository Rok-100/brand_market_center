// Snapshot the exact business content before queueing. Delivery never rereads a draft.
export const CHAT_ID_PATTERN = /^oc_[a-zA-Z0-9]{8,128}$/;
export function normalizeChatId(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return '';
  if (typeof value !== 'string' || !CHAT_ID_PATTERN.test(value.trim())) {
    throw Object.assign(new Error('请填写有效的飞书群聊 ID（oc_ 开头），或留空不发送到群'), { status: 400 });
  }
  return value.trim();
}

export function scriptNoticeRows({eventId, kind, draft, user, chatId = ''}) {
  chatId = normalizeChatId(chatId);
  if (!['generated', 'alternative', 'approved'].includes(kind) || (chatId && kind !== 'approved')) throw new Error('Invalid script notification');
  // Budget for Markdown entity escaping and JSON quoting, including emoji.
  const chunks = []; let chunk = '', bytes = 0;
  for (const char of String(draft.content)) {
    const escaped = char.replace(/[&<>*~_\[\]`#]/g, ch => `&#${ch.charCodeAt(0)};`);
    const size = new TextEncoder().encode(JSON.stringify(escaped)).length;
    if (bytes + size > 14000 && chunk) { chunks.push(chunk); chunk = ''; bytes = 0; }
    chunk += char; bytes += size;
  }
  if (chunk) chunks.push(chunk);
  if (!chunks.length) throw new Error('Cannot notify an empty script');
  const label = kind === 'approved' ? '终审通过' : kind === 'alternative' ? 'AI 建议稿生成完成' : 'AI 脚本生成完成';
  const rows = chunks.map((content, index) => {
    const id = `SN-${eventId}-${String(index + 1).padStart(6, '0')}`;
    const snapshot = {schema: 1, kind, title: draft.title, content, product: draft.product,
      scriptType: draft.scriptType, draftId: draft.id, version: draft.version,
      actorName: user.name, chatId, part: index + 1, total: chunks.length};
    return {
      notice: {id, userId: user.id, draftId: draft.id, type: 'script_card', title: `${label}：${draft.title}`,
        detail: `${user.name} ${label}${chatId ? '，已加入群通知队列' : ''}${chunks.length > 1 ? `（${index + 1}/${chunks.length}）` : ''}`},
      payload: {notificationId: id, payload: JSON.stringify(snapshot)},
    };
  });
  return {notices: rows.map(r => r.notice), payloads: rows.map(r => r.payload)};
}
