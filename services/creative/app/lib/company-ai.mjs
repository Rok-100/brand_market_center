export const COMPANY_AI_BASE = 'https://cloud.fandow.com/gpt/company-system-jump/v1';
export const COMPANY_AI_MODEL = 'deepseek-flash';
export const COMPANY_AI_SYSTEM = 'brand-market-center';

export function companyAiError(message, status = 502) {
  return Object.assign(new Error(message), { status, details: 'company_ai_error' });
}

export function oaTokenFromRequest(headers) {
  const get = name => typeof headers?.get === 'function' ? headers.get(name) : headers?.[name];
  const direct = String(get('x-oa-token') || '').trim();
  if (direct) return direct.replace(/^Bearer\s+/iu, '').trim();
  const cookies = String(get('cookie') || '').split(';').map(part => part.trim());
  for (const name of ['wis_oa_session', 'authorization', 'oa-authorization']) {
    const value = cookies.find(part => part.startsWith(name + '='))?.slice(name.length + 1);
    if (!value || value.length > 8192) continue;
    try { return decodeURIComponent(value).replace(/^Bearer\s+/iu, '').trim(); } catch { return ''; }
  }
  return '';
}

function statusError(status) {
  return companyAiError(status === 401 || status === 403
    ? '公司 AI 登录凭证已失效或无调用权限，请重新登录 OA 后重试。'
    : status === 429 ? '公司 AI 当前繁忙，请稍后重试。'
    : `公司 AI 服务暂时不可用（HTTP ${status}）。`, status === 401 || status === 403 ? 401 : 502);
}

async function readCompletion(response) {
  if (!(response.headers.get('content-type') || '').includes('text/event-stream')) {
    const body = await response.json().catch(() => null);
    if (body?.error || (body?.code !== undefined && body.code !== 0)) throw companyAiError('公司 AI 返回错误，请稍后重试。');
    const choice = body?.choices?.[0];
    if (choice?.finish_reason !== 'stop') throw companyAiError('AI 返回的内容不完整，请减少生成数量后重试。');
    return String(choice.message?.content || '');
  }
  if (!response.body) throw companyAiError('公司 AI 未返回生成内容。');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', text = '', finished = false, stopped = false, bytes = 0;
  const event = raw => {
    const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!data) return;
    if (data === '[DONE]') { finished = true; return; }
    let value;
    try { value = JSON.parse(data); } catch { throw companyAiError('AI 数据格式异常，请重试。'); }
    if (value.error || (value.code !== undefined && value.code !== 0)) throw companyAiError('公司 AI 生成失败，请稍后重试。');
    const choice = value.choices?.find(item => item.index === 0) || value.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason && choice.finish_reason !== 'stop') throw companyAiError('AI 返回的内容不完整，请减少生成数量后重试。');
    if (choice.finish_reason === 'stop') stopped = true;
    // Reasoning events are never part of the user's generated script.
    if (typeof choice.delta?.content === 'string') text += choice.delta.content;
  };
  try {
    while (!finished) {
      const chunk = await reader.read();
      if (chunk.done) { buffer += decoder.decode(); break; }
      bytes += chunk.value.byteLength;
      if (bytes > 2_000_000) throw companyAiError('AI 返回内容过长，请减少生成数量。');
      buffer += decoder.decode(chunk.value, { stream: true });
      let match;
      while ((match = /\r?\n\r?\n/u.exec(buffer))) {
        const raw = buffer.slice(0, match.index).replace(/\r\n/gu, '\n');
        buffer = buffer.slice(match.index + match[0].length); event(raw);
        if (finished) break;
      }
    }
    if (!finished && buffer.trim()) event(buffer.replace(/\r\n/gu, '\n'));
    if (!finished || !stopped || !text.trim()) throw companyAiError('AI 连接中断，稿件未完整生成，请重试。');
    return text;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createCompanyAi({ fetchImpl = fetch, model = COMPANY_AI_MODEL } = {}) {
  return {
    model,
    async generate(instruction, payload, { token, maxTokens = 8192, temperature = 0.5 } = {}) {
      if (!token) throw companyAiError('请先使用本人 OA 账号登录后再生成。', 401);
      const signal = AbortSignal.timeout(180000);
      const headers = { Authorization: 'Bearer ' + token, sys_name: COMPANY_AI_SYSTEM };
      try {
        const modelsResponse = await fetchImpl(COMPANY_AI_BASE + '/models', { headers, redirect: 'manual', signal });
        if (!modelsResponse.ok) throw statusError(modelsResponse.status);
        const catalog = await modelsResponse.json().catch(() => null);
        if (catalog?.code !== 0 || !catalog.data?.models?.some(item => item.model_name === model)) {
          throw companyAiError('公司 AI 当前未开放所配置的模型，请联系管理员。', 503);
        }
        const response = await fetchImpl(COMPANY_AI_BASE + '/chat/completions', {
          method: 'POST', redirect: 'manual', signal,
          headers: { ...headers, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ model, messages: [{ role: 'system', content: instruction }, { role: 'user', content: JSON.stringify(payload) }],
            stream: true, extra_body: { thinking: { type: 'disabled' } }, max_tokens: maxTokens, temperature, response_format: { type: 'json_object' } })
        });
        if (!response.ok) throw statusError(response.status);
        const text = (await readCompletion(response)).trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
        let value;
        try { value = JSON.parse(text); } catch { throw companyAiError('AI 未返回完整稿件，请重试。'); }
        if (!value || Array.isArray(value) || typeof value !== 'object') throw companyAiError('AI 返回的稿件格式不正确，请重试。');
        return value;
      } catch (error) {
        if (error?.details === 'company_ai_error') throw error;
        throw companyAiError('公司 AI 暂时无法连接或生成超时，请稍后重试。');
      }
    }
  };
}
