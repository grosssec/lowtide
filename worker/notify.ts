import { monthKey } from '../shared/engine/index.ts';
import { buildDashboard, dailyMessage } from '../shared/plan/index.ts';
import { sendPush, type VapidKeys } from '../shared/push/webpush.ts';
import { getSetting, loadSubscriptions, putSetting } from './db.ts';
import { hourIn, loadState, todayIn } from './state.ts';

/** Local hour of the daily push. */
const DAILY_HOUR = 8;

/** Browser push services (Apple, Google, Mozilla, Microsoft): the only hosts the Worker will send pushes to. */
export const PUSH_HOSTS = ['push.apple.com', 'fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com'];

function vapidKeys(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK) as JsonWebKey };
}

/** Builds today's message, stores it, and pushes it to every device that turned notifications on. */
export async function sendDaily(env: Env): Promise<{ sent: number; removed: number; failed: number; message: { title: string; body: string } }> {
  const { plan, ledger, actuals, today } = await loadState(env);
  const message = dailyMessage(buildDashboard({ month: monthKey(today), config: plan, actuals, ledger }));
  await env.DB.prepare('INSERT INTO notifications (title, body) VALUES (?, ?)').bind(message.title, message.body).run();

  const keys = vapidKeys(env);
  const origin = await getSetting<string>(env.DB, 'app_origin');
  if (!keys || !origin) return { sent: 0, removed: 0, failed: 0, message };
  let sent = 0;
  let removed = 0;
  let failed = 0;
  for (const subscription of await loadSubscriptions(env.DB)) {
    const status = await sendPush(subscription, { ...message, url: '/#month' }, keys, origin);
    if (status === 404 || status === 410) {
      // The device unsubscribed or the browser dropped it.
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(subscription.endpoint).run();
      removed++;
    } else if (status < 300) {
      await env.DB.prepare("UPDATE push_subscriptions SET last_sent_at = datetime('now') WHERE endpoint = ?").bind(subscription.endpoint).run();
      sent++;
    } else {
      console.warn('push failed', status, new URL(subscription.endpoint).hostname);
      failed++;
    }
  }
  return { sent, removed, failed, message };
}

/** Hourly cron: sends the daily message once, at 8 am local time (works across daylight saving changes). */
export async function onSchedule(env: Env, now = new Date()): Promise<void> {
  if (hourIn(env.TIMEZONE, now) !== DAILY_HOUR) return;
  const day = todayIn(env.TIMEZONE, now);
  if ((await getSetting<string>(env.DB, 'daily_sent_on')) === day) return;
  // Marked first: a failure must not turn into a push every hour.
  await putSetting(env.DB, 'daily_sent_on', day);
  await sendDaily(env);
}
