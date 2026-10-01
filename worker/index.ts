import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { ZodError } from 'zod';
import { api } from './api.ts';
import { auth, hasSession, type AppEnv } from './auth.ts';

const app = new Hono<AppEnv>();

app.use('/api/*', secureHeaders());
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

// Everything except the login endpoints needs a session.
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) return next();
  if (!(await hasSession(c))) return c.json({ error: 'Not signed in' }, 401);
  return next();
});

// CSRF: state-changing calls must carry this header, which only our own pages send (cookies are also SameSite=Strict).
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.header('X-Requested-With') !== 'finance-dashboard') {
    return c.json({ error: 'Missing request header' }, 400);
  }
  return next();
});

app.route('/api/auth', auth);
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

export default app;
