import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {DatabaseSync} from './mysql_sqlite.mjs';
import {WorkflowStore} from './workflow-store.mjs';
import {ServiceNotifications} from './service-notifications.mjs';
import {sourcePeople} from './service-source-records.mjs';
import {creativeNotificationEvent} from './service-creative-notification.mjs';
import {notificationLinks} from './notification-links.mjs';
import {writeReceipts} from './service-persistence.mjs';
import {creativeDelivery} from './creative-delivery.mjs';

const env=process.env,links=notificationLinks(env);
if(env.CREATIVE_LOCAL_NOTIFICATION_RECIPIENT||env.ALLOW_LOCAL_IDENTITY)throw Error('Local identities are not supported in production');
const cloud=new DatabaseSync(env.NOTIFICATION_CLOUD_DB,{readOnly:true}),creative=new DatabaseSync(env.NOTIFICATION_CREATIVE_DB);
const store=new WorkflowStore(resolve(env.NOTIFICATION_DATA_DIR||'/data','creative-notifications.json'));
if(!store.read().migration)throw Error('Dedicated creative queue must be migrated before startup');
const allowed=(env.NOTIFICATION_ALLOWED_NUMBERS||'').split(',').filter(Boolean);
let people=[];
const notifier=new ServiceNotifications(store,{people:()=>people.filter(p=>!allowed.length||allowed.includes(p.number)),env});
const loop=creativeDelivery({notifier,setPeople:value=>{people=value;},
 readPeople:()=>sourcePeople(cloud,(env.FLOW_EXTERNAL_COLLABORATOR_NUMBERS||'').split(',').filter(Boolean)),
 readEvents:()=>creative.prepare(`SELECT n.*,p.payload AS script_payload,u.employee_no,d.product,d.version,d.status,d.current_reviewer_id,s.employee_no AS supervisor_employee_no
   FROM notifications n LEFT JOIN script_notification_payloads p ON p.notification_id=n.id
   JOIN workspace_users u ON u.id=n.user_id LEFT JOIN creative_drafts d ON d.id=n.draft_id
   LEFT JOIN workspace_users s ON s.id=d.supervisor_reviewer_id ORDER BY n.created_at,n.id`).all().map(n=>{
    const event=creativeNotificationEvent(n,{publicUrl:links.creative});if(event.originalRecipient==='LOCAL-CREATIVE')event.recipient='unmapped:LOCAL-CREATIVE';return event;
   }),
 persistReceipts:rows=>writeReceipts(creative,'creative',rows),
});
const server=createServer((req,res)=>{
 res.setHeader('content-type','application/json');if(req.url!=='/health'){res.writeHead(404).end('{}');return;}
 const status=loop.status();res.statusCode=status.ok?200:503;res.end(JSON.stringify({...status,service:'creative-notifications',enabled:notifier.sender.enabled,pollMs:2000}));
});
server.listen(3000,'0.0.0.0');const timer=setInterval(()=>void loop.tick(),2000);await loop.tick();
async function stop(){loop.stop();clearInterval(timer);server.close();while(loop.status().busy)await new Promise(r=>setTimeout(r,50));cloud.close();creative.close();store.documents.close();}
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
