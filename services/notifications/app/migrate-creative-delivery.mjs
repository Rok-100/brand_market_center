import {resolve} from 'node:path';
import {createDocumentStore} from './document_store_mysql.mjs';
import {creativeQueueSnapshot} from './creative-delivery.mjs';
const root=process.env.NOTIFICATION_DATA_DIR||'/data';
const legacy=createDocumentStore(resolve(root,'notifications.json'));
const dedicated=createDocumentStore(resolve(root,'creative-notifications.json'));
try{
 const old=legacy.snapshot(),target=dedicated.snapshot();
 if(process.argv.includes('--merge-back')){
  if(!target.exists){console.log('No dedicated queue to restore');process.exitCode=0;}
  else{
   const state=old.data,ids=new Set(state.tasks.filter(t=>t.native?.source==='creative').map(t=>t.id));
   state.tasks=[...state.tasks.filter(t=>!ids.has(t.id)),...target.data.tasks];
   state.flowNotifications=[...state.flowNotifications.filter(n=>!ids.has(n.taskId)),...target.data.flowNotifications];
   state.nativeSources.creative=target.data.nativeSources.creative;
   legacy.commit(old.version,state);console.log(JSON.stringify({mergedCreativeReceipts:target.data.flowNotifications.length}));
  }
 }else{
  if(target.exists)throw Error('Dedicated queue already exists; do not overwrite delivery history');
  const state=creativeQueueSnapshot(old.data,old.version);dedicated.commit(target.version,state);
  const verified=dedicated.snapshot();
  if(JSON.stringify(verified.data.tasks)!==JSON.stringify(state.tasks)||JSON.stringify(verified.data.flowNotifications)!==JSON.stringify(state.flowNotifications))throw Error('Queue migration verification failed');
  console.log(JSON.stringify({creativeTasks:state.tasks.length,creativeNotices:state.flowNotifications.length,states:state.flowNotifications.reduce((r,n)=>(r[n.state]=(r[n.state]||0)+1,r),{}),historicalMessagesReplayed:false}));
 }
}finally{legacy.close();dedicated.close();}
