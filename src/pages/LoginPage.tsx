import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useState } from 'react';
import { Logo } from '../components/Shell.tsx';
import { Button, ErrorNote, Field, inputClass } from '../components/ui.tsx';
import { api } from '../lib/api.ts';

export interface AuthStatus {
  signedIn: boolean;
  hasPasskey: boolean;
  bypass: boolean;
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
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <div className="flex items-center gap-2.5">
        <Logo />
        <span className="text-[15px] font-semibold tracking-tight">Finance</span>
      </div>
      {!supported ? (
        <p className="mt-6 text-sm text-ink-2">This browser can't use passkeys. Open the app in Safari or Chrome.</p>
      ) : !withCode ? (
        <>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-ink-2">Sign in with Face ID or Touch ID.</p>
          <Button className="mt-6 w-full" onClick={signIn} disabled={busy}>
            {busy ? 'Waiting for Face ID…' : 'Sign in'}
          </Button>
          <button type="button" className="mt-4 text-sm text-ink-2 underline-offset-2 hover:underline" onClick={() => setWithCode(true)}>
            New device? Use a code
          </button>
        </>
      ) : (
        <>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">{status.hasPasskey ? 'Add this device' : 'Set up sign-in'}</h1>
          <p className="mt-1 text-sm text-ink-2">
            {status.hasPasskey
              ? 'On a device that is already signed in, open Settings → Security → Add a device, then type the code here.'
              : 'Type the code from npm run setup-code, then confirm with Face ID or Touch ID. After that, only your devices get in.'}
          </p>
          <div className="mt-6">
            <Field label="Device code">
              <input
                className={`${inputClass} num tracking-widest`}
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
          <Button className="mt-4 w-full" onClick={setUp} disabled={busy || deviceCode.replace(/[^A-Za-z0-9]/g, '').length !== 8}>
            {busy ? 'Waiting for Face ID…' : 'Create passkey'}
          </Button>
          {status.hasPasskey && (
            <button type="button" className="mt-4 text-sm text-ink-2 underline-offset-2 hover:underline" onClick={() => setWithCode(false)}>
              Back to sign in
            </button>
          )}
        </>
      )}
      <div className="mt-4">
        <ErrorNote message={error} />
      </div>
    </div>
  );
}
