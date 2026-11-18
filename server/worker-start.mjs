import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';
if(process.env.NODE_ENV!=='production'){
 try{loadEnvFile(fileURLToPath(new URL('../.env',import.meta.url)));}catch(e){if(e.code!=='ENOENT')throw e;}
}
process.env.DDV_PROCESS_ROLE='worker';
await import('./ai-worker.mjs');
