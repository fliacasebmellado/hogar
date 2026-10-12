import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, CalendarDays, Repeat, MapPin } from 'lucide-react';
import { useApp, useLive } from '../../app/context';
import type { CalendarEvent } from '../../domain/types';
import { expandEvents, filterEvents, instanceDays, type EventInstance } from '../../services/events';
import { addDays, addMonths, formatDate, monthLabel, parseISODate, startOfMonth, startOfWeek, today, WEEKDAYS_ES, relativeDay } from '../../domain/dates';
import { AvatarStack, ChipFilter, Empty, PersonFilter, Segmented, StatusChip, SyncMark } from '../../ui/components';
import { EventCard, colorFor, eventPeople } from '../../ui/Cards';
import { categoryIcon, tones } from '../../ui/theme';
import { EventSheet } from './EventSheet';

type View = 'dia' | 'semana' | 'mes';
const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  const [view, setView] = useState<View>('dia');
  const [cursor, setCursor] = useState(today());
  // Familia ve todo junto; cada persona arranca viendo lo suyo (con "Todos" a un toque).
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
    return ppl.length === 0 || ppl.includes(person) || e.ownerId === person; // lo de la casa sin responsable también se ve
  }), [events, person, cat]);
  const weekStart = startOfWeek(cursor);
  const range = useMemo(() => {
    if (view === 'mes') { const s = startOfWeek(startOfMonth(cursor)); return { from: s, to: addDays(s, 41) }; }
    return { from: weekStart, to: addDays(weekStart, 6) };
  }, [view, cursor]);
  const instances = useMemo(() => expandEvents(filtered, range.from, range.to), [filtered, range]);
  const byDay = useMemo(() => {
    const m: Record<string, EventInstance[]> = {};
    for (const i of instances) for (const d of instanceDays(i)) (m[d] ??= []).push(i);
    return m;
  }, [instances]);

  const t0 = today();
  const move = (n: number) => setCursor(view === 'mes' ? addMonths(startOfMonth(cursor), n) : addDays(cursor, 7 * n));
  const weekEnd = addDays(weekStart, 6);
  const label = view === 'mes' ? capFirst(monthLabel(cursor.slice(0, 7)))
    : weekStart.slice(0, 7) === weekEnd.slice(0, 7) ? `${parseISODate(weekStart).getDate()} al ${formatDate(weekEnd)}` : `${formatDate(weekStart)} al ${formatDate(weekEnd)}`;
  const close = () => { setEditing(undefined); if (params.get('id')) setParams({}, { replace: true }); };

  const strip = (
    <div className="week-strip" role="group" aria-label="Días de la semana">
      {Array.from({ length: 7 }, (_, k) => addDays(weekStart, k)).map((day) => (
        <button key={day} type="button" aria-pressed={day === cursor} aria-label={`${formatDate(day, { weekday: true })}${(byDay[day] ?? []).length ? `, ${byDay[day].length} evento(s)` : ''}`}
          className={`day-pill${day === t0 ? ' today' : ''}${day < t0 ? ' past' : ''}${(byDay[day] ?? []).length ? ' has' : ''}`}
          onClick={() => { setCursor(day); if (view === 'semana') document.getElementById(`dia-${day}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
          <span className="dow">{WEEKDAYS_ES[parseISODate(day).getDay()].slice(0, 3)}</span>
          <span className="dnum">{parseISODate(day).getDate()}</span>
          <span className="ddot" />
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <Segmented label="Vista" value={view} onChange={setView} options={[{ value: 'dia', label: 'Día' }, { value: 'semana', label: 'Semana' }, { value: 'mes', label: 'Mes' }]} />
        <span className="spacer" />
        {can('events.edit') && <button className="btn btn-primary" onClick={() => setEditing(null)}><Plus size={18} /> Nuevo</button>}
      </div>
      <div className="row" style={{ marginBottom: 6 }}>
        <button className="icon-btn" onClick={() => move(-1)} aria-label={view === 'mes' ? 'Mes anterior' : 'Semana anterior'}><ChevronLeft size={20} /></button>
        <h2 style={{ flex: 1, textAlign: 'center' }} aria-live="polite">{label}</h2>
        <button className="icon-btn" onClick={() => move(1)} aria-label={view === 'mes' ? 'Mes siguiente' : 'Semana siguiente'}><ChevronRight size={20} /></button>
        <button className="btn btn-sm" onClick={() => setCursor(t0)}>Hoy</button>
      </div>
      <div className="stack-sm" style={{ marginBottom: 10 }}>
        <PersonFilter value={person} onChange={setPerson} profiles={profiles} label="Ver la agenda de" />
        <details className="more"><summary>Filtrar por categoría</summary>
          <ChipFilter label="Categoría" value={cat} onChange={setCat} options={categories('events').map((c) => ({ value: c.id, label: `${categoryIcon('events', c.id)} ${c.label}` }))} />
        </details>
      </div>

      {view !== 'mes' && strip}

      {view === 'dia' && <DayCards day={cursor} items={byDay[cursor] ?? []} onOpen={setEditing} />}
      {view === 'semana' && Array.from({ length: 7 }, (_, k) => addDays(weekStart, k)).map((day) => (
        <div key={day} id={`dia-${day}`} style={{ scrollMarginTop: 70 }}><DayCards day={day} items={byDay[day] ?? []} onOpen={setEditing} compactEmpty /></div>
      ))}
      {view === 'mes' && (
        <>
          <div className="cal-grid" role="grid" aria-label={label}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => <div key={d} className="dow" role="columnheader">{WEEKDAYS_ES[d].slice(0, 3)}</div>)}
            {Array.from({ length: 42 }, (_, k) => addDays(range.from, k)).map((day) => {
              const list = byDay[day] ?? [];
              return (
                <button key={day} role="gridcell" className={`cal-day${day.slice(0, 7) !== cursor.slice(0, 7) ? ' other' : ''}${day === t0 ? ' today' : ''}${day === cursor ? ' selected' : ''}`}
                  onClick={() => setCursor(day)} aria-label={`${formatDate(day, { weekday: true })}: ${list.length} evento(s)`}>
                  <span className="num">{parseISODate(day).getDate()}</span>
                  <span className="dots">
                    {list.slice(0, 3).map((i, n) => <span key={n} className="cal-dot" style={{ background: tones(colorFor(eventPeople(i.event), profiles)).soft }}>{i.event.title}</span>)}
                    {list.length > 3 && <span className="tiny muted">+{list.length - 3}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 14 }}><DayCards day={cursor} items={byDay[cursor] ?? []} onOpen={setEditing} /></div>
        </>
      )}
      {events.length === 0 && <div className="card" style={{ marginTop: 12 }}><Empty icon={<CalendarDays size={36} />} title="Todavía no hay eventos en la agenda." action={can('events.edit') ? <button className="btn" onClick={() => setEditing(null)}>Agregar evento</button> : undefined} /></div>}
      <EventSheet open={editing !== undefined} event={editing ?? null} onClose={close} defaultDate={cursor} />
    </div>
  );
}

function DayCards({ day, items, onOpen, compactEmpty }: { day: string; items: EventInstance[]; onOpen: (e: CalendarEvent) => void; compactEmpty?: boolean }) {
  const { profiles } = useApp();
  const t0 = today();
  const title = day === t0 ? 'Hoy' : day === addDays(t0, 1) ? 'Mañana' : capFirst(WEEKDAYS_ES[parseISODate(day).getDay()]);
  return (
    <section aria-label={`${title} ${formatDate(day)}`} style={{ marginBottom: compactEmpty ? 6 : 0 }}>
      <h3 className="day-heading">{title}<span>{formatDate(day)}</span></h3>
      {items.length ? <div className="cards">{items.map((i, n) => <EventCard key={i.event.id + n} i={i} profiles={profiles} onOpen={onOpen} />)}</div>
        : <p className="muted small" style={{ margin: '0 2px 8px' }}>{compactEmpty ? 'Libre' : 'Sin eventos este día.'}</p>}
    </section>
  );
}
