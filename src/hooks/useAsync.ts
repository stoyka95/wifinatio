import { useCallback, useEffect, useRef, useState } from 'react';

/** Runs an async backend call, tracking data, error and loading. `auto` runs it on mount. */
export const useAsync = <T>(fn: () => Promise<T>, auto: boolean) => {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(auto);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fnRef.current());
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (auto) run();
  }, [auto, run]);

  return { data, error, loading, run };
};
