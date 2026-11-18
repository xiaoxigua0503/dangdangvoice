// .env is also used for the local Node server; its development NODE_ENV must
// never turn a release bundle into React's development runtime.
process.env.NODE_ENV = "production";
const { build } = await import("vite");
await build();
await import("./prepare-publish.mjs");
