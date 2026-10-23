// No business projections, remix library, or video verification in this loop.
export function creativeDelivery({readPeople,readEvents,notifier,persistReceipts,setPeople,clock=Date.now}) {
 let busy=false,stopped=false,lastSuccess=0,lastDurationMs=0,error='',cycles=0;
 const persisted=new Map();
 return {
  status(){return {ok:lastSuccess>0&&clock()-lastSuccess<15000,lastSuccess:lastSuccess?new Date(lastSuccess).toISOString():null,lastDurationMs,busy,error,cycles};},
  stop(){stopped=true;},
  async tick(){
   if(busy||stopped)return;
   busy=true;const started=clock();
   try{
    setPeople(await readPeople());
    notifier.import('creative',await readEvents());
    await notifier.flush();
    const changed=notifier.receipts('creative').filter(({event,receipt})=>receipt&&persisted.get(event.key)!==JSON.stringify([receipt.state,receipt.messageId,receipt.error,receipt.sentAt]));
    if(changed.length){
     await persistReceipts(changed);
     for(const {event,receipt} of changed)persisted.set(event.key,JSON.stringify([receipt.state,receipt.messageId,receipt.error,receipt.sentAt]));
    }
    lastSuccess=clock();error='';cycles++;
   }catch(e){error=e.code||e.name||'Error';}
   finally{lastDurationMs=clock()-started;busy=false;}
  },
 };
}

export function creativeQueueSnapshot(source,version) {
 if(!source.nativeSources?.creative)throw Error('Creative historical baseline missing');
 const tasks=source.tasks.filter(t=>t.native?.source==='creative');
 const ids=new Set(tasks.map(t=>t.id));
 return structuredClone({schemaVersion:3,tasks,flowNotifications:source.flowNotifications.filter(n=>ids.has(n.taskId)),
  nativeSources:{creative:source.nativeSources.creative},migration:{fromVersion:version,at:new Date().toISOString()}});
}
