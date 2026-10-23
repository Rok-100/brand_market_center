import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const input=process.env.DB_PATH||'/app/var/training.sqlite',output=process.env.BACKUP_PATH;
if(!output || !/^\/app\/var\/backups\/[\w-]+\.sqlite$/.test(output))throw new Error('Invalid app-scoped backup path');
if(!existsSync(input)){process.stdout.write(JSON.stringify({status:'no-existing-database'})+'\n');process.exit(0);}
mkdirSync(dirname(output),{recursive:true});
const db=new DatabaseSync(input);db.prepare('VACUUM INTO ?').run(output);const counts=db.prepare('SELECT count(*) courses FROM courses').get();db.close();
const check=new DatabaseSync(output,{readOnly:true});const integrity=check.prepare('PRAGMA integrity_check').get();check.close();
if(Object.values(integrity)[0]!=='ok')throw new Error('Backup integrity check failed');
process.stdout.write(JSON.stringify({status:'backed-up',integrity:'ok',...counts})+'\n');
