// Node HTTP adapter: same accounts, admin, relay and AI APIs as standalone Node.
// NODEJS_HELPERS=0 is required on Vercel to preserve the original request stream.
export {requestHandler as default} from '../server.mjs';
