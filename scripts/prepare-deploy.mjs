// Allowlist-only upload staging. Never copies .env, .private, browser archives,
// Docker volume data or a historical ZIP. Build directly from this repository.
import {cp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url),out=new URL('../.release/vercel/',import.meta.url);
let link;try{link=await readFile(new URL('.vercel/project.json',out));}catch(e){if(e.code!=='ENOENT')throw e;}
await rm(out,{recursive:true,force:true});await mkdir(new URL('scripts/',out),{recursive:true});
for(const name of ['dist','server','migrations','api','server.mjs','package.json','package-lock.json'])await cp(new URL(name,root),new URL(name,out),{recursive:true});
await cp(new URL('deployment/vercel.json',root),new URL('vercel.json',out));
await mkdir(new URL('worker/',out),{recursive:true});
for(const name of ['server','migrations','package.json','package-lock.json'])await cp(new URL(name,root),new URL('worker/'+name,out),{recursive:true});
await cp(new URL('deployment/worker.Dockerfile',root),new URL('worker/Dockerfile',out));
await writeFile(new URL('scripts/release-build.mjs',out),`import {access} from 'node:fs/promises';\nawait access('dist/index.html');await access('api/index.mjs');console.log('Current-source web, API and worker release staged.');\n`);
const pkg=JSON.parse(await readFile(new URL('package.json',out),'utf8'));
pkg.scripts.build='node scripts/release-build.mjs';
pkg.engines={...pkg.engines,node:'22.x'};
await writeFile(new URL('package.json',out),JSON.stringify(pkg,null,2)+'\n');
await writeFile(new URL('.vercelignore',out),'.env\n.env.*\n.private/\nnode_modules/\n*.log\n');
await writeFile(new URL('worker/.dockerignore',out),'.env\n.env.*\n.private/\nnode_modules/\n*.log\n');
async function scan(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(e.name==='.private'||e.name.startsWith('.env')||e.name==='demo-credentials.json')throw new Error('Private file in release');if(e.isDirectory())await scan(new URL(e.name+'/',dir));}}
if(link){await mkdir(new URL('.vercel/',out),{recursive:true});await writeFile(new URL('.vercel/project.json',out),link);}
await scan(out);console.log('Safe current-source release: '+out.pathname);
