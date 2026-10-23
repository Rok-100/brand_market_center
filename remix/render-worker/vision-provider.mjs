import {fetchReviewWithRetry} from './automatic-review-policy.mjs';
// Provider credentials stay server-side. A text-only model cannot accidentally
// satisfy the visual preflight; the direct adapter is pinned to a verified model.
export function visionConnection(env=process.env){
  if(env.WIS_REMIX_VISION_PROVIDER==='deepseek-direct'){
    const model=env.DEEPSEEK_VISION_MODEL||'deepseek-flash';
    const missing=[];
    if(!env.DEEPSEEK_API_KEY?.trim())missing.push('DEEPSEEK_API_KEY');
    if(model!=='deepseek-flash')missing.push('DEEPSEEK_VISION_MODEL(image-capable)');
    return {ready:!missing.length,missing,model,protocol:'deepseek-direct',url:'https://api.deepseek.com/chat/completions',token:env.DEEPSEEK_API_KEY};
  }
  const required=['JUMP_LLM_URL','JUMP_LLM_TOKEN','JUMP_LLM_APPLICATION','JUMP_LLM_PROVIDER','JUMP_LLM_VISION_MODEL'];
  const missing=required.filter(k=>!String(env[k]||'').trim());
  return {ready:!missing.length,missing,model:env.JUMP_LLM_VISION_MODEL,protocol:'fandow',url:env.JUMP_LLM_URL,token:env.JUMP_LLM_TOKEN,application:env.JUMP_LLM_APPLICATION,provider:env.JUMP_LLM_PROVIDER};
}
export function requestVisualCompletion(fetchImpl,connection,messages){
  if(!connection.ready)throw Error('Visual provider not configured');
  const direct=connection.protocol==='deepseek-direct';
  const request={model:connection.model,temperature:0,messages};
  const body=direct?{...request,max_tokens:8192,thinking:{type:'disabled'},response_format:{type:'json_object'}}:{application:connection.application,event:'text',provider:connection.provider,requests_data:request};
  return fetchReviewWithRetry(fetchImpl,connection.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),headers:{Authorization:direct?`Bearer ${connection.token}`:connection.token,'content-type':'application/json'},body:JSON.stringify(body)});
}
