import { Hono } from 'hono';
import { logEvent, sessionId, type AppEnv } from './auth.ts';

/** A short, stable handle for a session, so the full hash never leaves the server. */
const handle = (id: string) => id.slice(0, 12);

/**
 * The Security screen: devices signed in, passkeys and the security log.
 * Mounted under /api, so every route already needs a session and the CSRF header.
 */
export const security = new Hono<AppEnv>()
  .get('/', async (c) => {
    const db = c.env.DB;
    const current = await sessionId(c);
    const [sessions, passkeys, events] = await Promise.all([
      db
        .prepare("SELECT id, device, place, created_at, last_seen_at FROM sessions WHERE expires_at > datetime('now') ORDER BY COALESCE(last_seen_at, created_at) DESC")
        .all<{ id: string; device: string | null; place: string | null; created_at: string; last_seen_at: string | null }>(),
      db.prepare('SELECT id, label, created_at, last_used_at FROM credentials ORDER BY created_at').all<{
        id: string;
        label: string | null;
        created_at: string;
        last_used_at: string | null;
      }>(),
      db.prepare('SELECT at, type, device, place, detail FROM security_events ORDER BY id DESC LIMIT 30').all(),
    ]);
    return c.json({
      sessions: sessions.results.map((s) => ({
        handle: handle(s.id),
        device: s.device ?? 'Unknown device',
        place: s.place,
        since: s.created_at,
        lastSeen: s.last_seen_at ?? s.created_at,
        current: s.id === current,
      })),
      passkeys: passkeys.results.map((p) => ({ id: p.id, label: p.label ?? 'Passkey', added: p.created_at, lastUsed: p.last_used_at })),
      events: events.results,
    });
  })

  // Lost phone, shared computer: every other device has to sign in again.
  .post('/sessions/others/end', async (c) => {
    const current = await sessionId(c);
    const { meta } = await c.env.DB.prepare('DELETE FROM sessions WHERE id != ?').bind(current ?? '').run();
    await logEvent(c, 'others_signed_out', `${meta.changes} session${meta.changes === 1 ? '' : 's'}`);
    return c.json({ ended: meta.changes });
  })

  .delete('/sessions/:handle', async (c) => {
    const target = c.req.param('handle');
    if (!/^[A-Za-z0-9_-]{12}$/.test(target)) return c.json({ error: 'Unknown session' }, 404);
    const row = await c.env.DB.prepare('SELECT id, device FROM sessions WHERE substr(id, 1, 12) = ?').bind(target).first<{ id: string; device: string | null }>();
    if (!row) return c.json({ error: 'Unknown session' }, 404);
    if (row.id === (await sessionId(c))) return c.json({ error: 'Use Sign out for this device' }, 400);
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(row.id).run();
    await logEvent(c, 'session_ended', row.device ?? undefined);
    return c.json({ ok: true });
  })

  // A lost or replaced device's passkey. The last one can't go: there would be no way back in.
  .delete('/passkeys/:id', async (c) => {
    const id = c.req.param('id');
    const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM credentials').first<{ n: number }>();
    const passkey = await c.env.DB.prepare('SELECT label FROM credentials WHERE id = ?').bind(id).first<{ label: string | null }>();
    if (!passkey) return c.json({ error: 'Unknown passkey' }, 404);
    if ((count?.n ?? 0) <= 1) return c.json({ error: 'This is your only passkey. Add another device first.' }, 400);
    await c.env.DB.prepare('DELETE FROM credentials WHERE id = ?').bind(id).run();
    await logEvent(c, 'passkey_removed', passkey.label ?? undefined);
    return c.json({ ok: true });
  });
