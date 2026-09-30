// DEV ONLY - a stand-in for a Supabase project on this machine.
//
//   http://localhost:54321/rest/v1/*   -> PostgREST (spawned here, port 54330)
//   http://localhost:54321/auth/v1/*   -> password sign-in, refresh, user, logout
//
// supabase-js talks to it unchanged, so the apps need nothing special: point
// VITE_SUPABASE_URL at a real project later and this file is no longer used.
// Realtime is not emulated; the apps treat it as optional.

import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 54321;
const REST_PORT = 54330;
const JWT_SECRET = 'nws-commerce-local-dev-jwt-secret-0123456789';
const DATABASE = process.env.NWSC_DEV_DB || 'nwscommerce_dev';
const ACCESS_TTL = 3600;

const db = new pg.Pool({ host: 'localhost', database: DATABASE, max: 4 });

// ---------------------------------------------------------------------------
// JWT (HS256), enough for PostgREST and supabase-js
// ---------------------------------------------------------------------------
const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token) {
  const [header, body, sig] = String(token || '').split('.');
  if (!header || !body || !sig) return null;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
function userObject(row) {
  return {
    id: row.id, aud: 'authenticated', role: 'authenticated', email: row.email,
    email_confirmed_at: row.email_confirmed_at, last_sign_in_at: row.last_sign_in_at,
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
    identities: [], created_at: row.created_at, updated_at: row.created_at,
  };
}

async function loadUser(id) {
  const { rows } = await db.query(
    'select id, email, email_confirmed_at, last_sign_in_at, created_at from auth.users where id = $1', [id]);
  return rows[0] || null;
}

function session(user) {
  const now = Math.floor(Date.now() / 1000);
  const access_token = signJwt({
    sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated',
    iat: now, exp: now + ACCESS_TTL, session_id: crypto.randomUUID(),
  });
  const refresh_token = signJwt({ sub: user.id, typ: 'refresh', iat: now, exp: now + 30 * 86400 });
  return {
    access_token, token_type: 'bearer', expires_in: ACCESS_TTL, expires_at: now + ACCESS_TTL,
    refresh_token, user: userObject(user),
  };
}

const authError = (res, status, code, msg) =>
  send(res, status, { code: status, error_code: code, msg, error: code, error_description: msg });

async function handleAuth(req, res, url) {
  const route = url.pathname.replace('/auth/v1', '');

  if (route === '/token' && req.method === 'POST') {
    const body = await readJson(req);
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const { rows } = await db.query('select auth.dev_check_password($1, $2) as id', [body.email || '', body.password || '']);
      if (!rows[0]?.id) return authError(res, 400, 'invalid_credentials', 'Invalid login credentials');
      await db.query('update auth.users set last_sign_in_at = now() where id = $1', [rows[0].id]);
      return send(res, 200, session(await loadUser(rows[0].id)));
    }
    if (grant === 'refresh_token') {
      const claims = verifyJwt(body.refresh_token);
      const user = claims?.typ === 'refresh' ? await loadUser(claims.sub) : null;
      if (!user) return authError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token');
      return send(res, 200, session(user));
    }
    return authError(res, 400, 'unsupported_grant_type', 'Unsupported grant type');
  }

  if (route === '/signup' && req.method === 'POST') {
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return authError(res, 400, 'validation_failed', 'Unable to validate email address: invalid format');
    if (String(body.password || '').length < 8) return authError(res, 422, 'weak_password', 'Password should be at least 8 characters.');
    const exists = await db.query('select 1 from auth.users where lower(email) = $1', [email]);
    if (exists.rowCount) return authError(res, 422, 'user_already_exists', 'User already registered');
    const { rows } = await db.query('select auth.dev_create_user($1, $2) as id', [email, body.password]);
    // Local projects skip email confirmation, like a Supabase project with it turned off.
    return send(res, 200, session(await loadUser(rows[0].id)));
  }

  const claims = verifyJwt((req.headers.authorization || '').replace(/^Bearer /i, ''));

  if (route === '/user' && req.method === 'GET') {
    const user = claims?.sub && claims.role === 'authenticated' ? await loadUser(claims.sub) : null;
    if (!user) return authError(res, 401, 'bad_jwt', 'invalid JWT');
    return send(res, 200, userObject(user));
  }
  if (route === '/logout' && req.method === 'POST') {
    res.writeHead(204, cors()).end();
    return;
  }
  return authError(res, 404, 'not_found', `${route} is not emulated locally`);
}

// ---------------------------------------------------------------------------
// REST: proxy to PostgREST, turning the apikey header into a bearer token the
// way the Supabase gateway does.
// ---------------------------------------------------------------------------
function proxyRest(req, res, url) {
  const headers = { ...req.headers, host: `127.0.0.1:${REST_PORT}` };
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
  const upstream = http.request(
    { host: '127.0.0.1', port: REST_PORT, method: req.method, headers,
      path: url.pathname.replace(/^\/rest\/v1/, '') + url.search },
    (up) => {
      res.writeHead(up.statusCode, { ...up.headers, ...cors() });
      up.pipe(res);
    });
  upstream.on('error', (e) => send(res, 502, { message: `PostgREST unavailable: ${e.message}` }));
  req.pipe(upstream);
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------
function cors() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, apikey, content-type, prefer, range, x-client-info, accept-profile, content-profile, x-supabase-api-version',
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'access-control-expose-headers': 'content-range, x-total-count',
  };
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', ...cors() });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') return res.writeHead(204, cors()).end();
  try {
    if (url.pathname.startsWith('/rest/v1')) return proxyRest(req, res, url);
    if (url.pathname.startsWith('/auth/v1')) return await handleAuth(req, res, url);
    return send(res, 404, { message: 'not found' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { message: e.message });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rest = spawn('postgrest', [path.join(HERE, 'postgrest.conf')], { stdio: ['ignore', 'inherit', 'inherit'] });
  const stop = () => { rest.kill(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  rest.on('exit', (code) => { console.error(`postgrest exited (${code})`); process.exit(1); });

  server.listen(PORT, () => {
    const anon = signJwt({ role: 'anon', iss: 'nws-commerce-local', iat: 1700000000, exp: 4102444800 });
    console.log(`\nLocal Supabase stand-in on http://localhost:${PORT}  (database: ${DATABASE})`);
    console.log(`anon key: ${anon}\n`);
  });
}
