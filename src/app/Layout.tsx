import { Suspense, useState, type ReactNode } from 'react';
import { ErrorBoundary, Loading } from '../ui/Boundary';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  Home, CalendarDays, CheckSquare, ShoppingCart, Wallet, Wrench, Users, FileText, Inbox, Settings, Search, Bell, Plus,
  Cloud, CloudOff, RefreshCw, HardDrive, AlertTriangle, Menu, Building2,
} from 'lucide-react';
import { useApp, useLive } from './context';
import { Avatar } from '../ui/components';
import { Sheet } from '../ui/Sheet';
import { canOpenModule, hashPin, type ModuleKey } from '../domain/permissions';
import type { Profile } from '../domain/types';
import { buildNotifications } from '../services/notifications';
import { MODULE_COLOR, tones, type ModuleId } from '../ui/theme';

export const NAV: { key: ModuleKey; to: string; label: string; icon: any; color: ModuleId; desc: string }[] = [
  { key: 'inicio', to: '/', label: 'Inicio', icon: Home, color: 'familia', desc: 'Resumen del día' },
  { key: 'agenda', to: '/agenda', label: 'Agenda', icon: CalendarDays, color: 'agenda', desc: 'Eventos, turnos y cumpleaños' },
  { key: 'tareas', to: '/tareas', label: 'Tareas', icon: CheckSquare, color: 'tareas', desc: 'Pendientes y responsabilidades' },
  { key: 'compras', to: '/compras', label: 'Compras', icon: ShoppingCart, color: 'compras', desc: 'Listas compartidas y pedidos' },
  { key: 'economia', to: '/economia', label: 'Economía', icon: Wallet, color: 'economia', desc: 'Pagos, gastos y reportes' },
  { key: 'inversiones', to: '/inversiones', label: 'Inversiones', icon: Building2, color: 'inversiones', desc: 'Propiedades, contratos e impuestos' },
  { key: 'casa', to: '/casa', label: 'Casa', icon: Wrench, color: 'casa', desc: 'Reparaciones y mantenimiento' },
  { key: 'familia', to: '/familia', label: 'Familia', icon: Users, color: 'familia', desc: 'Perfiles de cada integrante' },
  { key: 'documentos', to: '/documentos', label: 'Documentos', icon: FileText, color: 'documentos', desc: 'Archivo central' },
  { key: 'asistente', to: '/asistente', label: 'Asistente', icon: Inbox, color: 'asistente', desc: 'Capturas y bandeja de entrada' },
  { key: 'ajustes', to: '/ajustes', label: 'Ajustes', icon: Settings, color: 'ajustes', desc: 'Google, copias y preferencias' },
];

export function ModuleIcon({ color, Icon, size = 20, box = 40 }: { color: ModuleId; Icon: any; size?: number; box?: number }) {
  const t = tones(MODULE_COLOR[color]);
  return <span className="mi" style={{ background: t.tint, color: t.ink, width: box, height: box }} aria-hidden="true"><Icon size={size} strokeWidth={2.2} /></span>;
}

const TITLES: Record<string, string> = {
  '/': 'Inicio', '/agenda': 'Agenda', '/tareas': 'Tareas', '/compras': 'Compras', '/economia': 'Economía',
  '/casa': 'Casa', '/inversiones': 'Inversiones', '/familia': 'Familia', '/documentos': 'Documentos', '/asistente': 'Asistente',
  '/ajustes': 'Ajustes', '/buscar': 'Buscar', '/notificaciones': 'Avisos',
};

export function Layout({ updateBar }: { updateBar?: ReactNode }) {
  const { profile, profiles, online, toasts, dismissToast, permissions } = useApp();
  const loc = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const base = '/' + (loc.pathname.split('/')[1] ?? '');
  const title = TITLES[base] ?? 'Hogar';
  const visible = NAV.filter((n) => canOpenModule(profile, n.key, permissions));
  const navItem = (key: ModuleKey) => visible.find((n) => n.key === key);

  if (!profile) return <ProfileGate profiles={profiles} />;

  return (
    <div className="app">
      <a href="#contenido" className="skip-link">Saltar al contenido</a>
      <nav className="sidebar" aria-label="Secciones">
        <div className="brand"><Home size={20} /> Hogar</div>
        {visible.map((n) => (
          <NavLink key={n.key} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <ModuleIcon color={n.color} Icon={n.icon} size={16} box={30} /> {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label="Menú: todas las secciones" aria-haspopup="dialog"><Menu size={22} /></button>
          <h1>{title}</h1>
          <SyncPill />
          <Link to="/buscar" className="icon-btn" aria-label="Buscar"><Search size={20} /></Link>
          <NotifBell />
          <button className="icon-btn" onClick={() => setPickerOpen(true)} aria-label={`Perfil: ${profile.name}. Cambiar de perfil`}>
            <Avatar profile={profile} />
          </button>
        </header>
        {!online && <div className="offline-bar" role="status">Sin conexión: los cambios se guardan en este dispositivo y se sincronizarán al volver la conexión.</div>}
        {updateBar}
        <main id="contenido" className="content" tabIndex={-1}>
          <ErrorBoundary key={loc.pathname}><Suspense fallback={<Loading />}><Outlet /></Suspense></ErrorBoundary>
        </main>
      </div>
      <nav className="bottomnav" aria-label="Navegación principal">
        {(['inicio', 'agenda'] as ModuleKey[]).map((k) => navItem(k)).filter((n): n is (typeof NAV)[number] => !!n).map((n) => (
          <NavLink key={n.key} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <n.icon size={22} /> {n.label}
          </NavLink>
        ))}
        <Link to="/asistente" className="nav-capture" aria-label="Capturar: agregar algo con texto, foto o voz">
          <span className="bubble"><Plus size={28} strokeWidth={2.6} /></span><span>Capturar</span>
        </Link>
        {(['tareas', 'compras'] as ModuleKey[]).map((k) => navItem(k)).filter((n): n is (typeof NAV)[number] => !!n).map((n) => (
          <NavLink key={n.key} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>
            <n.icon size={22} /> {n.label}
          </NavLink>
        ))}
      </nav>
      {loc.pathname !== '/asistente' && (
        <Link to="/asistente" className="fab" aria-label="Capturar: agregar algo con texto, foto o voz"><Plus size={24} /><span>Capturar</span></Link>
      )}
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Todas las secciones">
        <nav className="menu-list" aria-label="Todas las secciones">
          {visible.map((n) => (
            <Link key={n.key} to={n.to} onClick={() => setMenuOpen(false)}>
              <ModuleIcon color={n.color} Icon={n.icon} />
              <span>{n.label}<span className="msub">{n.desc}</span></span>
            </Link>
          ))}
          <Link to="/notificaciones" onClick={() => setMenuOpen(false)}><ModuleIcon color="avisos" Icon={Bell} /><span>Avisos<span className="msub">Vencimientos y recordatorios</span></span></Link>
          <Link to="/buscar" onClick={() => setMenuOpen(false)}><ModuleIcon color="ajustes" Icon={Search} /><span>Buscar<span className="msub">En toda la app</span></span></Link>
        </nav>
      </Sheet>
      <ProfilePicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
      <PinSheet />
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.tone === 'error' ? ' error' : ''}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            <span style={{ flex: 1 }}>{t.message}</span>
            {t.action && <button onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SyncPill() {
  const { syncStatus: s, sync, backend, online } = useApp();
  const nav = useNavigate();
  if (!s) return null;
  let cls = 'sync-pill', label = '', short = '', Icon = Cloud;
  if (!backend) { label = 'Solo local'; short = 'Local'; Icon = HardDrive; }
  else if (s.conflicts) { cls += ' error'; label = `${s.conflicts} conflicto${s.conflicts > 1 ? 's' : ''}`; short = '!'; Icon = AlertTriangle; }
  else if (s.errors) { cls += ' error'; label = `${s.errors} con error`; short = '!'; Icon = AlertTriangle; }
  else if (!online) { cls += ' pending'; label = s.pending ? `${s.pending} sin enviar` : 'Sin conexión'; short = s.pending ? String(s.pending) : ''; Icon = CloudOff; }
  else if (s.running) { label = 'Sincronizando…'; short = ''; Icon = RefreshCw; }
  else if (s.pending) { cls += ' pending'; label = `${s.pending} sin enviar`; short = String(s.pending); Icon = RefreshCw; }
  else { cls += ' ok'; label = 'Al día'; short = '✓'; }
  return (
    <button className={cls} onClick={() => (backend && online && !s.running ? sync.syncNow() : nav('/ajustes/sincronizacion'))}
      title={backend ? 'Estado de sincronización con Google. Tocá para sincronizar.' : 'Google no está conectado: los datos viven solo en este dispositivo.'}>
      <Icon size={13} className={s.running ? 'spin' : ''} /> <span className="pill-long">{label}</span><span className="pill-short" aria-hidden="true">{short}</span><span className="sr-only">{label}</span>
    </button>
  );
}

function NotifBell() {
  const { profile, notifSettings, can, syncStatus, backend } = useApp();
  const list = useLive(async (repo) => {
    const [events, tasks, payments, states, investments, investmentTaxes, investmentContracts, documents] = await Promise.all([repo.list('events'), repo.list('tasks'), repo.list('payments'), repo.db.notifState.toArray(), repo.list('investments'), repo.list('investmentTaxes'), repo.list('investmentContracts'), repo.list('documents')]);
    const all = buildNotifications({ events, tasks, payments, investments, investmentTaxes, investmentContracts, documents, profile, settings: notifSettings, financeVisible: can('finance.view'), sync: { pending: syncStatus?.pending ?? 0, errors: syncStatus?.errors ?? 0, conflicts: syncStatus?.conflicts ?? 0, configured: !!backend } });
    return all.filter((n) => !states.find((s) => s.key === n.key && (s.read || s.dismissed)));
  }, [profile?.id, notifSettings, syncStatus], []);
  return (
    <Link to="/notificaciones" className="icon-btn" aria-label={`Avisos${list.length ? `: ${list.length} sin leer` : ''}`}>
      <Bell size={20} />{list.length > 0 && <span className="dot" />}
    </Link>
  );
}

function ProfileGate({ profiles }: { profiles: Profile[] }) {
  return (
    <main className="content" style={{ maxWidth: 520, paddingTop: 40 }}>
      <h1 style={{ marginBottom: 6 }}>¿Quién usa Hogar ahora?</h1>
      <p className="muted" style={{ marginBottom: 18 }}>Elegí tu perfil. El perfil organiza lo que ves; no reemplaza una contraseña.</p>
      <ProfileList profiles={profiles} />
    </main>
  );
}

function ProfileList({ profiles, onDone }: { profiles: Profile[]; onDone?: () => void }) {
  const { setProfileId, toast, profile: current } = useApp();
  const [pinFor, setPinFor] = useState<Profile | null>(null);
  const [pin, setPin] = useState('');
  const choose = (p: Profile) => {
    if (p.pinHash && p.id !== current?.id) { setPinFor(p); setPin(''); return; }
    setProfileId(p.id); onDone?.();
  };
  const verify = async () => {
    if (!pinFor) return;
    if ((await hashPin(pin, pinFor.id)) === pinFor.pinHash) { setProfileId(pinFor.id); setPinFor(null); onDone?.(); }
    else toast('PIN incorrecto.', { tone: 'error' });
  };
  if (pinFor) {
    return (
      <form className="form" onSubmit={(e) => { e.preventDefault(); verify(); }}>
        <p>Ingresá el PIN de {pinFor.name}.</p>
        <input className="input" type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} aria-label="PIN" />
        <div className="row"><button type="button" className="btn" onClick={() => setPinFor(null)}>Volver</button><button className="btn btn-primary">Entrar</button></div>
      </form>
    );
  }
  return (
    <div className="card"><ul className="list">
      {profiles.filter((p) => p.active).map((p) => (
        <li key={p.id}>
          <button className="item" onClick={() => choose(p)} aria-current={current?.id === p.id}>
            <Avatar profile={p} large />
            <div className="item-main"><div className="item-title">{p.name}</div><div className="item-sub">{p.role === 'adult' ? 'Adulto' : p.role === 'family' ? 'Todos juntos: lo de toda la familia' : 'Chico/a'}{p.pinHash ? ' · con PIN' : ''}</div></div>
            {current?.id === p.id && <span className="chip chip-ok">Actual</span>}
          </button>
        </li>
      ))}
    </ul></div>
  );
}

function ProfilePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profiles } = useApp();
  return (
    <Sheet open={open} onClose={onClose} title="Cambiar de perfil">
      <ProfileList profiles={profiles} onDone={onClose} />
      <p className="muted small" style={{ marginTop: 12 }}>
        El selector de perfil organiza la información; no es una barrera de seguridad. Cualquiera con este dispositivo puede cambiar de perfil (el PIN solo disuade).
      </p>
    </Sheet>
  );
}

/** PIN pedido desde cualquier lugar (por ejemplo, la fila de perfiles de Inicio). */
function PinSheet() {
  const { pinRequest, clearPinRequest, setProfileId, toast } = useApp();
  const [pin, setPin] = useState('');
  const verify = async () => {
    if (!pinRequest) return;
    if ((await hashPin(pin, pinRequest.id)) === pinRequest.pinHash) { setProfileId(pinRequest.id); setPin(''); clearPinRequest(); }
    else toast('PIN incorrecto.', { tone: 'error' });
  };
  return (
    <Sheet open={!!pinRequest} onClose={() => { setPin(''); clearPinRequest(); }} title={`PIN de ${pinRequest?.name ?? ''}`}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); verify(); }}>
        <input className="input" type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} aria-label="PIN" />
        <button className="btn btn-primary">Entrar</button>
      </form>
    </Sheet>
  );
}
