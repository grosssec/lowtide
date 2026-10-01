import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { ZodError } from 'zod';
import { api } from './api.ts';
import { auth, hasSession, type AppEnv } from './auth.ts';
import { ingest } from './ingest.ts';
import { onSchedule } from './notify.ts';

const app = new Hono<AppEnv>();

app.use('/api/*', secureHeaders());
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

// The sync script authenticates with its own bearer token (worker/ingest.ts), never with the session cookie.
const isIngest = (path: string) => path.startsWith('/api/ingest/');

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
app.route('/api', api);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((error, c) => {
  if (error instanceof ZodError) {
    return c.json({ error: 'Invalid request', issues: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, 400);
  }
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  console.error(error);
  return c.json({ error: error.message }, 500);
});

export default {
  fetch: app.fetch,
  // Hourly Cron Trigger (wrangler.jsonc): the daily push.
  scheduled: async (_controller, env, ctx) => {
    ctx.waitUntil(onSchedule(env));
  },
} satisfies ExportedHandler<Env>;
