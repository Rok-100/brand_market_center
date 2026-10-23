import { createApp } from './app.mjs';
const preview=process.env.LOCAL_PREVIEW==='true';
const {app,close}=createApp({preview,dbPath:process.env.DB_PATH,basePath:process.env.BASE_PATH||'/',publicOrigin:process.env.PUBLIC_ORIGIN,csrfSecret:process.env.CSRF_SECRET,managerIds:(process.env.MANAGER_EMPLOYEE_IDS||'').split(',').filter(Boolean),allowedEmployeeIds:(process.env.ALLOWED_EMPLOYEE_IDS||'').split(',').filter(Boolean)});
const port=Number(process.env.PORT||3218),host=preview?'127.0.0.1':(process.env.HOST||'127.0.0.1');
const server=app.listen(port,host,()=>process.stdout.write(`brand-marketing-training listening ${host}:${port} mode=${preview?'isolated-preview':'production'}\n`));
const shutdown=()=>server.close(()=>{close();process.exit(0);});process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
