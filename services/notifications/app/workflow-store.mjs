import {createDocumentStore} from "./document_store_mysql.mjs";
import { existsSync, readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

const readProcStart = pid => { try { const raw=readFileSync(`/proc/${pid}/stat`,'utf8');return raw.slice(raw.lastIndexOf(')')+2).split(' ')[19]; } catch { return null; } };
const bootId = () => { try { return readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(); } catch { return null; } };
const lockOwner = () => ({pid:process.pid,host:hostname(),boot:bootId(),start:readProcStart(process.pid)});
function recoverDeadOwner(file) {
  // A live or unknown lock is never stolen. Cross-container volume handovers
  // require the deployment procedure to verify the old container has stopped.
  let guard;
  try { guard=openSync(file+'.recovery-guard','wx',0o600); } catch { return false; }
  try {
  let content,owner;
  try { content=readFileSync(file,'utf8');owner=JSON.parse(content); } catch { return false; }
  if(!Number.isInteger(owner.pid)||owner.pid<=0||owner.host!==hostname())return false;
  let dead=false;
  if(owner.boot&&bootId()&&owner.boot!==bootId())dead=true;
  else if(owner.start){const current=readProcStart(owner.pid);if(current)dead=current!==owner.start;else{try{process.kill(owner.pid,0);}catch(e){dead=e.code==='ESRCH';}}}
  else {try{process.kill(owner.pid,0);}catch(e){dead=e.code==='ESRCH';}}
  if(!dead)return false;
  try { if(readFileSync(file,'utf8')!==content)return false;renameSync(file,`${file}.recovered.${Date.now()}.${randomUUID()}`);return true; } catch { return false; }
  } finally { closeSync(guard);unlinkSync(file+'.recovery-guard'); }
}

export class WorkflowError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const requireFact = (condition, message, status = 400) => { if (!condition) throw new WorkflowError(status, message); };
export const emptyWorkflow = () => ({ schemaVersion: 3, tasks: [], dedupe: {}, serviceEvents: {}, outbox: [], incidents: [], aiRuns: [] });
export function normalizeStore(value) {
  requireFact(value && [1, 2, 3].includes(value.schemaVersion) && Array.isArray(value.tasks), '任务记录格式异常，请联系维护人；不会覆盖已有记录', 503);
  return { ...emptyWorkflow(), ...value, schemaVersion: 3, tasks: value.tasks.map(task => ({
    ...task, version: task.version || 1, workflow: task.workflow || '02', lane: task.lane || 'content',
    assignees: task.assignees?.length ? task.assignees : task.assignee ? [task.assignee] : [],
    outputs: task.outputs || [], reviews: task.reviews || [], deliveries: task.deliveries || [], feedback: task.feedback || [],
    acceptance: task.acceptance || '', legacyUnverified: task.legacyUnverified ?? (value.schemaVersion < 3 && ['pushed', 'completed'].includes(task.status)),
  })) };
}

// All state changes, idempotency records and outbox events commit together.
// This deliberately serializes a small pilot store; it is NOT a distributed queue.
export class WorkflowStore {
  constructor(file){this.file=file;this.documents=createDocumentStore(file);}
  read(){const snapshot=this.documents.snapshot();return snapshot.exists?normalizeStore(snapshot.data):emptyWorkflow();}
  transaction(mutate,{skipUnchanged=false}={}){
    const snapshot=this.documents.snapshot();
    const state=snapshot.exists?normalizeStore(snapshot.data):emptyWorkflow();
    const before=skipUnchanged?JSON.stringify(state):null;const result=mutate(state);
    requireFact(!result?.then,'事务不能包含异步操作',500);if(skipUnchanged&&JSON.stringify(state)===before)return structuredClone(result);
    state.updatedAt=new Date().toISOString();
    try{this.documents.commit(snapshot.version,state);}catch{throw new WorkflowError(503,'任务记录正在处理，请稍后刷新；不要重复提交');}
    return structuredClone(result);
  }
}
