// Test helper: runs Lucian's real backend app (MemoryStore, test JWT secret) on 127.0.0.1:8799 plus GET /__token/:uid?v=0|1.
// Usage: node app/tests/live_backend_server.mjs [/path/to/PayAviator-Backend]   (backend branch cloud-sync-pause-banks)
import http from 'node:http';
const BE = process.argv[2] || '/workspace/PayAviator-Backend';
const { buildApp, JWT_SECRET } = await import(`${BE}/test/helpers.js`);
const { SignJWT } = await import(`${BE}/node_modules/jose/dist/webapi/index.js`);
const { app } = buildApp();
const tok = (sub, claims) => new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(JWT_SECRET));
http.createServer(async (req, res) => {
  const m = /^\/__token\/([\w-]+)\?v=([01])$/.exec(req.url) || /^\/__token\/([\w-]+)$/.exec(req.url);
  if (m) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ token: await tok(m[1], { email_verified: m[2] !== '0' }) })); }
  app(req, res);
}).listen(8799, '127.0.0.1', () => console.log('ready'));
