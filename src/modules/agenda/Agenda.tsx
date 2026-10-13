import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, CalendarDays, Repeat, MapPin, LayoutGrid } from 'lucide-react';
import { useApp, useLive } from '../../app/context';
import type { CalendarEvent } from '../../domain/types';
import { expandEvents, filterEvents, instanceDays, type EventInstance } from '../../services/events';
import { addDays, addMonths, diffDays, formatDate, MONTHS_ES, parseISODate, startOfMonth, startOfWeek, today, WEEKDAYS_ES, relativeDay } from '../../domain/dates';
import { AvatarStack, ChipFilter, Empty, PersonFilter, Segmented, StatusChip, SyncMark } from '../../ui/components';
import { colorFor, eventPeople, whoLabel } from '../../ui/Cards';
import { categoryIcon, tones } from '../../ui/theme';
import { EventSheet } from './EventSheet';

type View = 'mes' | 'semana';

/** Fila compacta (se usa en listas fuera de la agenda). */
export function EventItem({ i, onOpen, showDate }: { i: EventInstance; onOpen: (e: CalendarEvent) => void; showDate?: boolean }) {
  const { profiles, categories, backend } = useApp();
  const e = i.event;
  const cat = categories('events').find((c) => c.id === e.category);
  return (
    <li>
      <button className="item" onClick={() => onOpen(e)}>
        <span className="cat-ico" aria-hidden="true">{categoryIcon('events', e.category)}</span>
        <div className="item-main">
          <div className="item-title">{e.title}</div>
          <div className="item-sub">
            <span className="strong" style={{ color: 'var(--text-2)' }}>{showDate ? `${relativeDay(i.date)} · ` : ''}{e.allDay ? 'Todo el día' : i.start.slice(11, 16)}</span>
            {cat && <span>{cat.label}</span>}
            {e.location && <span><MapPin size={12} /> {e.location}</span>}
            {e.recurrence && <Repeat size={12} aria-label="Se repite" />}
            {e.rsvp === 'confirmado' && <StatusChip tone="ok">Confirmado</StatusChip>}
            <SyncMark state={e._sync} configured={!!backend} />
          </div>
        </div>
        <AvatarStack ids={e.participantIds ?? []} profiles={profiles} />
      </button>
    </li>
  );
}

export default function Agenda() {
  const { profile, profiles, categories, can } = useApp();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>('mes');
  const [cursor, setCursor] = useState(today());
  // Cada persona ve su agenda (y lo de la casa sin responsable); el perfil Familia ve lo de todos.
  const [person, setPerson] = useState(profile && profile.role !== 'family' ? profile.id : '');
  const [cat, setCat] = useState('');
  const [editing, setEditing] = useState<CalendarEvent | null | undefined>(undefined);
  const events = useLive((r) => r.list('events'), [], [] as CalendarEvent[]);

  useEffect(() => {
    const id = params.get('id');
    if (id && events.length) { const e = events.find((x) => x.id === id); if (e) { setEditing(e); setCursor(e.start.slice(0, 10)); } }
  }, [params, events.length]);

  const filtered = useMemo(() => filterEvents(events, { category: cat || undefined }).filter((e) => {
    if (!person) return true;
    const ppl = eventPeople(e);
    return ppl.length === 0 || ppl.includes(person) || e.ownerId === person;
  }), [events, person, cat]);
  const monthStart = startOfMonth(cursor);
  const gridFrom = startOfWeek(monthStart);
  const weekStart = startOfWeek(cursor);
  const range = useMemo(() => (view === 'mes' ? { from: gridFrom, to: addDays(gridFrom, 41) } : { from: weekStart, to: addDays(weekStart, 13) }), [view, gridFrom, weekStart]);
  // Además del rango visible se calculan los próximos 14 días para la lista "Lo que viene".
  const instances = useMemo(() => expandEvents(filtered, range.from < cursor ? range.from : cursor, addDays(range.to > addDays(cursor, 14) ? range.to : addDays(cursor, 14), 0)), [filtered, range, cursor]);
  const byDay = useMemo(() => {
    const m: Record<string, EventInstance[]> = {};
    for (const i of instances) for (const d of instanceDays(i)) (m[d] ??= []).push(i);
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.event.allDay === b.event.allDay ? a.start.localeCompare(b.start) : a.event.allDay ? -1 : 1));
    return m;
  }, [instances]);

  const t0 = today();
  const close = () => { setEditing(undefined); if (params.get('id')) setParams({}, { replace: true }); };
  const dayColor = (list: EventInstance[]) => {
    const ids = [...new Set(list.flatMap((i) => eventPeople(i.event)))];
    return tones(colorFor(ids, profiles));
  };
  const [y, m] = cursor.split('-').map(Number);
  const isFamily = profile?.role === 'family';
  const upcomingDays = view === 'semana'
    ? Array.from({ length: 14 }, (_, k) => addDays(weekStart, k))
    : Array.from({ length: 14 }, (_, k) => addDays(cursor, k + 1)).filter((d) => (byDay[d] ?? []).length);

  return (
    <div className="agenda">
      <div className="row" style={{ marginBottom: 12 }}>
        <Segmented label="Vista" value={view} onChange={setView} options={[{ value: 'mes', label: 'Mes' }, { value: 'semana', label: 'Semana' }]} />
        <span className="spacer" />
        {can('events.edit') && <button className="btn btn-primary" onClick={() => setEditing(null)}><Plus size={18} /> Nuevo</button>}
      </div>

      {(isFamily || profile?.role === 'adult') && (
        <div className="stack-sm" style={{ marginBottom: 12 }}>
          <PersonFilter value={person} onChange={setPerson} profiles={profiles} label="Ver la agenda de" />
          <details className="more"><summary>Filtrar por categoría</summary>
            <ChipFilter label="Categoría" value={cat} onChange={setCat} options={categories('events').map((c) => ({ value: c.id, label: `${categoryIcon('events', c.id)} ${c.label}` }))} />
          </details>
        </div>
      )}

      {view === 'mes' && (
        <div className="cal-card">
          <div className="cal-head">
            <div>
              <div className="cal-month"><LayoutGrid size={20} aria-hidden="true" /> {MONTHS_ES[m - 1]}</div>
              <div className="cal-year">{y}</div>
            </div>
            <div className="row">
              <button className="icon-btn" onClick={() => setCursor(addMonths(monthStart, -1))} aria-label="Mes anterior"><ChevronLeft size={20} /></button>
              <button className="btn btn-sm" onClick={() => setCursor(t0)}>Hoy</button>
              <button className="icon-btn" onClick={() => setCursor(addMonths(monthStart, 1))} aria-label="Mes siguiente"><ChevronRight size={20} /></button>
            </div>
          </div>
          <div className="cal-round" role="grid" aria-label={`${MONTHS_ES[m - 1]} ${y}`}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => <div key={d} className="cal-dow" role="columnheader">{WEEKDAYS_ES[d].charAt(0).toUpperCase()}</div>)}
            {Array.from({ length: 42 }, (_, k) => addDays(gridFrom, k)).map((day) => {
              const list = byDay[day] ?? [];
              const other = day.slice(0, 7) !== cursor.slice(0, 7);
              const t = list.length ? dayColor(list) : null;
              return (
                <button key={day} role="gridcell" onClick={() => setCursor(day)}
                  className={`cal-dot-day${other ? ' other' : ''}${day === t0 ? ' today' : ''}${day === cursor ? ' selected' : ''}${list.length ? ' has' : ''}`}
                  style={t && day !== cursor ? { background: t.base, color: t.on } : undefined}
                  aria-label={`${formatDate(day, { weekday: true })}: ${list.length} evento(s)`} aria-selected={day === cursor}>
                  {parseISODate(day).getDate()}
                </button>
              );
            })}
          </div>
          <DayDetail day={cursor} items={byDay[cursor] ?? []} onOpen={setEditing} />
        </div>
      )}

      {view === 'semana' && (
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="icon-btn" onClick={() => setCursor(addDays(cursor, -7))} aria-label="Semana anterior"><ChevronLeft size={20} /></button>
          <h2 style={{ flex: 1, textAlign: 'center' }} aria-live="polite">{formatDate(weekStart)} al {formatDate(addDays(weekStart, 13))}</h2>
          <button className="icon-btn" onClick={() => setCursor(addDays(cursor, 7))} aria-label="Semana siguiente"><ChevronRight size={20} /></button>
          <button className="btn btn-sm" onClick={() => setCursor(t0)}>Hoy</button>
        </div>
      )}

      {(view === 'semana' || upcomingDays.length > 0) && (
        <section aria-label="Lo que viene" className="timeline">
          {view === 'mes' && <div className="eyebrow" style={{ margin: '22px 4px 10px' }}>Lo que viene</div>}
          {upcomingDays.map((day) => {
            const list = byDay[day] ?? [];
            const d = parseISODate(day);
            return (
              <div key={day} className={`tl-row${day === t0 ? ' today' : ''}`}>
                <div className="tl-day"><span className="tl-dow">{WEEKDAYS_ES[d.getDay()].slice(0, 3)}</span><span className="tl-num">{d.getDate()}</span></div>
                <div className="tl-events">
                  {list.length ? list.map((i, n) => <TimelineEvent key={i.event.id + n} i={i} onOpen={setEditing} />) : <div className="tl-free">Libre</div>}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {events.length === 0 && <div className="card" style={{ marginTop: 12 }}><Empty icon={<CalendarDays size={36} />} title="Todavía no hay eventos en la agenda." action={can('events.edit') ? <button className="btn" onClick={() => setEditing(null)}>Agregar evento</button> : undefined} /></div>}
      <EventSheet open={editing !== undefined} event={editing ?? null} onClose={close} defaultDate={cursor} />
    </div>
  );
}

const timeOf = (i: EventInstance) => (i.event.allDay ? 'Todo el día' : `${i.start.slice(11, 16)}${i.end && i.end.slice(0, 10) === i.start.slice(0, 10) ? ` → ${i.end.slice(11, 16)}` : ''}`);

/** Detalle del día elegido, debajo del calendario: "MIÉRCOLES 16 DE OCTUBRE · en 2 días". */
function DayDetail({ day, items, onOpen }: { day: string; items: EventInstance[]; onOpen: (e: CalendarEvent) => void }) {
  const { profiles, can } = useApp();
  const t0 = today();
  const n = diffDays(day, t0);
  const rel = n === 0 ? 'Hoy' : n === 1 ? 'Mañana' : n === -1 ? 'Ayer' : n > 0 ? `En ${n} días` : `Hace ${-n} días`;
  const d = parseISODate(day);
  return (
    <section className="day-detail" aria-label={`${formatDate(day, { weekday: true })}`}>
      <h3 className="dd-title">{WEEKDAYS_ES[d.getDay()]} {d.getDate()} de {MONTHS_ES[d.getMonth()]}</h3>
      <div className="dd-rel">{rel}</div>
      {items.length ? (
        <ul className="dd-list">
          {items.map((i, k) => {
            const t = tones(colorFor(eventPeople(i.event), profiles));
            return (
              <li key={i.event.id + k}>
                <button type="button" className="dd-item" onClick={() => onOpen(i.event)}>
                  <span className="dd-bar" style={{ background: t.ink }} aria-hidden="true" />
                  <span className="dd-main">
                    <span className="ev-title">{categoryIcon('events', i.event.category)} {i.event.title}</span>
                    <span className="dd-sub">{timeOf(i)}{i.event.location ? ` · ${i.event.location}` : ''} · {whoLabel(eventPeople(i.event), profiles)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="dd-empty">Sin eventos este día.{can('events.edit') ? ' Tocá "Nuevo" para agregar uno.' : ''}</p>}
    </section>
  );
}

/** Bloque de color en la línea de tiempo (color de la persona al 50 %). */
function TimelineEvent({ i, onOpen }: { i: EventInstance; onOpen: (e: CalendarEvent) => void }) {
  const { profiles } = useApp();
  const t = tones(colorFor(eventPeople(i.event), profiles));
  return (
    <button type="button" className="tl-event" style={{ background: t.base, color: t.on }} onClick={() => onOpen(i.event)}>
      <span className="tl-bar" aria-hidden="true" />
      <span className="tl-main">
        <span className="ev-title">{categoryIcon('events', i.event.category)} {i.event.title}</span>
        <span className="tl-sub">{timeOf(i)}{i.event.location ? ` · ${i.event.location}` : ''}</span>
      </span>
      <AvatarStack ids={eventPeople(i.event)} profiles={profiles} />
    </button>
  );
}
