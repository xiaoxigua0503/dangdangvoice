// Explicit VM maintenance command; never imported by Web/worker or run on boot.
// Reuse the live Web service environment without printing/copying its secrets.
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const checkOnly=process.argv.slice(2).includes('--check');
try {
 if(Number(process.versions.node.split('.')[0])<22)throw Error('node_22_required');
 const pid=Number(execFileSync('systemctl',['show','dangdangvoice-web','--property=MainPID','--value'],{encoding:'utf8'}).trim());
 if(!Number.isSafeInteger(pid)||pid<=1)throw Error('web_service_must_be_running');
 const env=Object.fromEntries(readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').filter(s=>s.includes('=')).map(s=>{const at=s.indexOf('=');return[s.slice(0,at),s.slice(at+1)];}));
 if(env.NODE_ENV!=='production'||!env.DATABASE_URL)throw Error('production_web_environment_required');
 // Migration uses the Web database, never a shell/local worker override.
 env.DDV_PROCESS_ROLE='web';
 const status=readFileSync(`/proc/${pid}/status`,'utf8'),uid=Number(status.match(/^Uid:\s+\d+\s+(\d+)/m)?.[1]),gid=Number(status.match(/^Gid:\s+\d+\s+(\d+)/m)?.[1]);
 if(!Number.isSafeInteger(uid)||!Number.isSafeInteger(gid))throw Error('service_identity_unavailable');
 if(checkOnly){console.log('VM migration preflight: live production Web environment available; values not displayed.');process.exit(0);}
 if(process.getuid()===0)process.setgroups((status.match(/^Groups:\s*(.*)$/m)?.[1]||'').trim().split(/\s+/).filter(Boolean).map(Number));
 const child=spawnSync(process.execPath,[fileURLToPath(new URL('../server/migrate.mjs',import.meta.url))],{cwd:fileURLToPath(new URL('../',import.meta.url)),env,uid,gid,stdio:'inherit'});
 process.exit(child.status??1);
} catch(error) {
 const safe=['node_22_required','web_service_must_be_running','production_web_environment_required','service_identity_unavailable'];
 console.error('VM migration stopped: '+(safe.includes(error.message)?error.message:'cannot_reuse_service_environment; check service state and privileges'));
 process.exit(1);
}
