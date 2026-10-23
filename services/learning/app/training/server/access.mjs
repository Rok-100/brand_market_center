import { fail, hash, nowIso, organizationCenter, strictKeys, text } from './model.mjs';

export const normalizeEmployee=value=>String(value||'').trim().replace(/^fd[-_]?/i,'').toLowerCase();
export const isBrandDepartment=department=>String(department||'').includes('品牌营销');
export const ACCESS_BATCH_LIMIT=200;

function employeeId(value) {
  if(typeof value!=='string')fail(400,'工号必须以文本填写，请保留前导零','INVALID_EMPLOYEE_ID');
  const id=normalizeEmployee(value);
  if(!/^\d{1,100}$/.test(id))fail(400,'请填写完整数字工号，可带 FD 前缀','INVALID_EMPLOYEE_ID');
  return id;
}
function batch(entries) {
  if(!Array.isArray(entries)||!entries.length||entries.length>ACCESS_BATCH_LIMIT)fail(400,`每次请提交1至${ACCESS_BATCH_LIMIT}条名单`,'INVALID_ACCESS_BATCH');
}
function metadata(entry,required=true) {
  return {labelName:text(entry.labelName??'',100,required),note:text(entry.note??'',1000)};
}
function requestId(value) {
  if(typeof value!=='string'||!/^[\w-]{16,100}$/.test(value))fail(400,'提交标识格式不正确','INVALID_REQUEST_ID');
  return value;
}

export function createAccessStore(db,clock=Date.now) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_access (
      employee_id TEXT PRIMARY KEY,label_name TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('active','revoked')),version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS access_receipts (
      request_id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,payload_hash TEXT NOT NULL,receipt_json TEXT NOT NULL,saved_at TEXT NOT NULL
    );
  `);
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  const get=(sql,...args)=>db.prepare(sql).get(...args);
  const all=(sql,...args)=>db.prepare(sql).all(...args);
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  const row=id=>get('SELECT * FROM platform_access WHERE employee_id=?',id);
  let managers=new Set();
  const knownUser=id=>get('SELECT name,department,last_seen FROM users WHERE id=?',id);
  function basis(id,entry,actor) {
    if(managers.has(id)||(actor?.isAdmin&&actor.id===id))return 'administrator';
    if(isBrandDepartment(knownUser(id)?.department))return 'department';
    return entry?.status==='active'?'whitelist':'none';
  }
  function view(entry,actor) {
    const u=knownUser(entry.employee_id);
    return {employeeId:entry.employee_id,labelName:entry.label_name,note:entry.note,status:entry.status,version:entry.version,
      verifiedName:u?.name||'',department:u?.department||'',center:organizationCenter(u?.department),lastSeen:u?.last_seen||null,
      accessBasis:basis(entry.employee_id,entry,actor),labelMismatch:!!(u?.name&&entry.label_name&&u.name!==entry.label_name),
      createdAt:entry.created_at,updatedAt:entry.updated_at};
  }
  const audit=(actor,action,id,before,after,operationId,at)=>run('INSERT INTO audit(user_id,action,object_id,detail_json,at) VALUES(?,?,?,?,?)',actor,action,id,JSON.stringify({requestId:operationId,before,after}),at);
  const snapshot=entry=>entry?{employeeId:entry.employee_id,labelName:entry.label_name,note:entry.note,status:entry.status,version:entry.version}:null;

  function initialize({allowedEmployeeIds=[],managerIds=[]}={}) {
    managers=new Set(managerIds.map(normalizeEmployee));
    const key='platform-access-legacy-migration';
    tx(()=>{
      if(get('SELECT key FROM settings WHERE key=?',key))return;
      // Static configuration is imported once, never consulted during access decisions.
      const ids=[...new Set(allowedEmployeeIds.map(employeeId))],at=nowIso(clock());
      let imported=0;
      for(const id of ids) {
        if(row(id)||managers.has(id))continue;
        run('INSERT INTO platform_access(employee_id,label_name,note,status,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,?)',id,'','','active',at,at,'system:access-migration');
        audit('system:access-migration','platform-access.migrate',id,null,snapshot(row(id)),key,at);imported++;
      }
      run('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)',key,JSON.stringify({completedAt:at,imported,sourceHash:hash(ids.sort())}),at);
    });
  }
  function preview(actor,entries,restoreRevoked=false) {
    batch(entries);
    if(typeof restoreRevoked!=='boolean')fail(400,'恢复选择不正确');
    const seen=new Set(),summary={new:0,active:0,revoked:0,automatic:0,duplicates:0,errors:0,toApply:0};
    const result=entries.map((entry,index)=>{
      try {
        strictKeys(entry,['employeeId','labelName','note']);
        const id=employeeId(entry.employeeId),meta=metadata(entry),existing=row(id),u=knownUser(id);
        const accessBasis=basis(id,existing,actor);
        const common={row:index+1,employeeId:id,...meta,version:existing?.version||0,verifiedName:u?.name||'',department:u?.department||'',accessBasis,action:null};
        if(seen.has(id)){summary.duplicates++;return {...common,kind:'duplicate',message:'重复工号，本行跳过'};}
        seen.add(id);
        if(accessBasis==='administrator'||accessBasis==='department'){summary.automatic++;return {...common,kind:'automatic',message:'已按公司身份自动开放，无需额外授权'};}
        if(existing?.status==='active'){summary.active++;return {...common,kind:'active',message:'已开放，本行跳过'};}
        if(existing?.status==='revoked'){summary.revoked++;if(restoreRevoked)summary.toApply++;return {...common,kind:'revoked',action:restoreRevoked?'grant':null,message:restoreRevoked?'将恢复访问':'已撤销，请明确选择恢复后再保存'};}
        summary.new++;summary.toApply++;return {...common,kind:'new',action:'grant',message:'将添加访问资格'};
      }catch(error){
        if(error.status!==400)throw error;
        summary.errors++;return {row:index+1,employeeId:typeof entry?.employeeId==='string'?entry.employeeId:'',labelName:typeof entry?.labelName==='string'?entry.labelName:'',note:typeof entry?.note==='string'?entry.note:'',version:null,kind:'error',action:null,message:error.message};
      }
    });
    return {entries:result,summary,canApply:summary.errors===0&&summary.toApply>0,limit:ACCESS_BATCH_LIMIT};
  }
  function receipt(actor,id) {
    requestId(id);
    const found=get('SELECT * FROM access_receipts WHERE request_id=? AND actor_id=?',id,actor.id);
    if(!found)fail(404,'尚未查到本次名单变更结果','ACCESS_NOT_SAVED');
    return {...JSON.parse(found.receipt_json),duplicate:true};
  }
  function apply(actor,payload) {
    strictKeys(payload,['requestId','entries']);requestId(payload.requestId);batch(payload.entries);
    const seen=new Set();
    const entries=payload.entries.map(entry=>{
      strictKeys(entry,['employeeId','labelName','note','version','action']);
      const id=employeeId(entry.employeeId);
      if(seen.has(id))fail(400,'提交包含重复工号，请先预览并去重','DUPLICATE_EMPLOYEE_ID');
      seen.add(id);
      if(!['grant','revoke'].includes(entry.action))fail(400,'名单操作不正确');
      if(!Number.isInteger(entry.version)||entry.version<0)fail(400,'缺少名单当前版本，请刷新后重试');
      return {employeeId:id,...metadata(entry,false),version:entry.version,action:entry.action};
    }).sort((a,b)=>a.employeeId.localeCompare(b.employeeId));
    const fingerprint=hash(entries);
    return tx(()=>{
      const prior=get('SELECT * FROM access_receipts WHERE request_id=?',payload.requestId);
      if(prior) {
        if(prior.actor_id!==actor.id||prior.payload_hash!==fingerprint)fail(409,'本次提交标识已用于其他内容，请先读取保存结果','IDEMPOTENCY_CONFLICT');
        return {...JSON.parse(prior.receipt_json),duplicate:true};
      }
      for(const entry of entries) {
        const existing=row(entry.employeeId);
        if((existing?.version||0)!==entry.version)fail(409,'名单已被其他操作更新，请刷新后重新核对','ACCESS_VERSION_CONFLICT');
        if(entry.action==='revoke'&&!existing)fail(404,'该工号尚未加入访问名单','ACCESS_NOT_FOUND');
        // Legacy grants may have no manual label. Restoring them preserves that label
        // without weakening the required name for new grants or clearing existing names.
        if(entry.action==='grant'&&!entry.labelName&&!(existing?.status==='revoked'&&!existing.label_name))fail(400,'请填写名单备注姓名');
      }
      const at=nowIso(clock()),summary={granted:0,restored:0,revoked:0,updated:0,skipped:0},results=[];
      for(const entry of entries) {
        const id=entry.employeeId,existing=row(id),automatic=['administrator','department'].includes(basis(id,existing,actor));
        if(entry.action==='grant'&&automatic) {
          summary.skipped++;
          results.push(existing?view(existing,actor):{employeeId:id,...entry,status:null,version:0,verifiedName:knownUser(id)?.name||'',department:knownUser(id)?.department||'',center:organizationCenter(knownUser(id)?.department),lastSeen:knownUser(id)?.last_seen||null,accessBasis:basis(id,null,actor)});
          continue;
        }
        const status=entry.action==='grant'?'active':'revoked';
        const label=entry.action==='grant'?entry.labelName:existing.label_name,note=entry.action==='grant'?entry.note:existing.note;
        if(existing&&existing.status===status&&existing.label_name===label&&existing.note===note){summary.skipped++;results.push(view(existing,actor));continue;}
        run(`INSERT INTO platform_access(employee_id,label_name,note,status,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(employee_id) DO UPDATE SET label_name=excluded.label_name,note=excluded.note,status=excluded.status,version=platform_access.version+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,id,label,note,status,at,at,actor.id);
        const updated=row(id),change=entry.action==='revoke'?'revoked':!existing?'granted':existing.status==='revoked'?'restored':'updated';
        summary[change]++;results.push(view(updated,actor));
        audit(actor.id,'platform-access.'+entry.action,id,snapshot(existing),snapshot(updated),payload.requestId,at);
      }
      const saved={requestId:payload.requestId,savedAt:at,duplicate:false,summary,entries:results};
      run('INSERT INTO access_receipts(request_id,actor_id,payload_hash,receipt_json,saved_at) VALUES(?,?,?,?,?)',payload.requestId,actor.id,fingerprint,JSON.stringify(saved),at);
      return saved;
    });
  }
  return {initialize,preview,apply,receipt,has:id=>row(normalizeEmployee(id))?.status==='active',list:actor=>({entries:all('SELECT * FROM platform_access ORDER BY updated_at DESC,employee_id').map(entry=>view(entry,actor)),limit:ACCESS_BATCH_LIMIT})};
}
