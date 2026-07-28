import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { runCommand } from "../bridge";

/**
 * How long the store waits after the last edit before writing to disk.
 *
 * The window auto-saved on a 5-second clock, which is also why its PostgreSQL
 * credentials could be up to 5 seconds stale. Saving on the edit itself
 * removes both the clock and the staleness; the delay only exists so that
 * dragging a slider is one write and not two hundred.
 *
 * Not a motion number: it drives no animation, so it does not belong in
 * `motion/tokens.ts`.
 */
export const SAVE_DEBOUNCE_MS = 400;

/** The flat dictionary, keyed exactly like Python's DEFAULT_CONFIG. */
export type Settings = Record<string, unknown>;

interface SettingsContextValue {
  settings: Settings;
  setSetting: (key: string, value: unknown) => void;
  loading: boolean;
  error: string | null;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The load itself must not trigger a save: without this, every start-up
  // would rewrite the file it just read.
  const dirty = useRef(false);

  useEffect(() => {
    let cancelled = false;
    runCommand("load_config")
      .then((result) => {
        if (cancelled) return;
        setSettings((result.data ?? {}) as Settings);
      })
      .catch((cause: Error) => {
        if (cancelled) return;
        // Say it once and keep the window usable. A shell that blanks itself
        // because the engine is missing hides the one message that explains why.
        setError(cause.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setSetting = useCallback((key: string, value: unknown) => {
    dirty.current = true;
    setSettings((previous) => ({ ...previous, [key]: value }));
  }, []);

  useEffect(() => {
    if (!dirty.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      runCommand("save_config", { cfg: settings }).catch((cause: Error) => {
        setError(cause.message);
      });
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [settings]);

  return (
    <SettingsContext.Provider value={{ settings, setSetting, loading, error }}>
      {children}
    </SettingsContext.Provider>
  );
}

function useSettingsContext(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSetting must be used inside a SettingsProvider");
  }
  return context;
}

/** Read and write one configuration key. The key IS the DEFAULT_CONFIG key. */
export function useSetting<T>(key: string): [T | undefined, (value: T) => void] {
  const { settings, setSetting } = useSettingsContext();
  const set = useCallback((value: T) => setSetting(key, value), [key, setSetting]);
  return [settings[key] as T | undefined, set];
}

/** Whether the configuration is still loading, and what went wrong if it did. */
export function useSettingsStatus(): { loading: boolean; error: string | null } {
  const { loading, error } = useSettingsContext();
  return { loading, error };
}
