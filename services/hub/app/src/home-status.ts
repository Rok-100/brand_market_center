export function readbackError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause || '');
  if (/timed? ?out|timeout|abort|signal timed/i.test(message)) return '读取超时，正在自动重试；也可点击刷新。';
  if (/failed to fetch|networkerror|network request/i.test(message)) return '连接暂时中断，请检查网络后刷新。';
  return message || '暂未读到数据，请稍后刷新。';
}
