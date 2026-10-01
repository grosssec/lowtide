import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';

/** Loads a GET endpoint. Keeps the previous data while reloading, so the page never jumps. */
export function useApi<T>(path: string) {
  const [nonce, setNonce] = useState(0);
  const key = `${path}#${nonce}`;
  const [state, setState] = useState<{ key?: string; data?: T; error?: string }>({});

  useEffect(() => {
    let alive = true;
    api<T>(path)
      .then((data) => alive && setState({ key, data }))
      .catch((e: Error) => alive && setState((previous) => ({ key, data: previous.data, error: e.message })));
    return () => {
      alive = false;
    };
  }, [key, path]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return {
    data: state.data,
    error: state.key === key ? state.error : undefined,
    loading: state.key !== key,
    reload,
  };
}
