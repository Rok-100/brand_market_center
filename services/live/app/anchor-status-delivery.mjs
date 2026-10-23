import {fault} from './anchor-status-policy.mjs';
import {anchorStatusCard,safeCardUrl} from './anchor-status-card.mjs';
import {assertFeishuCardRequest} from './feishu-message-policy.mjs';

export function createAnchorStatusDelivery({token,recipientId,verifyRecipient,fetchImpl=fetch,reportUrl,originalUrl}={}) {
  return async(job,{uuid,beforeText,onOriginalLink=()=>{}})=>{
    if(!recipientId)throw fault('倪梦萍收件身份未核验。','recipient_unverified',503);
    await verifyRecipient(recipientId,'倪梦萍','FD-027097');
    const saved=job.source.originalDelivery?.mode==='authenticated_original_link'?job.source.originalDelivery.url:'';
    const originalLink=safeCardUrl(saved||originalUrl?.(job.source));
    const card=anchorStatusCard(job,{reportUrl:reportUrl(job.id),originalUrl:originalLink});
    const path='/im/v1/messages?receive_id_type=open_id',body={receive_id:recipientId,msg_type:'interactive',uuid,content:JSON.stringify(card)};
    assertFeishuCardRequest(path,body);
    // Preserve original bytes behind the existing OA-controlled endpoint.
    // One report produces one card, including clips that previously sent media first.
    if(!saved)onOriginalLink(originalLink);
    beforeText();
    const response=await fetchImpl('https://open.feishu.cn/open-apis'+path,{method:'POST',redirect:'manual',
      headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});
    const data=await response.json();
    if(!response.ok||data.code!==0)throw fault('飞书卡片交付失败，发送结果需核验。','delivery_error',502);
    if(!data.data?.message_id)throw fault('飞书卡片发送结果不明。','uncertain_delivery',502);
    return {messageId:data.data.message_id};
  };
}
