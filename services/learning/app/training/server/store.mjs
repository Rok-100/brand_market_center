import {manualCourseSource} from './course-create.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CENTERS, CATEGORIES, ROLE_PATHS, fail, hash, nowIso, organizationCenter, sourceCourse, publicCourse, validateInventory } from './model.mjs';
import { createAccessStore } from './access.mjs';

export function createStore(path, inventoryPath, clock=Date.now, enrichmentPath=join(dirname(inventoryPath instanceof URL?fileURLToPath(inventoryPath):inventoryPath),'course-enrichment.json')) {
  let enrichments={};
  if(enrichmentPath) {
    try {enrichments=JSON.parse(readFileSync(enrichmentPath,'utf8')).courses||{};}
    catch(error) {if(error.code!=='ENOENT')throw error;}
  }
  if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,name TEXT NOT NULL,department TEXT NOT NULL,center TEXT NOT NULL DEFAULT '',job_role TEXT NOT NULL DEFAULT '',management_access INTEGER NOT NULL DEFAULT 0,last_seen TEXT NOT NULL,last_credit_ms INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS courses (id TEXT PRIMARY KEY,source_json TEXT NOT NULL,source_hash TEXT NOT NULL,override_json TEXT NOT NULL DEFAULT '{}',conflicts_json TEXT NOT NULL DEFAULT '[]',version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS learner_courses (user_id TEXT NOT NULL REFERENCES users(id),course_id TEXT NOT NULL REFERENCES courses(id),PRIMARY KEY(user_id,course_id));
    CREATE TABLE IF NOT EXISTS progress (user_id TEXT NOT NULL REFERENCES users(id),course_id TEXT NOT NULL REFERENCES courses(id),status TEXT NOT NULL DEFAULT 'in-progress',active_ms INTEGER NOT NULL DEFAULT 0,last_opened TEXT NOT NULL,completed_at TEXT,PRIMARY KEY(user_id,course_id));
    CREATE TABLE IF NOT EXISTS feedback (request_id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),course_id TEXT NOT NULL REFERENCES courses(id),rating INTEGER NOT NULL,doubts TEXT NOT NULL,suggestions TEXT NOT NULL,application TEXT NOT NULL,payload_hash TEXT NOT NULL,saved_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS feedback_course_user ON feedback(course_id,user_id,saved_at);
    CREATE TABLE IF NOT EXISTS study_sessions (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),course_id TEXT NOT NULL REFERENCES courses(id),last_tick_ms INTEGER NOT NULL,last_seq INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value_json TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY,date TEXT NOT NULL,time TEXT NOT NULL,title TEXT NOT NULL,course_id TEXT REFERENCES courses(id),location TEXT NOT NULL,notes TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requirements (id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,course_ids_json TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS imports (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,payload_json TEXT NOT NULL,plan_json TEXT NOT NULL,baseline_hash TEXT NOT NULL,expires_ms INTEGER NOT NULL,applied_at TEXT);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,action TEXT NOT NULL,object_id TEXT NOT NULL,detail_json TEXT NOT NULL,at TEXT NOT NULL);
  `);
  if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='center_override'))db.exec('ALTER TABLE users ADD COLUMN center_override TEXT');
  const effectiveCenter=row=>row.center_override??organizationCenter(row.department);
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  const get=(sql,...args)=>db.prepare(sql).get(...args);
  const all=(sql,...args)=>db.prepare(sql).all(...args);
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  const stamp=()=>nowIso(clock());
  const audit=(user,action,id,detail={})=>run('INSERT INTO audit(user_id,action,object_id,detail_json,at) VALUES(?,?,?,?,?)',user.id,action,id,JSON.stringify(detail),stamp());
  if(!get('SELECT id FROM courses LIMIT 1')) {
    const inventory=validateInventory(JSON.parse(readFileSync(inventoryPath,'utf8')));
    tx(()=>{for(const c of inventory.courses) run('INSERT INTO courses(id,source_json,source_hash,updated_at) VALUES(?,?,?,?)',c.id,JSON.stringify(c),hash(c),stamp());});
  }
  if(!get("SELECT key FROM settings WHERE key='announcement'")) run('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)','announcement',JSON.stringify({title:'从岗位出发，把课程用进工作里',body:'两份品营课程库已汇入这里。选择你的学习路径，打开原资料，学完后提交反馈并记录准备应用到哪项工作。资料权限沿用飞书原设置。',galleryUrl:''}),stamp());
  const access=createAccessStore(db,clock);
  function register(identity) {
    const center=organizationCenter(identity.department);
    run(`INSERT INTO users(id,name,department,center,last_seen) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,department=excluded.department,center=excluded.center,last_seen=excluded.last_seen`,identity.id,identity.name,identity.department,center,stamp());
    const row=get('SELECT * FROM users WHERE id=?',identity.id);
    return {...identity,center:effectiveCenter(row),jobRole:row.job_role,managementAccess:identity.isAdmin || !!row.management_access};
  }
  function listCourses(user, includeDisabled=false) {
    return all('SELECT * FROM courses ORDER BY rowid DESC').map(r=>publicCourse(r,user,enrichments[r.id])).filter(c=>includeDisabled || c.enabled);
  }
  function course(user,id, includeDisabled=false) {
    const row=get('SELECT * FROM courses WHERE id=?',id);if(!row) fail(404,'课程未找到','NOT_FOUND');
    const c=publicCourse(row,user,enrichments[row.id]);if(!c.enabled&&!includeDisabled) fail(404,'课程已停用，请查看其他课程','NOT_FOUND');return c;
  }
  function learnable(user,id) {const c=course(user,id);if(!c.canLearn)fail(403,'该课程仅向已授权管理人员开放','COURSE_RESTRICTED');return c;}
  function adminCourse(user,id){
    if(!user.isAdmin)fail(403,'课程管理需要管理员授权','ADMIN_REQUIRED');
    const row=get('SELECT * FROM courses WHERE id=?',id);if(!row)fail(404,'课程未找到','NOT_FOUND');
    return {...publicCourse(row,user,enrichments[row.id]),sourceSnapshot:JSON.parse(row.source_json),overrides:JSON.parse(row.override_json),conflicts:JSON.parse(row.conflicts_json)};
  }
  function progressRow(user,id) {const r=get('SELECT * FROM progress WHERE user_id=? AND course_id=?',user.id,id);return r?{courseId:r.course_id,status:r.status,activeSeconds:Math.floor(r.active_ms/1000),lastOpened:r.last_opened,completedAt:r.completed_at}:null;}
  function personal(user) {
    const courses=listCourses(user), accessible=new Set(courses.filter(c=>c.canLearn).map(c=>c.id));
    const records=all('SELECT course_id FROM progress WHERE user_id=?',user.id).map(r=>progressRow(user,r.course_id));
    const requirements=all('SELECT * FROM requirements WHERE role=? OR role=?',user.jobRole,'all').map(r=>({id:r.id,name:r.name,role:r.role,version:r.version,courseIds:JSON.parse(r.course_ids_json).filter(id=>accessible.has(id))}));
    const required=[...new Set(requirements.flatMap(r=>r.courseIds))];
    const done=new Set(records.filter(r=>r.status==='completed').map(r=>r.courseId));
    return {records,summary:{completed:done.size,started:records.length,activeSeconds:records.reduce((n,r)=>n+r.activeSeconds,0),required:required.length||null,requiredCompleted:required.length?required.filter(id=>done.has(id)).length:null},requirements};
  }
  function feedbackView(r) {return r?{requestId:r.request_id,courseId:r.course_id,rating:r.rating,doubts:r.doubts,suggestions:r.suggestions,application:r.application,savedAt:r.saved_at}:null;}
  function byRequest(user,id) {const row=get('SELECT * FROM feedback WHERE request_id=? AND user_id=?',id,user.id);return row?{feedback:feedbackView(row),progress:progressRow(user,row.course_id)}:null;}
  function latestFeedback(user,id) {return feedbackView(get('SELECT * FROM feedback WHERE user_id=? AND course_id=? ORDER BY rowid DESC LIMIT 1',user.id,id));}
  function submitFeedback(user,payload) {
    learnable(user,payload.courseId);
    const contract={courseId:payload.courseId,rating:payload.rating,doubts:payload.doubts,suggestions:payload.suggestions,application:payload.application};
    const fingerprint=hash(contract);
    return tx(()=>{
      const existing=get('SELECT * FROM feedback WHERE request_id=?',payload.requestId);
      if(existing){if(existing.user_id!==user.id || existing.payload_hash!==fingerprint)fail(409,'提交标识已对应另一份反馈，请先读取保存结果','IDEMPOTENCY_CONFLICT');return {...byRequest(user,payload.requestId),duplicate:true};}
      const at=stamp();
      run('INSERT INTO feedback(request_id,user_id,course_id,rating,doubts,suggestions,application,payload_hash,saved_at) VALUES(?,?,?,?,?,?,?,?,?)',payload.requestId,user.id,payload.courseId,payload.rating,payload.doubts,payload.suggestions,payload.application,fingerprint,at);
      run(`INSERT INTO progress(user_id,course_id,status,last_opened,completed_at) VALUES(?,?,'completed',?,?) ON CONFLICT(user_id,course_id) DO UPDATE SET status='completed',completed_at=COALESCE(progress.completed_at,excluded.completed_at)`,user.id,payload.courseId,at,at);
      return {...byRequest(user,payload.requestId),duplicate:false};
    });
  }
  function startStudy(user,id,sessionId) {
    learnable(user,id);
    return tx(()=>{
      const old=get('SELECT * FROM study_sessions WHERE id=?',sessionId);
      if(old && (old.user_id!==user.id || old.course_id!==id))fail(409,'学习会话已被使用，请重新打开课程');
      if(!old)run('INSERT INTO study_sessions(id,user_id,course_id,last_tick_ms) VALUES(?,?,?,?)',sessionId,user.id,id,clock());
      run(`INSERT INTO progress(user_id,course_id,last_opened) VALUES(?,?,?) ON CONFLICT(user_id,course_id) DO UPDATE SET last_opened=excluded.last_opened`,user.id,id,stamp());
      return {sessionId,progress:progressRow(user,id)};
    });
  }
  function tickStudy(user,payload) {
    return tx(()=>{
      const s=get('SELECT * FROM study_sessions WHERE id=? AND user_id=?',payload.sessionId,user.id);
      if(!s)fail(404,'学习会话已失效，请重新打开课程');learnable(user,s.course_id);
      if(payload.seq<=s.last_seq)return {creditedSeconds:0,duplicate:true,progress:progressRow(user,s.course_id)};
      if(payload.seq!==s.last_seq+1)fail(409,'学习计时顺序不一致，请重新打开课程','SESSION_SEQUENCE');
      const now=clock(), owner=get('SELECT last_credit_ms FROM users WHERE id=?',user.id);
      const qualifies=payload.visible===true && payload.activityAgeSeconds<=90 && now-s.last_tick_ms<=45000;
      const start=Math.max(s.last_tick_ms,owner.last_credit_ms,now-Math.min(payload.elapsedSeconds,20)*1000);
      const credit=qualifies?Math.max(0,Math.floor(now-start)):0;
      run('UPDATE study_sessions SET last_tick_ms=?,last_seq=? WHERE id=?',now,payload.seq,s.id);
      if(credit>0) {
        run('UPDATE users SET last_credit_ms=? WHERE id=?',now,user.id);
        run('UPDATE progress SET active_ms=active_ms+? WHERE user_id=? AND course_id=?',credit,user.id,s.course_id);
      }
      return {creditedSeconds:credit/1000,duplicate:false,progress:progressRow(user,s.course_id)};
    });
  }
  function leaderboard(sort='completed') {
    const rows=all(`SELECT u.id,u.name,u.department,u.center_override,u.job_role,COUNT(p.course_id) AS started,COALESCE(SUM(CASE WHEN p.status='completed' THEN 1 ELSE 0 END),0) AS completed,COALESCE(SUM(p.active_ms),0) AS active_ms FROM users u JOIN progress p ON p.user_id=u.id GROUP BY u.id`)
      .map(r=>({id:r.id,name:r.name,department:r.department,center:effectiveCenter(r),jobRole:r.job_role,completed:Number(r.completed),activeSeconds:Math.floor(Number(r.active_ms)/1000)}))
      .filter(r=>r.completed>0||r.activeSeconds>0);
    const key=sort==='active'?'activeSeconds':'completed';rows.sort((a,b)=>b[key]-a[key]||a.name.localeCompare(b.name,'zh'));
    let last=null,rank=0;rows.forEach((r,i)=>{if(r[key]!==last){last=r[key];rank=i+1;}r.rank=rank;});return rows;
  }
  function createCourse(user,payload) {
    if(!user.isAdmin)fail(403,'新增课程需要管理员授权','ADMIN_REQUIRED');
    return tx(()=>{
      const source=manualCourseSource(payload),old=get('SELECT * FROM courses WHERE id=?',source.id);
      if(old){if(JSON.parse(old.source_json).creation_hash!==source.creation_hash)fail(409,'该提交已保存为另一份课程，请返回课程列表核对','IDEMPOTENCY_CONFLICT');return {course:adminCourse(user,source.id),duplicate:true};}
      const overrides={enabled:payload.enabled,restricted:payload.restricted,normalizedDate:payload.historicalDate,dateBasis:payload.dateBasis};
      run('INSERT INTO courses(id,source_json,source_hash,override_json,updated_at) VALUES(?,?,?,?,?)',source.id,JSON.stringify(source),hash(source),JSON.stringify(overrides),stamp());
      audit(user,'course.create',source.id,{title:payload.title});
      return {course:adminCourse(user,source.id),duplicate:false};
    });
  }
  function sourceBaseline() {return hash(all('SELECT id,source_hash,override_json,version FROM courses ORDER BY id'));}
  function previewImport(user,inventory,id) {
    validateInventory(inventory);
    const existing=all('SELECT * FROM courses'), byId=new Map(existing.map(x=>[x.id,x]));
    const incoming=new Set(inventory.courses.map(x=>x.id));
    const plan={new:[],changed:[],unchanged:[],possibleDuplicates:[],conflicts:[],missingFromSnapshot:existing.filter(r=>!incoming.has(r.id)).map(r=>({id:r.id,title:sourceCourse(JSON.parse(r.source_json)).title})),restricted:[],missingResources:[]};
    for(const c of inventory.courses) {
      const view=sourceCourse(c),old=byId.get(c.id);
      if(!old) {
        plan.new.push({id:c.id,title:view.title});
        const duplicate=existing.find(r=>{const s=JSON.parse(r.source_json);return s.source_document===c.source_document && (s.fields.title.text===c.fields.title.text || (s.fields.source_number.text===c.fields.source_number.text && s.fields.date_raw.text===c.fields.date_raw.text));});
        if(duplicate)plan.possibleDuplicates.push({incomingId:c.id,existingId:duplicate.id,title:view.title,reason:'标题块可能重建，需确认保留或合并身份'});
      } else if(old.source_hash===hash(c)) plan.unchanged.push({id:c.id,title:view.title});
      else {
        const oldSource=JSON.parse(old.source_json),changed=Object.keys(view).filter(k=>hash(view[k])!==hash(sourceCourse(oldSource)[k]));
        if(c.source_revision<oldSource.source_revision)fail(409,'来源版本早于当前课程底座，请重新读取飞书');
        plan.changed.push({id:c.id,title:view.title,fields:changed});
        const conflict=changed.filter(k=>Object.hasOwn(JSON.parse(old.override_json),k));
        if(conflict.length)plan.conflicts.push({id:c.id,title:view.title,fields:conflict});
      }
      if(c.restricted)plan.restricted.push({id:c.id,title:view.title});
      if(!c.fields.recordings.links.length)plan.missingResources.push({id:c.id,title:view.title,type:'回放待补或原表受限'});
    }
    run('INSERT INTO imports(id,user_id,payload_json,plan_json,baseline_hash,expires_ms) VALUES(?,?,?,?,?,?)',id,user.id,JSON.stringify(inventory),JSON.stringify(plan),sourceBaseline(),clock()+30*60*1000);
    return {previewId:id,expiresAt:nowIso(clock()+30*60*1000),plan};
  }
  function applyImport(user,id) {
    return tx(()=>{
      const preview=get('SELECT * FROM imports WHERE id=? AND user_id=?',id,user.id);
      if(!preview)fail(404,'导入预览未找到，请重新预览');
      if(preview.applied_at)return {savedAt:preview.applied_at,duplicate:true};
      if(clock()>preview.expires_ms || preview.baseline_hash!==sourceBaseline())fail(409,'课程已变化或预览已过期，请重新校对导入');
      const plan=JSON.parse(preview.plan_json);
      if(plan.possibleDuplicates.length)fail(409,'检测到可能重建的课程身份。请先核对来源块，不自动合并学习记录','SOURCE_IDENTITY_CONFLICT');
      const inventory=JSON.parse(preview.payload_json), at=stamp();
      for(const c of inventory.courses) {
        const old=get('SELECT * FROM courses WHERE id=?',c.id);
        if(!old)run('INSERT INTO courses(id,source_json,source_hash,updated_at) VALUES(?,?,?,?)',c.id,JSON.stringify(c),hash(c),at);
        else if(old.source_hash!==hash(c)) {
          const conflicts=[...new Set([...JSON.parse(old.conflicts_json),...(plan.conflicts.find(p=>p.id===c.id)?.fields||[])])];
          run('UPDATE courses SET source_json=?,source_hash=?,conflicts_json=?,version=version+1,updated_at=? WHERE id=?',JSON.stringify(c),hash(c),JSON.stringify(conflicts),at,c.id);
        }
      }
      run('UPDATE imports SET applied_at=? WHERE id=?',at,id);audit(user,'source.import',id,{new:plan.new.length,changed:plan.changed.length,conflicts:plan.conflicts.length});
      return {savedAt:at,duplicate:false,new:plan.new.length,changed:plan.changed.length,conflicts:plan.conflicts.length};
    });
  }
  return {db,access,createCourse,register,course,learnable,listCourses,personal,progressRow,submitFeedback,byRequest,latestFeedback,startStudy,tickStudy,leaderboard,previewImport,applyImport,
    close:()=>db.close(),
    settings:()=>{const r=get("SELECT * FROM settings WHERE key='announcement'");return {...JSON.parse(r.value_json),version:r.version,updatedAt:r.updated_at};},
    saveSettings:(user,payload)=>tx(()=>{const row=get("SELECT * FROM settings WHERE key='announcement'");if(row.version!==payload.version)fail(409,'公告已由另一窗口修改，请刷新后再保存');run("UPDATE settings SET value_json=?,version=version+1,updated_at=? WHERE key='announcement'",JSON.stringify({title:payload.title,body:payload.body,galleryUrl:payload.galleryUrl}),stamp());audit(user,'announcement.update','announcement');return {saved:true};}),
    updateProfile:(user,payload)=>{run('UPDATE users SET job_role=? WHERE id=?',payload.jobRole,user.id);return {...user,center:user.center,jobRole:payload.jobRole};},
    adminCourses:user=>all('SELECT * FROM courses ORDER BY rowid DESC').map(r=>({...publicCourse(r,user,enrichments[r.id]),sourceSnapshot:JSON.parse(r.source_json),overrides:JSON.parse(r.override_json),conflicts:JSON.parse(r.conflicts_json)})),
    editCourse:(user,id,payload)=>tx(()=>{const row=get('SELECT * FROM courses WHERE id=?',id);if(!row)fail(404,'课程未找到');if(row.version!==payload.version)fail(409,'课程已发生变化，请刷新后再保存');run('UPDATE courses SET override_json=?,conflicts_json=?,version=version+1,updated_at=? WHERE id=?',JSON.stringify(payload.overrides),JSON.stringify(JSON.parse(row.conflicts_json).filter(k=>!payload.resolvedFields.includes(k))),stamp(),id);audit(user,'course.update',id,{fields:Object.keys(payload.overrides),resolved:payload.resolvedFields});return adminCourse(user,id);}),
    schedules:month=>all('SELECT * FROM schedules WHERE date LIKE ? ORDER BY date,time',`${month}-%`).map(r=>({id:r.id,date:r.date,time:r.time,title:r.title,courseId:r.course_id,location:r.location,notes:r.notes,version:r.version,updatedAt:r.updated_at})),
    saveSchedule:(user,id,p)=>tx(()=>{const old=get('SELECT * FROM schedules WHERE id=?',id);if(old&&old.version!==p.version)fail(409,'排期已被修改，请刷新');if(!old&&p.version!==0)fail(404,'排期已不存在');run(`INSERT INTO schedules(id,date,time,title,course_id,location,notes,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,time=excluded.time,title=excluded.title,course_id=excluded.course_id,location=excluded.location,notes=excluded.notes,version=schedules.version+1,updated_at=excluded.updated_at`,id,p.date,p.time,p.title,p.courseId||null,p.location,p.notes,stamp());audit(user,'schedule.update',id);return {saved:true};}),
    deleteSchedule:(user,id,version)=>tx(()=>{const result=run('DELETE FROM schedules WHERE id=? AND version=?',id,version);if(!result.changes)fail(409,'排期已变化，请刷新');audit(user,'schedule.delete',id);return {saved:true};}),
    requirements:()=>all('SELECT * FROM requirements').map(r=>({id:r.id,name:r.name,role:r.role,courseIds:JSON.parse(r.course_ids_json),version:r.version})),
    saveRequirement:(user,id,p)=>tx(()=>{const old=get('SELECT * FROM requirements WHERE id=?',id);if(old&&old.version!==p.version)fail(409,'学习要求已变化，请刷新');if(!old&&p.version!==0)fail(404,'学习要求已不存在');run(`INSERT INTO requirements(id,name,role,course_ids_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,role=excluded.role,course_ids_json=excluded.course_ids_json,version=requirements.version+1,updated_at=excluded.updated_at`,id,p.name,p.role,JSON.stringify(p.courseIds),stamp());audit(user,'requirement.update',id);return {saved:true};}),
    deleteRequirement:(user,id,version)=>tx(()=>{if(!run('DELETE FROM requirements WHERE id=? AND version=?',id,version).changes)fail(409,'学习要求已变化，请刷新');audit(user,'requirement.delete',id);return {saved:true};}),
    learners:()=>all(`SELECT u.*,COUNT(p.course_id) AS started,COALESCE(SUM(CASE WHEN p.status='completed' THEN 1 ELSE 0 END),0) AS completed,COALESCE(SUM(p.active_ms),0) AS active_ms FROM users u LEFT JOIN progress p ON p.user_id=u.id GROUP BY u.id`).map(r=>({id:r.id,name:r.name,department:r.department,center:effectiveCenter(r),jobRole:r.job_role,managementAccess:!!r.management_access,courseIds:all('SELECT course_id FROM learner_courses WHERE user_id=? ORDER BY course_id',r.id).map(c=>c.course_id),lastSeen:r.last_seen,started:Number(r.started),completed:Number(r.completed),activeSeconds:Math.floor(Number(r.active_ms)/1000)})),
    editLearner:(user,id,p)=>tx(()=>{
      if(!user.isAdmin)fail(403,'调整学员需要管理员权限','ADMIN_REQUIRED');
      if(!get('SELECT id FROM users WHERE id=?',id))fail(404,'学员未找到');
      if(p.center!==undefined && p.center!==null && !CENTERS.includes(p.center))fail(400,'请选择有效的所属中心');
      if(p.courseIds!==undefined){
        if(!Array.isArray(p.courseIds)||p.courseIds.length>500||new Set(p.courseIds).size!==p.courseIds.length)fail(400,'请选择不重复的学习课程');
        for(const courseId of p.courseIds){if(typeof courseId!=='string')fail(400,'课程格式不正确');course(user,courseId,true);}
      }
      if(p.center!==undefined)run('UPDATE users SET center_override=? WHERE id=?',p.center,id);
      run('UPDATE users SET job_role=?,management_access=? WHERE id=?',p.jobRole,p.managementAccess?1:0,id);
      if(p.courseIds!==undefined){
        run('DELETE FROM learner_courses WHERE user_id=?',id);
        for(const courseId of p.courseIds)run('INSERT INTO learner_courses(user_id,course_id) VALUES(?,?)',id,courseId);
      }
      audit(user,'learner.update',id,{jobRole:p.jobRole,managementAccess:p.managementAccess,...(p.center!==undefined?{center:p.center}:{}),...(p.courseIds!==undefined?{courseIds:p.courseIds}:{})});
      return {saved:true};
    }),
    adminProgress:()=>all(`SELECT p.*,u.name,u.department,u.center_override,u.job_role FROM progress p JOIN users u ON u.id=p.user_id ORDER BY p.last_opened DESC`).map(r=>({userId:r.user_id,name:r.name,center:effectiveCenter(r),jobRole:r.job_role,courseId:r.course_id,status:r.status,activeSeconds:Math.floor(r.active_ms/1000),lastOpened:r.last_opened,completedAt:r.completed_at})),
    adminFeedback:()=>all(`SELECT f.*,u.name,u.department,u.center_override,u.job_role FROM feedback f JOIN users u ON u.id=f.user_id WHERE f.rowid IN (SELECT MAX(rowid) FROM feedback GROUP BY user_id,course_id) ORDER BY f.rowid DESC`).map(r=>({...feedbackView(r),userId:r.user_id,name:r.name,center:effectiveCenter(r),jobRole:r.job_role})),
    audit:()=>all('SELECT user_id,action,object_id,detail_json,at FROM audit ORDER BY id DESC LIMIT 100')
  };
}
