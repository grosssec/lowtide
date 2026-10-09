import { startRegistration } from '@simplewebauthn/browser';
import { useState } from 'react';
import { Button, Card, Chip, ErrorNote, Loading, ShowMore, StatusIcon } from '../../components/ui.tsx';
import { confirmDialog } from '../../lib/feedback.tsx';
import { api } from '../../lib/api.ts';
import { useApi } from '../../lib/useApi.ts';
import { Saved } from './fields.tsx';

interface SecurityData {
  sessions: { handle: string; device: string; place: string | null; since: string; lastSeen: string; current: boolean }[];
  passkeys: { id: string; label: string; added: string; lastUsed: string | null }[];
  events: { at: string; type: string; device: string | null; place: string | null; detail: string | null }[];
}

const EVENT_TEXT: Record<string, string> = {
  sign_in: 'Signed in',
  sign_out: 'Signed out',
  passkey_added: 'Passkey added',
  passkey_removed: 'Passkey removed',
  session_ended: 'Device signed out remotely',
  others_signed_out: 'Signed out all other devices',
  device_code_created: 'Code made to add a device',
};

/** Server times are UTC ("2026-10-08 14:03:00"); show them in the viewer's time. */
function when(utc: string): string {
  const date = new Date(`${utc.replace(' ', 'T')}Z`);
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const Row = ({ children }: { children: React.ReactNode }) => <li className="flex items-center justify-between gap-3 py-2.5">{children}</li>;

export function SecurityCard() {
  const { data, error, reload } = useApi<SecurityData>('/security');
  const [state, setState] = useState('idle');
  const [code, setCode] = useState<{ code: string; minutes: number } | null>(null);

  async function run(action: () => Promise<unknown>) {
    setState('saving');
    try {
      await action();
      setState('saved');
      reload();
    } catch (e) {
      setState((e as Error).message);
    }
  }
  const addPasskey = () =>
    run(async () => {
      const { options, challengeId } = await api<{ options: Parameters<typeof startRegistration>[0]['optionsJSON']; challengeId: string }>('/auth/register/options', {
        method: 'POST',
        json: {},
      });
      const response = await startRegistration({ optionsJSON: options });
      await api('/auth/register/verify', { method: 'POST', json: { challengeId, response } });
    });
  const endSession = (handle: string) => run(() => api(`/security/sessions/${handle}`, { method: 'DELETE' }));
  const endOthers = async () => {
    const ok = await confirmDialog({
      title: 'Sign out all other devices?',
      body: 'Every device except this one will need Face ID or Touch ID again. Passkeys stay as they are.',
      confirm: 'Sign them out',
      danger: true,
    });
    if (ok) void run(() => api('/security/sessions/others/end', { method: 'POST', json: {} }));
  };
  const removePasskey = async (id: string, label: string) => {
    const ok = await confirmDialog({
      title: `Remove "${label}"?`,
      body: 'That device will no longer be able to sign in. You can add it again later with a device code.',
      confirm: 'Remove passkey',
      danger: true,
    });
    if (ok) void run(() => api(`/security/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }));
  };
  const makeCode = () =>
    run(async () => {
      setCode(await api<{ code: string; minutes: number }>('/security/device-code', { method: 'POST', json: {} }));
    });
  async function signOut() {
    await api('/auth/logout', { method: 'POST', json: {} }).catch(() => undefined);
    window.location.reload();
  }

  return (
    <Card title="Security">
      <p className="-mt-1 text-sm text-ink-2">Sign-in uses passkeys (Face ID / Touch ID): no passwords to steal. Lost a device? Sign it out and remove its passkey here.</p>
      {!data ? (
        error ? <ErrorNote message={error} /> : <Loading variant="inline" />
      ) : (
        <div className="mt-4 space-y-5">
          <section>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-medium text-muted">Devices signed in</h3>
              {data.sessions.length > 1 && (
                <button type="button" className="text-xs text-critical-ink hover:underline" onClick={endOthers}>
                  Sign out all other devices
                </button>
              )}
            </div>
            <ul className="divide-y divide-line text-sm">
              {data.sessions.map((s) => (
                <Row key={s.handle}>
                  <span className="min-w-0">
                    <span className="text-ink">{s.device}</span>
                    {s.current && <Chip tone="accent" className="ml-2 !h-5 !px-2 !text-[11px]">this device</Chip>}
                    <span className="block text-xs text-muted">
                      {s.place ? `${s.place} · ` : ''}last active {when(s.lastSeen)} · signed in {when(s.since)}
                    </span>
                  </span>
                  {!s.current && (
                    <Button variant="danger" size="sm" onClick={() => endSession(s.handle)}>
                      Sign out
                    </Button>
                  )}
                </Row>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-xs font-medium text-muted">Passkeys</h3>
            <ul className="divide-y divide-line text-sm">
              {data.passkeys.map((p) => (
                <Row key={p.id}>
                  <span className="min-w-0">
                    <span className="text-ink">{p.label}</span>
                    <span className="block text-xs text-muted">
                      added {when(p.added)}
                      {p.lastUsed ? ` · last used ${when(p.lastUsed)}` : ''}
                    </span>
                  </span>
                  {data.passkeys.length > 1 && (
                    <Button variant="danger" size="sm" onClick={() => removePasskey(p.id, p.label)}>
                      Remove
                    </Button>
                  )}
                </Row>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-xs font-medium text-muted">Recent activity</h3>
            {data.events.length ? (
              <ShowMore
                items={data.events}
                limit={5}
                className="divide-y divide-line text-sm"
                render={(e, i) => (
                  <li key={`${e.at}-${i}`} className="flex items-start gap-2.5 py-2.5">
                    <StatusIcon level={e.type === 'sign_in' || e.type === 'passkey_added' ? 'info' : 'warning'} className="mt-0.5 size-4" />
                    <span className="min-w-0">
                      <span className="text-ink">{EVENT_TEXT[e.type] ?? e.type}</span>
                      {e.detail ? <span className="text-ink-2"> · {e.detail}</span> : null}
                      <span className="block text-xs text-muted">
                        {when(e.at)} · {e.device ?? 'unknown device'}
                        {e.place ? ` · ${e.place}` : ''}
                      </span>
                    </span>
                  </li>
                )}
              />
            ) : (
              <p className="mt-1 text-sm text-muted">Nothing yet: sign-ins and changes show up here.</p>
            )}
            <p className="mt-2 text-xs text-muted">Failed sign-in attempts are kept in the server logs, not here, so they can never fill up the database.</p>
          </section>
        </div>
      )}
      {code && (
        <div className="mt-4 rounded-xl bg-series-1-soft/50 p-4 text-sm">
          <div className="text-ink-2">On the new device, open the app, tap "New device? Use a code" and type:</div>
          <div className="num my-2 text-3xl font-semibold tracking-[0.2em] text-ink">{code.code}</div>
          <div className="text-xs text-muted">Works once, for {code.minutes} minutes. Don't send it to anyone.</div>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="quiet" onClick={makeCode}>
          Add a device
        </Button>
        <Button variant="quiet" onClick={addPasskey}>
          Add a passkey here
        </Button>
        <Button variant="danger" onClick={signOut}>
          Sign out
        </Button>
        <Saved state={state} />
      </div>
    </Card>
  );
}
