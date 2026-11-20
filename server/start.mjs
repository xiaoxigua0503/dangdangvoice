// Resolve the intended local .env from the application root, not the terminal cwd.
// Explicit deployment environment variables retain precedence over .env.
import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';
try { if(process.env.NODE_ENV!=='production') loadEnvFile(fileURLToPath(new URL('../.env',import.meta.url))); }
catch(e) { if(e.code!=='ENOENT')throw e; }
if(process.env.NODE_ENV!=='production') {
 const {pool}=await import('./db.mjs');
 const identity=pool?(await pool.query('SELECT current_database() db,current_schema() schema')).rows[0]:null;
 const db=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;
 console.log('local_web_config '+JSON.stringify({pid:process.pid,root:fileURLToPath(new URL('../',import.meta.url)),environment:process.env.NODE_ENV||'development',origin:process.env.APP_BASE_URL,databaseLocal:!!db&&['127.0.0.1','localhost','[::1]'].includes(db.hostname),database:identity?.db,schema:identity?.schema}));
}
await import('../server.mjs');
