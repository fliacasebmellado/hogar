import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, Type, Camera, Mic, ShoppingCart, Inbox, CheckSquare, CalendarDays, Wallet, Wrench, FileText, Users, Settings2, Building2 } from 'lucide-react';
import { useApp, useLive } from '../../app/context';
import type { CalendarEvent, Capture, InvestmentTax, Payment, Profile, Repair, ShoppingItem, Task } from '../../domain/types';
import { addDays, diffDays, formatDate, formatDateTimeHuman, relativeDay, today } from '../../domain/dates';
import { expandEvents } from '../../services/events';
import { effectivePaymentStatus, formatMoney, upcomingPayments } from '../../domain/finance';
import { buildNotifications } from '../../services/notifications';
import { DEFAULT_HOME_BLOCKS } from '../../services/seed';
import { completeTask, reopenTask } from '../../services/tasks';
import { Avatar, Banner, ProfileStrip, StatusChip } from '../../ui/components';
import { EventCard, TaskCard, eventPeople } from '../../ui/Cards';
import { MODULE_COLOR, tones, type ModuleId } from '../../ui/theme';
import { TaskSheet } from '../tasks/TaskSheet';
import { EventSheet } from '../agenda/EventSheet';
import { AskSheet } from '../shopping/AskSheet';

export const HOME_BLOCK_LABEL: Record<string, string> = {
  agenda: 'Agenda', tareas: 'Tareas', pagos: 'Pagos próximos', compras: 'Compras pendientes', casa: 'Casa y mantenimiento',
  recordatorios: 'Recordatorios', responsabilidades: 'Responsabilidades', bandeja: 'Bandeja de entrada',
};

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
function greeting() {
  const h = new Date().getHours();
  return h < 6 ? 'Buenas noches' : h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
}

/** Qué ve cada perfil: Familia ve todo; cada persona, lo suyo (y lo de la casa sin responsable). */
export function scopeFor(profile?: Profile) {
  const all = !profile || profile.role === 'family';
  return (ids: (string | undefined)[], householdIfEmpty = false) => {
    if (all) return true;
    const clean = ids.filter(Boolean) as string[];
    if (!clean.length) return householdIfEmpty && profile!.role === 'adult';
    return clean.includes(profile!.id);
  };
}

function QuickCircle({ to, label, Icon, color, onClick }: { to?: string; label: string; Icon: any; color: ModuleId; onClick?: () => void }) {
  const t = tones(MODULE_COLOR[color]);
  const inner = <><span className="circle" style={{ background: t.base, color: t.on }}><Icon size={24} strokeWidth={2.2} /></span><span className="lbl">{label}</span></>;
  return to ? <Link to={to}>{inner}</Link> : <button type="button" onClick={onClick}>{inner}</button>;
}

function Tile({ to, label, meta, Icon, color, badge, alert }: { to: string; label: string; meta: string; Icon: any; color: ModuleId; badge?: number; alert?: boolean }) {
  const t = tones(MODULE_COLOR[color]);
  return (
    <Link to={to} className="tile" aria-label={`${label}: ${meta}`} style={{ background: t.base, color: t.on }}>
      <span className="tile-icon" style={{ color: t.ink }}><Icon size={24} strokeWidth={2.2} /></span>
      <span className="tile-label">{label}</span>
      <span className="tile-meta">{meta}</span>
      {!!badge && <span className={`tile-badge${alert ? ' alert' : ''}`} style={alert ? undefined : { background: t.ink, color: '#fff' }}>{badge}</span>}
    </Link>
  );
}

function InvTile({ taxes }: { taxes: InvestmentTax[] }) {
  const pend = taxes.filter((t) => t.status !== 'pagado');
  const late = pend.filter((t) => t.dueDate && t.dueDate < today()).length;
  return <Tile to="/inversiones" label="Inversiones" meta={pend.length ? pl(pend.length, 'impuesto pendiente', 'impuestos pendientes') : 'Al día'} Icon={Building2} color="inversiones" badge={late || pend.length} alert={late > 0} />;
}

export default function Home() {
  const { repo, profile, profiles, can, syncStatus, backend, notifSettings, requestProfile, run } = useApp();
  const nav = useNavigate();
  const [task, setTask] = useState<Task | undefined>();
  const [event, setEvent] = useState<CalendarEvent | undefined>();
  const [ask, setAsk] = useState(false);
  const d = useLive(async (r) => {
    const [events, tasks, payments, items, repairs, invTaxes, captures] = await Promise.all([
      r.list('events'), r.list('tasks'), r.list('payments'), r.list('shoppingItems'), r.list('repairs'), r.list('investmentTaxes'),
      r.db.entity('captures').where('status').anyOf('pendiente', 'en_revision').toArray(),
    ]);
    return { events, tasks, payments, items, repairs, invTaxes, captures: captures.filter((c) => !c.deleted) };
  }, [], { events: [] as CalendarEvent[], tasks: [] as Task[], payments: [] as Payment[], items: [] as ShoppingItem[], repairs: [] as Repair[], invTaxes: [] as InvestmentTax[], captures: [] as Capture[] });

  const t0 = today();
  const isChild = profile?.role === 'child';
  const isFamily = profile?.role === 'family';
  const inScope = scopeFor(profile);
  const agenda = useMemo(() => expandEvents(d.events.filter((e) => inScope(eventPeople(e), true)), t0, addDays(t0, 3)), [d.events, profile?.id]);
  const todayEvents = agenda.filter((i) => i.date === t0);
  const nextEvents = agenda.filter((i) => i.date > t0);
  const openTasks = d.tasks.filter((t) => !t.isSeries && t.status !== 'completada' && inScope([t.assigneeId, ...(t.collaboratorIds ?? [])], true));
  const overdue = openTasks.filter((t) => t.dueDate && t.dueDate < t0);
  const focusTasks = openTasks.filter((t) => (t.dueDate && t.dueDate <= t0) || t.priority === 'alta').sort((a, b) => ((a.dueDate ?? '9') < (b.dueDate ?? '9') ? -1 : 1));
  const pendingItems = d.items.filter((i) => i.status === 'pendiente' && !i.mergedInto);
  const myRequests = pendingItems.filter((i) => i.requestedBy === profile?.id);
  const dues = upcomingPayments(d.payments, 7);
  const dueAlert = dues.filter((p) => effectivePaymentStatus(p) === 'vencido').length;
  const openRepairs = d.repairs.filter((r) => r.status !== 'resuelta');
  const maintSoon = d.tasks.filter((t) => t.maintenanceId && t.status !== 'completada' && t.dueDate && diffDays(t.dueDate, t0) <= 7);
  const notifs = buildNotifications({ events: d.events, tasks: d.tasks, payments: d.payments, profile, settings: notifSettings, financeVisible: can('finance.view'), sync: { pending: syncStatus?.pending ?? 0, errors: syncStatus?.errors ?? 0, conflicts: syncStatus?.conflicts ?? 0, configured: !!backend } });
  const blocks = (profile?.prefs?.homeBlocks ?? DEFAULT_HOME_BLOCKS).filter((b) => (b !== 'pagos' || can('finance.view')) && !(isChild && (b === 'casa' || b === 'responsabilidades')));
  const toggleTask = (t: Task) => run<unknown>(() => (t.status === 'completada' ? reopenTask(repo, t.id, profile?.id) : completeTask(repo, t.id, profile?.id)), t.status === 'completada' ? 'Tarea reabierta' : '¡Tarea completada!');

  const render: Record<string, () => JSX.Element | null> = {
    agenda: () => (
      <section key="agenda" aria-labelledby="h-hoy">
        <div className="section-head"><h2 id="h-hoy">Hoy <span className="count">{capFirst(formatDate(t0, { weekday: true }))}</span></h2><Link to="/agenda">Ver agenda</Link></div>
        {todayEvents.length ? <div className="cards">{todayEvents.map((i, n) => <EventCard key={n} i={i} profiles={profiles} onOpen={setEvent} />)}</div>
          : <p className="muted small">No hay eventos hoy.</p>}
        {nextEvents.length > 0 && <>
          <div className="next-divider">PRÓXIMOS DÍAS</div>
          <div className="cards">{nextEvents.slice(0, 4).map((i, n) => <EventCard key={n} i={i} profiles={profiles} onOpen={setEvent} showDay />)}</div>
        </>}
      </section>
    ),
    tareas: () => (
      <section key="tareas" aria-labelledby="h-tareas">
        <div className="section-head"><h2 id="h-tareas">{isChild ? 'Mis tareas' : isFamily ? 'Tareas de la familia' : 'Mis tareas'} <span className="count">{pl(openTasks.length, 'abierta', 'abiertas')}</span></h2><Link to="/tareas">Ver todas</Link></div>
        {focusTasks.length ? <div className="cards">{focusTasks.slice(0, 6).map((t) => <TaskCard key={t.id} t={t} profiles={profiles} onOpen={setTask} onToggle={toggleTask} />)}</div>
          : <p className="muted small">Nada pendiente para hoy{openTasks.length ? ` · ${openTasks.length} para más adelante` : ''}. 🎉</p>}
      </section>
    ),
    pagos: () => (
      <section key="pagos" aria-labelledby="h-pagos">
        <div className="section-head"><h2 id="h-pagos">Pagos que vencen <span className="count">próximos 7 días</span></h2><Link to="/economia">Economía</Link></div>
        {dues.length ? <div className="card"><ul className="list">{dues.slice(0, 5).map((p) => {
          const st = effectivePaymentStatus(p);
          return <li key={p.id}><Link className="item" to={`/economia?pago=${p.id}`}><div className="item-main"><div className="item-title">{p.concept}</div><div className="item-sub">{st === 'vencido' ? 'Vencido' : `Vence ${relativeDay(p.dueDate!).toLowerCase()}`}</div></div><div style={{ textAlign: 'right' }}><div className="strong">{formatMoney(p.amount, p.currency)}</div>{st === 'vencido' && <StatusChip tone="alert">Vencido</StatusChip>}</div></Link></li>;
        })}</ul></div> : <p className="muted small">Sin vencimientos en los próximos 7 días.</p>}
      </section>
    ),
    compras: () => (
      <section key="compras" aria-labelledby="h-compras">
        <div className="section-head"><h2 id="h-compras">Compras <span className="count">{pl(pendingItems.length, 'pendiente', 'pendientes')}</span></h2><Link to="/compras">Ver lista</Link></div>
        {pendingItems.length ? <div className="row-wrap">{pendingItems.slice(0, 10).map((i) => <span key={i.id} className="chip" style={{ fontSize: '0.8rem', padding: '4px 10px' }}>{i.name}</span>)}{pendingItems.length > 10 && <span className="muted small">+{pendingItems.length - 10}</span>}</div>
          : <p className="muted small">La lista está vacía.</p>}
      </section>
    ),
    casa: () => (openRepairs.length || maintSoon.length) ? (
      <section key="casa" aria-labelledby="h-casa">
        <div className="section-head"><h2 id="h-casa">Casa <span className="count">{pl(openRepairs.length, 'reparación abierta', 'reparaciones abiertas')}</span></h2><Link to="/casa">Ver</Link></div>
        <div className="card"><ul className="list">
          {openRepairs.slice(0, 3).map((r) => <li key={r.id}><Link className="item" to={`/casa?reparacion=${r.id}`}><span className="cat-ico">🔧</span><div className="item-main"><div className="item-title">{r.title}</div><div className="item-sub">Reparación · desde {formatDate(r.reportedAt)}</div></div><StatusChip tone="warn">{r.status === 'en_curso' ? 'En curso' : 'Pendiente'}</StatusChip></Link></li>)}
          {maintSoon.slice(0, 3).map((t) => <li key={t.id}><Link className="item" to={`/tareas?id=${t.id}`}><span className="cat-ico">🗓️</span><div className="item-main"><div className="item-title">{t.title}</div><div className="item-sub">Mantenimiento · {relativeDay(t.dueDate!)}</div></div></Link></li>)}
        </ul></div>
      </section>
    ) : null,
    recordatorios: () => notifs.length ? (
      <section key="recordatorios" aria-labelledby="h-rec">
        <div className="section-head"><h2 id="h-rec">Recordatorios</h2><Link to="/notificaciones">Avisos</Link></div>
        <div className="stack-sm">{notifs.slice(0, 3).map((n) => <Banner key={n.key} tone={n.severity === 'alert' ? 'alert' : n.severity === 'warn' ? 'warn' : 'info'}><Link to={n.link} style={{ textDecoration: 'none' }}><strong>{n.title}</strong> · {n.detail}</Link></Banner>)}</div>
      </section>
    ) : null,
    responsabilidades: () => (
      <section key="responsabilidades" aria-labelledby="h-resp">
        <details className="fold">
        <summary className="section-head">
          <h2 id="h-resp">Responsabilidades <span className="count">{pl(d.tasks.filter((t) => !t.isSeries && t.status !== 'completada' && t.assigneeId).length, 'tarea abierta', 'tareas abiertas')}</span></h2>
          <ChevronDown className="fold-chevron" size={20} aria-hidden="true" />
        </summary>
        <div className="card"><ul className="list">{profiles.filter((p) => p.active && p.role !== 'family').map((p) => {
          const open = d.tasks.filter((t) => !t.isSeries && t.status !== 'completada' && t.assigneeId === p.id);
          const late = open.filter((t) => t.dueDate && t.dueDate < t0).length;
          return <li key={p.id}><Link className="item" to="/familia"><Avatar profile={p} /><div className="item-main"><div className="item-title">{p.name}</div><div className="item-sub">{pl(open.length, 'tarea abierta', 'tareas abiertas')}</div></div>{late > 0 && <StatusChip tone="alert">{late} atrasada(s)</StatusChip>}</Link></li>;
        })}</ul></div>
        <Link to="/familia" className="fold-link">Ver familia</Link>
        </details>
      </section>
    ),
    bandeja: () => d.captures.length ? (
      <section key="bandeja" style={{ marginTop: 16 }}>
        <Banner tone="info"><Link to="/asistente">Tenés <strong>{d.captures.length}</strong> captura(s) por revisar en la bandeja de entrada.</Link></Banner>
      </section>
    ) : null,
  };

  return (
    <div>
      <header className="hero">
        <div className="hello">{isFamily ? '¡Hola, familia!' : `¡Hola, ${profile?.name}!`}</div>
        <div className="date">{greeting()} · {capFirst(formatDate(t0, { weekday: true }))}</div>
        {/* En perfiles infantiles no se muestra: el cambio de perfil va por el menú del avatar (con PIN si lo tiene). */}
        {!isChild && <ProfileStrip profiles={profiles} currentId={profile?.id} onPick={requestProfile} />}
        <div className="sync-line">
          {!backend ? <>Datos solo en este dispositivo · <Link to="/ajustes/integraciones">Conectar con Google</Link></>
            : syncStatus?.pending ? `${syncStatus.pending} cambio(s) sin enviar a Google` : `Todo sincronizado${syncStatus?.lastSyncAt ? ` · ${formatDateTimeHuman(syncStatus.lastSyncAt).slice(11)}` : ''}`}
        </div>
      </header>

      <div className="quick-round" role="group" aria-label="Captura rápida">
        <QuickCircle to="/asistente?modo=texto" label="Escribir" Icon={Type} color="asistente" />
        <QuickCircle to="/asistente?modo=foto" label="Foto" Icon={Camera} color="agenda" />
        <QuickCircle to="/asistente?modo=voz" label="Voz" Icon={Mic} color="familia" />
        {isChild ? <QuickCircle label="Pedir algo" Icon={ShoppingCart} color="compras" onClick={() => setAsk(true)} />
          : <QuickCircle to="/compras" label="Compras" Icon={ShoppingCart} color="compras" />}
      </div>

      {isChild && (
        <button type="button" className="ask-card" onClick={() => setAsk(true)}>
          <span className="big" aria-hidden="true">🎒</span>
          <span><strong>¿Necesitás algo?</strong><span className="sub">Pedí lo del colegio o lo que necesites. {myRequests.length ? `Tenés ${pl(myRequests.length, 'pedido', 'pedidos')} en la lista.` : ''}</span></span>
        </button>
      )}

      <div className="section-head"><span className="eyebrow">Secciones</span></div>
      <nav className="tiles" aria-label="Secciones">
        <Tile to="/agenda" label="Agenda" meta={todayEvents.length ? `${pl(todayEvents.length, 'evento', 'eventos')} hoy` : 'Nada hoy'} Icon={CalendarDays} color="agenda" badge={todayEvents.length} />
        <Tile to="/tareas" label="Tareas" meta={overdue.length ? pl(overdue.length, 'atrasada', 'atrasadas') : pl(openTasks.length, 'abierta', 'abiertas')} Icon={CheckSquare} color="tareas" badge={overdue.length || openTasks.length} alert={overdue.length > 0} />
        <Tile to="/compras" label="Compras" meta={`${pendingItems.length} en la lista`} Icon={ShoppingCart} color="compras" badge={pendingItems.length} />
        {can('finance.view') && <Tile to="/economia" label="Economía" meta={dues.length ? `${dues.length} por vencer` : 'Al día'} Icon={Wallet} color="economia" badge={dues.length} alert={dueAlert > 0} />}
        {can('finance.view') && <InvTile taxes={d.invTaxes} />}
        {!isChild && <Tile to="/casa" label="Casa" meta={openRepairs.length ? pl(openRepairs.length, 'reparación', 'reparaciones') : 'Todo en orden'} Icon={Wrench} color="casa" badge={openRepairs.length} />}
        <Tile to="/documentos" label="Documentos" meta="Archivo" Icon={FileText} color="documentos" />
        <Tile to="/familia" label="Familia" meta="Perfiles" Icon={Users} color="familia" />
        <Tile to="/asistente" label="Bandeja" meta={d.captures.length ? `${d.captures.length} por revisar` : 'Al día'} Icon={Inbox} color="asistente" badge={d.captures.length} />
      </nav>

      {blocks.map((b) => render[b]?.())}
      <p className="muted tiny" style={{ marginTop: 18 }}><Link to="/familia"><Settings2 size={12} /> Configurar qué se ve en Inicio</Link></p>
      <TaskSheet open={!!task} task={task} onClose={() => setTask(undefined)} />
      <EventSheet open={!!event} event={event} onClose={() => setEvent(undefined)} />
      <AskSheet open={ask} onClose={() => setAsk(false)} onDone={() => nav('/compras')} />
    </div>
  );
}
