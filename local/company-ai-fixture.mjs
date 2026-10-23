if (process.env.LOCAL_SIMULATION !== '1') throw new Error('Local simulation only');
// Explicit offline fixture: exercises the existing generation/save pipeline, not AI quality.
export async function companyAiProxy(request,response) {
  if(!['/company-ai/models','/company-ai/chat/completions'].includes(request.url))return false;
  const reply=value=>{response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(value));};
  if(request.url==='/company-ai/models'){
    reply({code:0,data:{models:[{model_name:'deepseek-flash'}]},localSimulation:true});return true;
  }
  let text='';
  for await(const part of request){text+=part;if(text.length>256000){response.writeHead(413);response.end();return true;}}
  const input=JSON.parse(text);
  const payload=JSON.parse(input.messages.find(message=>message.role==='user').content);
  const count=Math.max(1,Math.min(3,Number(payload.count)||1));
  const drafts=Array.from({length:count},(_,i)=>({
    title:`【本机模拟】${payload.product||'产品'}脚本 ${i+1}`,
    content:`【本机模拟内容，仅用于流程验收，并非真实 AI 生成】\n镜头1：测试场景 ${i+1}\n画面：展示本机测试产品与使用场景。\n口播：这是本机系统复现的第${i+1}条测试脚本，用于检查生成结果是否能够正常保存、编辑、提交审核和归档。这里不包含真实的产品功效或营销承诺，请勿直接作为广告发布。\n\n镜头2：测试收尾\n画面：显示流程测试完成的文字。\n口播：本段用于确认不同候选脚本的展示和版本记录能够正常工作。`,
    creativeRoute:`本机固定测试样例 ${i+1}`,
  }));
  reply({localSimulation:true,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',
    content:JSON.stringify({analysis:'本机离线模拟，仅验证流程；真实 AI 质量和授权尚未测试。',drafts})}}]});
  return true;
}
