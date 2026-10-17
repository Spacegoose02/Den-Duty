import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type HomeDetail, type Whoami } from './api.ts';
import { THEME_DEFS } from '../../shared/themes.ts';

interface AppState {
  who: Whoami | null;
  loading: boolean;
  /** The home being looked at: the parent's chosen home, or the family tablet's home. */
  homeId: string | null;
  home: HomeDetail | null;
  refresh: () => Promise<void>;
  refreshHome: () => Promise<void>;
  setHome: (id: string) => void;
  toast: (msg: string) => void;
  /** Prefix for the current home's API routes. */
  base: string;
  /** Whether the active theme is dark (charts pick their dark-mode colors from this). */
  dark: boolean;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [who, setWho] = useState<Whoami | null>(null);
  const [loading, setLoading] = useState(true);
  const [homeId, setHomeId] = useState<string | null>(null);
  const [home, setHomeDetail] = useState<HomeDetail | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const w = await api<Whoami>('/api/whoami');
      setWho(w);
      setHomeId((cur) => {
        if (!w.user) return w.device?.homeId ?? null;
        const ids = w.homes.map((h) => h.id);
        if (cur && ids.includes(cur)) return cur;
        if (w.user.lastHomeId && ids.includes(w.user.lastHomeId)) return w.user.lastHomeId;
        return ids[0] ?? null;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshHome = useCallback(async () => {
    if (!homeId) { setHomeDetail(null); return; }
    try { setHomeDetail(await api<HomeDetail>(`/api/homes/${homeId}`)); } catch { setHomeDetail(null); }
  }, [homeId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void refreshHome(); }, [refreshHome, who]);

  // Parents see their own theme (or the home's); the family tablet shows the kid's theme, else the home's.
  const homeTheme = home?.theme ?? 'sunny';
  const theme = who?.user
    ? (who.user.theme === 'home' ? homeTheme : who.user.theme)
    : (who?.kid?.theme ?? homeTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setHome = useCallback((id: string) => {
    setHomeId(id);
    void api('/api/me', { method: 'PATCH', body: { lastHomeId: id } });
  }, []);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 3200);
  }, []);

  return (
    <Ctx.Provider value={{ who, loading, homeId, home, refresh, refreshHome, setHome, toast, base: `/api/homes/${homeId}`, dark: !!THEME_DEFS.find((t) => t.id === theme)?.dark }}>
      {children}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </Ctx.Provider>
  );
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

/** Small data-loading hook: returns [data, reload, error]. */
export function useLoad<T>(path: string | null, deps: unknown[] = []): [T | null, () => Promise<void>, string | null] {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { void load(); }, [load]);
  return [data, load, error];
}

/** Shows "12 ✨ Shinies" style amounts with the home's own points name. */
export function usePoints(): (n: number, withName?: boolean) => string {
  const { home } = useApp();
  return (n, withName = true) => `${n} ${home?.pointsIcon ?? '✨'}${withName ? ` ${home?.pointsName ?? 'Shinies'}` : ''}`;
}
