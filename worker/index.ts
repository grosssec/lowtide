import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { ZodError } from 'zod';
import { api } from './api.ts';
import { auth, hasSession, type AppEnv } from './auth.ts';
import { ingest } from './ingest.ts';
import { onSchedule } from './notify.ts';
import { security } from './security.ts';

const app = new Hono<AppEnv>();

app.use('/api/*', secureHeaders());
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

// workers.dev can't set a minimum TLS version, so the API refuses TLS 1.0 / 1.1 itself (they have known weaknesses).
app.use('/api/*', async (c, next) => {
  const tls = (c.req.raw as Request & { cf?: { tlsVersion?: string } }).cf?.tlsVersion;
  if (tls && /^TLSv1(\.[01])?$/.test(tls)) return c.json({ error: 'Please update your browser: TLS 1.2 or newer is required' }, 426);
  return next();
});

// Request bodies: statement imports can be a few MB of rows; nothing else needs more than 1 MB.
app.use('/api/*', (c, next) =>
  bodyLimit({ maxSize: c.req.path === '/api/import' ? 6 * 1024 * 1024 : 1024 * 1024, onError: (ctx) => ctx.json({ error: 'Request too large' }, 413) })(
    c,
    next,
  ),
);

// The sync script authenticates with its own bearer token (worker/ingest.ts), never with the session cookie.
const isIngest = (path: string) => path.startsWith('/api/ingest/');

// Rate limits per client IP: sign-in is the tightest (each attempt writes a challenge), then the sync, then the rest.
app.use('/api/*', async (c, next) => {
  const path = c.req.path;
  const limiter = path.startsWith('/api/auth/') ? c.env.AUTH_LIMIT : isIngest(path) ? c.env.INGEST_LIMIT : c.env.API_LIMIT;
  const ip = c.req.header('CF-Connecting-IP') ?? 'local';
  const { success } = await limiter.limit({ key: ip });
  if (!success) {
    console.warn('rate limited', path, ip);
    return c.json({ error: 'Too many requests, try again in a minute' }, 429);
  }
  return next();
});

// Everything except the login endpoints and the sync script needs a session.
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/') || isIngest(c.req.path)) return next();
  if (!(await hasSession(c))) return c.json({ error: 'Not signed in' }, 401);
  return next();
});

// CSRF: state-changing calls must carry this header, which only our own pages send (cookies are also SameSite=Strict).
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && !isIngest(c.req.path) && c.req.header('X-Requested-With') !== 'finance-dashboard') {
    return c.json({ error: 'Missing request header' }, 400);
  }
  return next();
});

app.route('/api/auth', auth);
app.route('/api/ingest', ingest);
app.route('/api/security', security);
app.route('/api', api);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((error, c) => {
  if (error instanceof ZodError) {
    return c.json({ error: 'Invalid request', issues: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, 400);
  }
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  if (error instanceof SyntaxError) return c.json({ error: 'Invalid JSON' }, 400);
  // Details stay in the Worker logs; the client never sees internals.
  console.error(error);
  return c.json({ error: 'Something went wrong' }, 500);
});

export default {
  fetch: app.fetch,
  // Hourly Cron Trigger (wrangler.jsonc): the daily push.
  scheduled: async (_controller, env, ctx) => {
    ctx.waitUntil(onSchedule(env));
  },
} satisfies ExportedHandler<Env>;
