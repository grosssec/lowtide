import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useState } from 'react';
import { Lockup } from '../components/Brand.tsx';
import { Button, ErrorNote, Field, inputClass } from '../components/ui.tsx';
import { api } from '../lib/api.ts';

export interface AuthStatus {
  signedIn: boolean;
  hasPasskey: boolean;
  bypass: boolean;
  /** The public demo: made-up data, read-only, frozen on `today`. */
  demo?: boolean;
  today?: string;
}

type RegistrationOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];
type AuthenticationOptions = Parameters<typeof startAuthentication>[0]['optionsJSON'];

export function LoginPage({ status, onSignedIn }: { status: AuthStatus; onSignedIn: () => void }) {
  const [deviceCode, setDeviceCode] = useState('');
  const [withCode, setWithCode] = useState(!status.hasPasskey);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const supported = browserSupportsWebAuthn();

  async function signIn() {
    setBusy(true);
    setError(undefined);
    try {
      const { options, challengeId } = await api<{ options: AuthenticationOptions; challengeId: string }>('/auth/login/options', { method: 'POST', json: {} });
      const response = await startAuthentication({ optionsJSON: options });
      await api('/auth/login/verify', { method: 'POST', json: { challengeId, response } });
      onSignedIn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setUp() {
    setBusy(true);
    setError(undefined);
    try {
      const { options, challengeId } = await api<{ options: RegistrationOptions; challengeId: string }>('/auth/register/options', {
        method: 'POST',
        json: { deviceCode },
      });
      const response = await startRegistration({ optionsJSON: options });
      await api('/auth/register/verify', { method: 'POST', json: { challengeId, deviceCode, response } });
      onSignedIn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-bg flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="fade-in w-full max-w-sm rounded-[28px] bg-surface p-7 shadow-pop sm:p-8">
        <div className="flex items-center gap-2.5">
          <Lockup size={36} />
        </div>
        {!supported ? (
          <p className="mt-6 text-sm text-ink-2">This browser can't use passkeys. Open the app in Safari or Chrome.</p>
        ) : !withCode ? (
          <>
            <h1 className="mt-8 text-[28px] font-semibold leading-tight tracking-[-0.03em]">Welcome back</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">Sign in with Face ID or Touch ID.</p>
            <Button className="mt-7 h-11 w-full" onClick={signIn} disabled={busy}>
              <svg viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
                <path d="M6.5 2.5h-2a2 2 0 0 0-2 2v2m15 0v-2a2 2 0 0 0-2-2h-2m0 15h2a2 2 0 0 0 2-2v-2m-15 0v2a2 2 0 0 0 2 2h2M7 7.5v1.5m6-1.5v1.5M10 7.5v4h-1m-2.5 2.5c1.9 1.4 5.1 1.4 7 0" />
              </svg>
              {busy ? 'Waiting for Face ID…' : 'Sign in'}
            </Button>
            <button type="button" className="mt-5 w-full text-center text-sm font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline" onClick={() => setWithCode(true)}>
              New device? Use a code
            </button>
          </>
        ) : (
          <>
            <h1 className="mt-8 text-[28px] font-semibold leading-tight tracking-[-0.03em]">{status.hasPasskey ? 'Add this device' : 'Set up sign-in'}</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              {status.hasPasskey
                ? 'On a device that is already signed in, open Settings → Security → Add a device, then type the code here.'
                : 'Type the code from npm run setup-code, then confirm with Face ID or Touch ID. After that, only your devices get in.'}
            </p>
            <div className="mt-6">
              <Field label="Device code">
                <input
                  className={`${inputClass} num h-12 text-center text-lg tracking-[0.25em]`}
                  value={deviceCode}
                  placeholder="ABCD-2345"
                  onChange={(e) => setDeviceCode(e.target.value.toUpperCase())}
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={9}
                />
              </Field>
            </div>
            <Button className="mt-4 h-11 w-full" onClick={setUp} disabled={busy || deviceCode.replace(/[^A-Za-z0-9]/g, '').length !== 8}>
              {busy ? 'Waiting for Face ID…' : 'Create passkey'}
            </Button>
            {status.hasPasskey && (
              <button type="button" className="mt-5 w-full text-center text-sm font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline" onClick={() => setWithCode(false)}>
                Back to sign in
              </button>
            )}
          </>
        )}
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      </div>
    </div>
  );
}
