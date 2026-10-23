"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const MAX_AGE_MS = 36 * 60 * 60 * 1000;
// Realm mapping is an independently verified deployment contract. Feishu
// tenant_key and aPaaS tenant_id deliberately remain different namespaces.
const REALM = Object.freeze({issuer:"app_17aq7v0j96v",audience:"ai-video-workbench",tenantId:"20960514",feishuTenantKey:"172485b62026d740"});
const HASH = /^[a-f0-9]{64}$/u;
const ownText = value => typeof value === "string" && value.length > 0 && value.trim() === value && value.length <= 128;
const activeStatus = status => status?.is_activated === true && ["is_frozen","is_resigned","is_exited","is_unjoin"].every(key=>status[key] === false);
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

function validateIdentitySnapshot(value, now = Date.now()) {
  if (value?.schemaVersion !== 2 || value.purpose !== "identity_binding_only" || !Array.isArray(value.records)
    || value.records.length > 5000 || value.source?.kind !== "official_contact_v3" || value.source.identity !== "user"
    || value.source.appId !== "cli_aa9c744d6ffa1cc4" || !Number.isFinite(Date.parse(value.source.readAt))
    || Date.parse(value.source.readAt) > now + 5 * 60 * 1000
    || !HASH.test(value.source.tenantProofSha256 || "") || !Number.isInteger(value.coverage?.expectedEmployees)
    || value.coverage.expectedEmployees < value.records.length || value.coverage.expectedEmployees > 5000) throw Error("Invalid identity source contract");
  for (const [key, expected] of Object.entries(REALM)) if (value.realm?.[key] !== expected) throw Error("Unverified identity realm");
  const byNumber = new Map(), knownIds = new Set();
  for (const record of value.records) {
    const time = Date.parse(record?.readAt), status = record?.status;
    if (!ownText(record?.employeeNumber) || !/^(FD|OD)-\d{3,12}$/u.test(record.employeeNumber)
      || !ownText(record.userId) || !/^[a-zA-Z0-9_-]{1,64}$/u.test(record.userId) || /^(ou_|on_)/u.test(record.userId) || record.idType !== "user_id"
      || !Number.isFinite(time) || time > now + 5 * 60 * 1000 || time > Date.parse(value.source.readAt)
      || !HASH.test(record.sourceSha256 || "") || !ownText(record.sourceResource)
      || !["is_activated","is_frozen","is_resigned","is_exited","is_unjoin"].every(key=>typeof status?.[key] === "boolean")
      || !["user","batch","department"].includes(record.collection?.kind)
      || (record.collection.kind === "department" && !/^od-[a-zA-Z0-9_-]+$/u.test(record.collection.departmentId || ""))) throw Error("Incomplete official identity record");
    if (byNumber.has(record.employeeNumber) || knownIds.has(record.userId)) throw Error("Ambiguous official identity");
    knownIds.add(record.userId);
    const validUntil = time + MAX_AGE_MS;
    byNumber.set(record.employeeNumber, Object.freeze({
      employeeNumber:record.employeeNumber,idType:"user_id",userId:record.userId,...REALM,
      active:activeStatus(status),sourceReadAt:record.readAt,sourceSha256:record.sourceSha256,
      sourceResource:record.sourceResource,validUntil:new Date(validUntil).toISOString()
    }));
  }
  return {byNumber,sourceReadAt:value.source.readAt,expectedEmployees:value.coverage.expectedEmployees};
}

function createIdentityStore(options = {}) {
  // No user/env-controlled file path. Runtime always uses this read-only bind;
  // an explicit directory injection exists only for isolated local tests/tools.
  const directory = options.directory || path.join(__dirname, "collaboration-identity-data");
  const clock = options.clock || Date.now;
  let lastGood = null, lastError = null;
  function refresh() {
    const now = clock();
    try {
      const manifestBytes = fs.readFileSync(path.join(directory, "current.json"));
      if (manifestBytes.length > 32768) throw Error("Identity manifest too large");
      const pointer = JSON.parse(manifestBytes);
      if (pointer?.schemaVersion !== 1 || pointer.purpose !== "identity_binding_only" || !HASH.test(pointer.sha256 || "")
        || pointer.dataFile !== `snapshots/${pointer.sha256}.json`) throw Error("Invalid identity manifest");
      const dataPath = path.join(directory, pointer.dataFile);
      const resolved = fs.realpathSync(dataPath), allowed = fs.realpathSync(path.join(directory,"snapshots"));
      if (path.dirname(resolved) !== allowed) throw Error("Identity file escaped immutable snapshot directory");
      const bytes = fs.readFileSync(dataPath);
      if (bytes.length > 2 * 1024 * 1024 || sha(bytes) !== pointer.sha256) throw Error("Identity snapshot checksum mismatch");
      const parsed = validateIdentitySnapshot(JSON.parse(bytes), now);
      if (pointer.sourceReadAt !== parsed.sourceReadAt) throw Error("Identity source date mismatch");
      if (lastGood && Date.parse(parsed.sourceReadAt) < Date.parse(lastGood.sourceReadAt)) throw Error("Identity source date regressed");
      lastGood = {...parsed,sha256:pointer.sha256};
      lastError = null;
    } catch {
      lastError = "identity_source_read_failed";
    }
    return now;
  }
  function get(employeeNumber) {
    const now = refresh(), record = lastGood?.byNumber.get(employeeNumber);
    if (!record || !record.active || Date.parse(record.validUntil) <= now) return null;
    return record;
  }
  function status() {
    const now = refresh();
    const records = lastGood ? [...lastGood.byNumber.values()] : [];
    const verifiedActiveEmployees=records.filter(r=>r.active&&Date.parse(r.validUntil)>now).length;
    let lastAttempt=null;
    try {const info=JSON.parse(fs.readFileSync(path.join(directory,"status.json")));if(Number.isFinite(Date.parse(info.at)))lastAttempt={at:info.at,state:String(info.state||"unknown").slice(0,40),error:typeof info.error==="string"?info.error.slice(0,160):null};}catch{}
    return {state:!lastGood?"unavailable":lastError?"last_success_retained":records.some(r=>Date.parse(r.validUntil)<=now)?"partly_expired":verifiedActiveEmployees<lastGood.expectedEmployees?"partial":"ready",
      error:lastError,sourceReadAt:lastGood?.sourceReadAt || null,sourceSha256:lastGood?.sha256 || null,
      expectedEmployees:lastGood?.expectedEmployees ?? null,
      verifiedActiveEmployees,expiredEmployees:records.filter(r=>r.active&&Date.parse(r.validUntil)<=now).length,
      oldestVerifiedReadAt:records.length?new Date(Math.min(...records.map(r=>Date.parse(r.sourceReadAt)))).toISOString():null,
      nextExpiryAt:records.some(r=>r.active&&Date.parse(r.validUntil)>now)?new Date(Math.min(...records.filter(r=>r.active&&Date.parse(r.validUntil)>now).map(r=>Date.parse(r.validUntil)))).toISOString():null,
      maxAgeHours:36,lastAttempt};
  }
  return {get,status};
}

module.exports = {createIdentityStore,validateIdentitySnapshot,REALM,MAX_AGE_MS};
