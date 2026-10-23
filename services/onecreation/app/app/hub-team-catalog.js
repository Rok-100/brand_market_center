"use strict";

const fs = require("node:fs");
const { DatabaseSync } = require("./mysql_sqlite.mjs");

function failure(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}
function object(value) {
  if (typeof value === "string") value = JSON.parse(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("共享记录内容格式无效");
  if (JSON.stringify(value).length > 200000) throw failure("共享记录内容过大");
  return value;
}
function text(value, max, required = false) {
  const v = String(value ?? "").trim();
  if ((required && !v) || v.length > max) throw failure("共享记录字段缺失或过长");
  return v;
}
function actorFor(req) {
  const a = req?.centralAccess;
  const u = req?.authUser;
  if (req?.authInternal || !["hub-session", "central-oa"].includes(req?.authSource)
    || !a || a.workbenchUser !== u || a.module !== "ai-first-creation"
    || !a.access?.allowed_modules?.includes("ai-first-creation")
    || !/^FD-\d+$/.test(String(u?.number || ""))) {
    throw failure("请使用已开通一创权限的中枢账号", 403);
  }
  return { id: `oa:${u.number}`, name: String(u.name || ""), employeeNumber: u.number };
}
function schema(db) {
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS resources (key TEXT PRIMARY KEY, type TEXT NOT NULL, updated_at TEXT NOT NULL,
      approved INTEGER NOT NULL, deleted INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS resources_type ON resources(type, deleted);
    CREATE TABLE IF NOT EXISTS events (key TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL,
      kind TEXT NOT NULL, key TEXT NOT NULL, previous TEXT, result TEXT NOT NULL);`);
}
function resourceFromSource(r) {
  return { recordKey:r.record_key, recordType:r.record_type, title:r.title, productName:r.product_name,
    sourceType:r.source_type, sourceUrl:r.source_url, storageUrl:r.storage_url, parentKey:r.parent_key,
    frameworkKey:r.framework_key, status:r.status, approved:r.approved, ownerUserId:r.owner_user_id,
    metadata:object(r.metadata), version:r.version, deletedAt:r.deleted_at, createdAt:r._created_at,
    updatedAt:r._updated_at, sourceAudit:{createdBy:r.created_by_user_id,updatedBy:r.updated_by_user_id} };
}
function put(db, r) {
  db.prepare(`INSERT INTO resources VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET type=excluded.type, updated_at=excluded.updated_at,
    approved=excluded.approved, deleted=excluded.deleted, data=excluded.data`).run(
      r.recordKey, r.recordType, r.updatedAt, r.approved ? 1 : 0, r.deletedAt ? 1 : 0, JSON.stringify(r));
}
function initializeCatalog(filename, bundle, sourceSha256) {
  if (fs.existsSync(filename)) throw failure("共享目录目标已存在，不能覆盖", 409);
  if (bundle.sourceAppId !== "app_17aq7v0j96v" || bundle.environment !== "online"
    || !Array.isArray(bundle.resources) || !Array.isArray(bundle.events)
    || !/^[a-f0-9]{64}$/.test(sourceSha256)) throw failure("共享目录来源合同不一致");
  const db = new DatabaseSync(filename);
  try {
    schema(db); db.exec("BEGIN IMMEDIATE");
    const keys = new Set();
    for (const r of bundle.resources) {
      if (!r.record_key || keys.has(r.record_key)) throw failure("共享资源编号重复");
      keys.add(r.record_key); put(db, resourceFromSource(r));
    }
    for (const e of bundle.events) {
      db.prepare("INSERT INTO events VALUES (?, ?)").run(e.event_key, JSON.stringify({eventKey:e.event_key,
        eventType:e.event_type,resourceKey:e.resource_key,frameworkKey:e.framework_key,lineageKey:e.lineage_key,
        actorUserId:e.actor_user_id,payload:object(e.payload),createdAt:e._created_at,updatedAt:e._updated_at,
        sourceAudit:{createdBy:e.created_by_user_id,updatedBy:e.updated_by_user_id}}));
    }
    db.prepare("INSERT INTO catalog_meta VALUES ('source', ?)").run(JSON.stringify({
      sourceAppId:bundle.sourceAppId, sourceReadAt:bundle.sourceReadAt, sourceSha256,
      fingerprints:bundle.fingerprints, resources:bundle.resources.length, events:bundle.events.length}));
    db.exec("COMMIT; PRAGMA wal_checkpoint(TRUNCATE)");
    return { resources:bundle.resources.length, events:bundle.events.length, sourceSha256 };
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  } finally { db.close(); }
}

function createHubTeamCatalog(filename) {
  if (!filename || !fs.existsSync(filename)) throw failure("中枢共享目录尚未完成数据迁移", 503);
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000");
  if (!db.prepare("SELECT value FROM catalog_meta WHERE key='source'").get()) {
    db.close(); throw failure("共享目录缺少来源校验记录", 503);
  }
  const get = key => {
    const row = db.prepare("SELECT data FROM resources WHERE key=?").get(key);
    return row ? JSON.parse(row.data) : null;
  };
  const audit = (actor, kind, key, before, after) => db.prepare(
    "INSERT INTO audit(at,actor,kind,key,previous,result) VALUES (?,?,?,?,?,?)").run(
      new Date().toISOString(), actor.id, kind, key, before ? JSON.stringify(before) : null, JSON.stringify(after));
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); db.exec("COMMIT"); return result; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  }
  function upsert(actor, input) {
    input=object(input);
    const key=text(input.recordKey,160,true), previous=get(key);
    if (previous?.deletedAt) throw failure("资源已移入回收站，不能覆盖",409);
    if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== (previous?.version || 0)) {
      throw failure("共享资源已被更新，请刷新后再提交",409);
    }
    if (typeof input.approved !== "boolean") throw failure("请明确资源审核状态");
    const now=new Date().toISOString();
    const r={...(previous||{}),recordKey:key,recordType:text(input.recordType,40,true),title:text(input.title,500,true),
      productName:text(input.productName,200),sourceType:text(input.sourceType,60),sourceUrl:text(input.sourceUrl,10000),
      storageUrl:text(input.storageUrl,10000),parentKey:text(input.parentKey,160),frameworkKey:text(input.frameworkKey,160),
      status:text(input.status||'active',40),approved:input.approved,metadata:object(input.metadata||{}),
      ownerUserId:previous?.ownerUserId||actor.id,version:(previous?.version||0)+1,
      createdAt:previous?.createdAt||now,updatedAt:now,updatedBy:actor.id};
    put(db,r); audit(actor,'resource.upsert',key,previous,r);
    return {ok:true,recordKey:key,version:r.version};
  }
  function request(req, pathname, options={}) {
    const actor=actorFor(req), url=new URL(pathname,'http://catalog.internal'), method=options.method||'GET';
    const prefix='/api/team-workbench';
    if (!url.pathname.startsWith(prefix+'/')) throw failure('共享目录路径无效',404);
    const route=url.pathname.slice(prefix.length);
    if (method==='GET' && route==='/resources') {
      const type=url.searchParams.get('type')||'', keyword=(url.searchParams.get('keyword')||'').toLowerCase();
      const pageSize=Math.min(100,Math.max(1,Number(url.searchParams.get('pageSize'))||30));
      const rows=db.prepare("SELECT data FROM resources WHERE deleted=0 AND (?='' OR type=?) ORDER BY approved DESC, updated_at DESC, key").all(type,type)
        .map(r=>JSON.parse(r.data)).filter(r=>!keyword||[r.title,r.productName,r.sourceType,JSON.stringify(r.metadata)].some(v=>String(v||'').toLowerCase().includes(keyword)));
      const pages=Math.max(1,Math.ceil(rows.length/pageSize)),page=Math.min(pages,Math.max(1,Number(url.searchParams.get('page'))||1));
      return {ok:true,currentUser:actor,items:rows.slice((page-1)*pageSize,page*pageSize),total:rows.length,page,pageSize,pages,sourceMode:'wis-hub-shared-catalog'};
    }
    if (method==='POST' && route==='/resources') return transaction(()=>upsert(actor,options.body));
    if (method==='POST' && route==='/resources/batch') {
      const items=options.body?.items;
      if(!Array.isArray(items)||items.length<1||items.length>100)throw failure('批量资源数量需在1至100条之间');
      return transaction(()=>({ok:true,count:items.length,items:items.map(i=>upsert(actor,i))}));
    }
    const review=route.match(/^\/resources\/([^/]+)\/review$/);
    if(method==='POST'&&review) return transaction(()=>{
      const key=decodeURIComponent(review[1]),previous=get(key),input=object(options.body);
      if(!previous||previous.deletedAt)throw failure('共享资源不存在',404);
      if(typeof input.approved!=='boolean')throw failure('请明确资源审核状态');
      if(input.expectedVersion!==undefined&&Number(input.expectedVersion)!==previous.version)throw failure('资源审核状态已更新，请刷新',409);
      const r={...previous,approved:input.approved,status:text(input.status||'active',40),version:previous.version+1,
        updatedAt:new Date().toISOString(),updatedBy:actor.id,metadata:{...previous.metadata,reviewNote:text(input.note,1000),reviewedBy:actor.id,reviewedAt:new Date().toISOString()}};
      put(db,r);audit(actor,'resource.review',key,previous,r);return {ok:true,recordKey:key,version:r.version};
    });
    if(method==='POST'&&route==='/events') return transaction(()=>{
      const i=object(options.body),key=text(i.eventKey,160,true),old=db.prepare('SELECT data FROM events WHERE key=?').get(key);
      const input={eventKey:key,eventType:text(i.eventType,60,true),resourceKey:text(i.resourceKey,160),frameworkKey:text(i.frameworkKey,160),lineageKey:text(i.lineageKey,160),payload:object(i.payload||{})};
      if(old){const p=JSON.parse(old.data); if(Object.keys(input).some(k=>JSON.stringify(p[k]??'')!==JSON.stringify(input[k])))throw failure('事件编号已用于不同内容',409);return {ok:true,eventKey:key,duplicate:true};}
      const e={...input,actorUserId:actor.id,createdAt:new Date().toISOString()};
      db.prepare('INSERT INTO events VALUES (?,?)').run(key,JSON.stringify(e));audit(actor,'event.create',key,null,e);return {ok:true,eventKey:key};
    });
    if(method==='GET'&&route==='/experience-summary') {
      const counts=new Map();
      for(const row of db.prepare('SELECT data FROM events').all()) {
        const e=JSON.parse(row.data);if(!e.frameworkKey)continue;
        const key=JSON.stringify([e.frameworkKey,e.eventType]),c=counts.get(key)||{frameworkKey:e.frameworkKey,eventType:e.eventType,count:0};c.count++;counts.set(key,c);
      }
      return {ok:true,currentUser:actor,items:[...counts.values()].sort((a,b)=>b.count-a.count),note:'仅展示真实记录；没有投放回传时不推断效果。'};
    }
    throw failure('共享目录不支持此操作',404);
  }
  return {request,close:()=>db.close()};
}
module.exports={initializeCatalog,createHubTeamCatalog};
