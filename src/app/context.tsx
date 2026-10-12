// Contexto global: repositorio local, motor de sincronización, perfil seleccionado, permisos, avisos y preferencias.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Repo } from '../db/repo';
import { SyncEngine, type SyncStatus } from '../sync/engine';
import { HttpTransport, type Transport } from '../sync/transport';
import { ensureSeed } from '../services/seed';
import { ensureTaskOccurrences } from '../services/tasks';
import { ensurePaymentOccurrences } from '../services/money';
import { dailyLocalBackup } from '../services/backup';
import { categoriesFrom, notificationSettingsFrom, permissionsFrom, type NotificationSettings } from '../services/config';
import type { CategoryModule, Category } from '../domain/catalog';
import { can as canFn, type Capability, type PermissionMatrix } from '../domain/permissions';
import type { ConfigEntry, Profile } from '../domain/types';
import { ValidationError } from '../domain/validation';
import { DEFAULT_AI_SETTINGS, type AISettings } from '../ai/types';
import { buildNotifications, inQuietHours } from '../services/notifications';
import { nowISO } from '../domain/dates';
import { tones } from '../ui/theme';

export interface Toast { id: number; message: string; tone?: 'error' | 'ok'; action?: { label: string; run: () => void } }
export interface BackendConfig { url: string; token: string }

interface AppCtx {
  repo: Repo; sync: SyncEngine; profiles: Profile[]; profile?: Profile; setProfileId: (id: string) => void;
  /** Cambia de perfil; si tiene PIN, lo pide primero. */
  requestProfile: (p: Profile) => void; pinRequest: Profile | null; clearPinRequest: () => void;
  configRows: ConfigEntry[]; categories: (m: CategoryModule) => Category[]; permissions: PermissionMatrix; notifSettings: NotificationSettings;
  can: (c: Capability) => boolean; toast: (message: string, opts?: Partial<Omit<Toast, 'id' | 'message'>>) => void; toasts: Toast[]; dismissToast: (id: number) => void;
  run: <T>(fn: () => Promise<T>, success?: string) => Promise<T | undefined>;
  syncStatus?: SyncStatus; online: boolean; backend?: BackendConfig | null; setBackend: (b: BackendConfig | null) => Promise<void>;
  ai: AISettings; setAI: (s: AISettings) => Promise<void>; prefs: LocalPrefs; setPrefs: (p: Partial<LocalPrefs>) => Promise<void>;
}
export interface LocalPrefs { theme: 'auto' | 'light' | 'dark'; size: 'normal' | 'large' }

const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp fuera de AppProvider');
  return c;
};

export async function bootstrap(dbName = 'hogar'): Promise<Repo> {
  const repo = await Repo.open(dbName);
  await ensureSeed(repo);
  await ensureTaskOccurrences(repo, { origin: 'sistema' });
  await ensurePaymentOccurrences(repo, { origin: 'sistema' });
  try { await dailyLocalBackup(repo); } catch { /* sin espacio: se informa en Ajustes */ }
  return repo;
}

export function AppProvider({ repo, children }: { repo: Repo; children: ReactNode }) {
  const [backend, setBackendState] = useState<BackendConfig | null | undefined>(undefined);
  const backendRef = useRef<BackendConfig | null>(null);
  const sync = useMemo(() => new SyncEngine(repo, async () => {
    const b = backendRef.current;
    return b?.url && b?.token ? (new HttpTransport(b.url, b.token) as Transport) : null;
  }), [repo]);
  const [currentId, setCurrentId] = useState<string | undefined>();
  const [pinRequest, setPinRequest] = useState<Profile | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>();
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [ai, setAiState] = useState<AISettings>(DEFAULT_AI_SETTINGS);
  const [prefs, setPrefsState] = useState<LocalPrefs>({ theme: 'auto', size: 'normal' });

  const profiles = useLiveQuery(async () => {
    const SEED_ORDER = ['profile-papa', 'profile-mama', 'profile-hijo', 'profile-hija', 'profile-familia'];
    const ROLE_ORDER: Record<string, number> = { adult: 10, child: 20, family: 30 };
    const rank = (p: Profile) => (SEED_ORDER.includes(p.id) ? SEED_ORDER.indexOf(p.id) : ROLE_ORDER[p.role] ?? 99);
    return (await repo.db.entity('profiles').filter((p) => !p.deleted).toArray())
      .sort((a, b) => rank(a) - rank(b) || (a.createdAt < b.createdAt ? -1 : 1));
  }, [repo], []) ?? [];
  const configRows = useLiveQuery(() => repo.db.entity('config').toArray(), [repo], []) ?? [];
  const outboxCount = useLiveQuery(() => repo.db.outbox.count(), [repo], 0);
  const conflictCount = useLiveQuery(() => repo.db.conflicts.filter((c) => !c.resolved).count(), [repo], 0);

  useEffect(() => {
    (async () => {
      const b = await repo.db.getKV<BackendConfig | null>('backend', null);
      backendRef.current = b; setBackendState(b);
      setCurrentId(await repo.db.getKV<string>('currentProfileId'));
      setAiState({ ...DEFAULT_AI_SETTINGS, ...(await repo.db.getKV('aiSettings', {})) });
      setPrefsState({ theme: 'auto', size: 'normal', ...(await repo.db.getKV('prefs', {})) });
    })();
  }, [repo]);

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme === 'auto' ? '' : prefs.theme;
    if (prefs.theme === 'auto') delete document.documentElement.dataset.theme;
    document.documentElement.dataset.size = prefs.size;
  }, [prefs]);

  const profile = profiles.find((p) => p.id === currentId && p.active) ?? undefined;
  const permissions = permissionsFrom(configRows);
  const notifSettings = notificationSettingsFrom(configRows);
  // El color del perfil activo tiñe encabezado, botones de acción y selección.
  useEffect(() => {
    const t = tones(profile?.color ?? '#c2bbb4');
    const st = document.documentElement.style;
    st.setProperty('--profile', t.base); st.setProperty('--profile-tint', t.tint); st.setProperty('--profile-soft', t.soft);
    st.setProperty('--profile-ink', t.ink); st.setProperty('--profile-on', t.on);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.base);
  }, [profile?.color]);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, ...opts }]);
    setTimeout(() => dismissToast(id), opts.action ? 7000 : opts.tone === 'error' ? 6000 : 3200);
  }, [dismissToast]);

  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string) => {
    try {
      const r = await fn();
      if (success) toast(success + (backendRef.current ? '' : ''), { tone: 'ok' });
      return r;
    } catch (e: any) {
      toast(e instanceof ValidationError ? e.errors.join(' ') : e?.message ?? 'Ocurrió un error inesperado.', { tone: 'error' });
      return undefined;
    }
  }, [toast]);

  const refreshStatus = useCallback(async () => setSyncStatus(await sync.status()), [sync]);
  useEffect(() => { refreshStatus(); }, [refreshStatus, outboxCount, conflictCount, backend, online]);
  useEffect(() => sync.onChange(() => { refreshStatus(); }), [sync, refreshStatus]);

  // Sincronización automática: al abrir, al recuperar conexión, tras cambios locales y periódicamente.
  useEffect(() => {
    const goOnline = () => { setOnline(true); if (backendRef.current) sync.syncNow(); };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const tick = setInterval(() => {
      if (!backendRef.current || !navigator.onLine || document.visibilityState !== 'visible') return;
      sync.syncNow();
    }, 120_000);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); clearInterval(tick); };
  }, [sync]);
  const debounce = useRef<any>();
  useEffect(() => {
    if (!backend || !outboxCount) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { if (navigator.onLine) sync.syncNow(); }, 2500);
  }, [outboxCount, backend, sync]);
  useEffect(() => { if (backend && navigator.onLine) sync.syncNow(); }, [backend, sync]);

  // Notificaciones del navegador (solo con la app abierta o en segundo plano reciente; ver documentación).
  useEffect(() => {
    if (!notifSettings.browser || typeof Notification === 'undefined') return;
    const check = async () => {
      if (Notification.permission !== 'granted' || inQuietHours(notifSettings)) return;
      const [events, tasks, payments] = await Promise.all([repo.list('events'), repo.list('tasks'), repo.list('payments')]);
      const list = buildNotifications({ events, tasks, payments, profile, settings: notifSettings, financeVisible: canFn(profile, 'finance.view', permissions), sync: { pending: 0, errors: 0, conflicts: 0, configured: false } });
      for (const n of list.filter((x) => x.severity !== 'info' || x.kind === 'evento')) {
        const st = await repo.db.notifState.get(n.key);
        if (st?.notifiedAt || st?.dismissed) continue;
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) await reg.showNotification(n.title, { body: n.detail, tag: n.key, data: { link: n.link }, icon: './icons/icon-192.png' });
        else new Notification(n.title, { body: n.detail, tag: n.key });
        await repo.db.notifState.put({ key: n.key, read: st?.read ?? false, dismissed: false, notifiedAt: nowISO() });
      }
    };
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, [notifSettings, repo, profile, permissions]);

  const value: AppCtx = {
    repo, sync, profiles, profile,
    setProfileId: (id) => { setCurrentId(id); repo.db.setKV('currentProfileId', id); },
    requestProfile: (p) => { if (p.pinHash && p.id !== currentId) setPinRequest(p); else { setCurrentId(p.id); repo.db.setKV('currentProfileId', p.id); } },
    pinRequest, clearPinRequest: () => setPinRequest(null),
    configRows, categories: (m) => categoriesFrom(configRows, m), permissions, notifSettings,
    can: (c) => canFn(profile, c, permissions), toast, toasts, dismissToast, run, syncStatus, online, backend,
    setBackend: async (b) => { await repo.db.setKV('backend', b); backendRef.current = b; setBackendState(b); },
    ai, setAI: async (s) => { await repo.db.setKV('aiSettings', s); setAiState(s); },
    prefs, setPrefs: async (p) => { const n = { ...prefs, ...p }; await repo.db.setKV('prefs', n); setPrefsState(n); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Atajo para consultas reactivas sobre IndexedDB. */
export function useLive<T>(fn: (repo: Repo) => Promise<T> | T, deps: any[], initial: T): T {
  const { repo } = useApp();
  return useLiveQuery(() => fn(repo), [repo, ...deps], initial) ?? initial;
}
