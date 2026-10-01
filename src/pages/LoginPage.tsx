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
  const [setupToken, setSetupToken] = useState('');
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
        json: { setupToken },
      });
      const response = await startRegistration({ optionsJSON: options });
      await api('/auth/register/verify', { method: 'POST', json: { challengeId, setupToken, response, label: navigator.platform } });
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
      ) : status.hasPasskey ? (
        <>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-ink-2">Sign in with Face ID or Touch ID.</p>
          <Button className="mt-6 w-full" onClick={signIn} disabled={busy}>
            {busy ? 'Waiting for Face ID…' : 'Sign in'}
          </Button>
        </>
      ) : (
        <>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">Set up sign-in</h1>
          <p className="mt-1 text-sm text-ink-2">Enter the setup code once, then confirm with Face ID or Touch ID. After that, only your devices get in.</p>
          <div className="mt-6">
            <Field label="Setup code">
              <input className={inputClass} value={setupToken} onChange={(e) => setSetupToken(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
            </Field>
          </div>
          <Button className="mt-4 w-full" onClick={setUp} disabled={busy || !setupToken}>
            {busy ? 'Waiting for Face ID…' : 'Create passkey'}
          </Button>
        </>
      )}
      <div className="mt-4">
        <ErrorNote message={error} />
      </div>
    </div>
  );
}
