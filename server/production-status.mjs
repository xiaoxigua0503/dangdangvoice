// Redacted deployment diagnostics. Never emit addresses, passwords, tokens or URLs.
export function productionStatus(){
 const e=process.env;
 const present=k=>!!e[k]?.trim();
 const sender=(e.MAIL_FROM?.match(/<([^<>]+)>\s*$/)?.[1]||e.MAIL_FROM||'').trim().toLowerCase();
 const smtpUser=(e.SMTP_USER||'').trim().toLowerCase();
 let web,worker;try{web=new URL(e.DATABASE_URL);}catch{}
 try{worker=new URL(e.WORKER_DATABASE_URL||e.DATABASE_URL);}catch{}
 const identity=u=>u?u.hostname.replace('-pooler.','.')+u.pathname:'';
 let app;try{app=new URL(e.APP_BASE_URL);}catch{}
 return {
  originCorrect:!!app&&app.protocol==='https:'&&!app.username&&!app.password&&app.pathname==='/'&&!app.search&&!app.hash,
  production:e.NODE_ENV==='production',
  smtp:{modeIsSmtp:e.MAIL_TRANSPORT==='smtp',captureDisabled:e.NODE_ENV==='production'&&e.MAIL_TRANSPORT!=='capture',hostIsGmail:e.SMTP_HOST==='smtp.gmail.com',portIs465:e.SMTP_PORT==='465',secure:e.SMTP_SECURE==='true',userPresent:present('SMTP_USER'),passwordPresent:present('SMTP_PASS'),senderPresent:present('MAIL_FROM'),senderMatchesAuthenticated:!!sender&&sender===smtpUser},
  ai:{keyPresent:present('AI_API_KEY'),providerCorrect:e.AI_PROVIDER==='qwen',beijingEndpoint:e.AI_BASE_URL?.replace(/\/$/,'')==='https://dashscope.aliyuncs.com/compatible-mode/v1',modelCorrect:e.AI_MODEL==='qwen3.7-flash',workerEnabled:e.AI_WORKER_ENABLED==='true'},
  database:{webIsProductionNeon:!!web?.hostname.endsWith('.neon.tech'),workerIsProductionNeon:!!worker?.hostname.endsWith('.neon.tech'),sameDatabase:!!identity(web)&&identity(web)===identity(worker),workerIsDirect:!!worker&&!worker.hostname.includes('-pooler.')}
 };
}
export function logProductionStatus(service){if(process.env.NODE_ENV==='production')console.log('production_config '+JSON.stringify({service,...productionStatus()}));}
