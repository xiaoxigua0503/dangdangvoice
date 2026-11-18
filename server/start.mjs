// Resolve the intended local .env from the application root, not the terminal cwd.
// Explicit deployment environment variables retain precedence over .env.
import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';
try { if(process.env.NODE_ENV!=='production') loadEnvFile(fileURLToPath(new URL('../.env',import.meta.url))); }
catch(e) { if(e.code!=='ENOENT')throw e; }
await import('../server.mjs');
