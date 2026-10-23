import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export const registrationDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Deliberately read-only: this does not replay side effects or grant approval.
// A recovery caller still has to verify current files, bindings and authority.
export async function readRegistrationJournals(directory, renderId) {
  if(!/^[a-f0-9-]{36}$/.test(renderId))throw new Error('Invalid render ID');
  let files;try{files=await fs.readdir(directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const result=[];
  for(const name of files.filter(name=>name.startsWith(renderId+'-')&&name.endsWith('.json'))){
    const record=JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));
    if(record.schemaVersion!==1||record.kind!=='render-registration-journal'||record.render?.id!==renderId||registrationDigest(record.render)!==record.renderSha256||name!==`${renderId}-${record.renderSha256}.json`)
      throw new Error('Registration journal integrity mismatch');
    result.push(record);
  }return result;
}
export function createRegistrationJournal(directory) {
  return async render => {
    if (!render.automation || !/^[a-f0-9-]{36}$/.test(render.id)) return;
    const snapshot = structuredClone(render), digest = registrationDigest(snapshot);
    const record = {schemaVersion: 1, kind: 'render-registration-journal', renderSha256: digest, render: snapshot};
    await fs.mkdir(directory, {recursive: true, mode: 0o700});
    const file = path.join(directory, `${render.id}-${digest}.json`);
    try {
      const prior = JSON.parse(await fs.readFile(file, 'utf8'));
      if (prior.renderSha256 !== digest || registrationDigest(prior.render) !== digest) throw new Error('Registration journal integrity mismatch');
      return;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // fs.rename goes through the existing MySQL metadata adapter in production.
    // Finish this durable receipt before the large library commit. No side effect
    // (notifications, cloud return, advertising) is triggered by the journal.
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(record), {mode: 0o600});
      await fs.rename(temp, file);
    } finally { await fs.rm(temp, {force: true}).catch(() => {}); }
  };
}
