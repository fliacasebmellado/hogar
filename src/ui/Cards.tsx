// Tarjetas de color para eventos y tareas: el color indica de quién es (perfil) y el emoji, de qué se trata.
import { Check } from 'lucide-react';
import type { CalendarEvent, Profile, Task } from '../domain/types';
import type { EventInstance } from '../services/events';
import { AvatarStack } from './components';
import { categoryIcon, tones } from './theme';
import { relativeDay, today } from '../domain/dates';

const FAMILY_COLOR = '#c2bbb4';

/** Color de un registro: el de la única persona involucrada; si son varias, el de la familia. */
export function colorFor(ids: (string | undefined)[], profiles: Profile[]): string {
  const people = [...new Set(ids.filter(Boolean) as string[])].map((id) => profiles.find((p) => p.id === id)).filter((p) => p && p.role !== 'family') as Profile[];
  if (people.length === 1) return people[0].color;
  return profiles.find((p) => p.role === 'family')?.color ?? FAMILY_COLOR;
}

/** "Hijo", "Papá y Mamá" o "Toda la familia". */
export function whoLabel(ids: string[], profiles: Profile[]): string {
  const ps = ids.map((id) => profiles.find((p) => p.id === id)).filter((p) => p && p.role !== 'family') as Profile[];
  if (!ps.length) return '';
  if (ps.length >= profiles.filter((p) => p.active && p.role !== 'family').length) return 'Toda la familia';
  return ps.map((p) => p.name).join(ps.length === 2 ? ' y ' : ', ');
}

export function eventPeople(e: CalendarEvent) {
  return e.participantIds?.length ? e.participantIds : e.ownerId ? [e.ownerId] : [];
}

export function EventCard({ i, profiles, onOpen, showDay, now = new Date() }: { i: EventInstance; profiles: Profile[]; onOpen: (e: CalendarEvent) => void; showDay?: boolean; now?: Date }) {
  const e = i.event;
  const t = tones(colorFor(eventPeople(e), profiles));
  const who = whoLabel(eventPeople(e), profiles);
  const start = i.start.length > 10 ? i.start.slice(11, 16) : '';
  const end = i.end && i.end.length > 10 ? i.end.slice(11, 16) : '';
  const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const isNow = i.date === today(now) && (e.allDay || (start <= nowHm && (end ? nowHm < end : false)));
  return (
    <button type="button" className="ev-card" style={{ background: t.tint, boxShadow: `inset 6px 0 0 ${t.base}` }} onClick={() => onOpen(e)}>
      <span className="ev-emoji" aria-hidden="true" style={{ background: t.soft }}>{categoryIcon('events', e.category)}</span>
      <span className="ev-body">
        <span className="ev-title" style={{ display: 'block' }}>{e.title}</span>
        <span className="ev-time" style={{ display: 'block' }}>{showDay ? `${relativeDay(i.date)} · ` : ''}{e.allDay ? 'Todo el día' : `${start}${end ? ` – ${end}` : ''}`}{who && <span style={{ fontWeight: 500, color: 'var(--text-3)' }}> · {who}</span>}</span>
        {e.location && <span className="ev-sub" style={{ display: 'block' }}>📍 {e.location}</span>}
      </span>
      {isNow && !e.allDay && <span className="ev-now">● AHORA</span>}
      <AvatarStack ids={eventPeople(e)} profiles={profiles} />
    </button>
  );
}

export function TaskCard({ t, profiles, onOpen, onToggle }: { t: Task; profiles: Profile[]; onOpen: (t: Task) => void; onToggle: (t: Task) => void }) {
  const tone = tones(colorFor([t.assigneeId], profiles));
  const done = t.status === 'completada';
  const late = !done && t.dueDate && t.dueDate < today();
  return (
    <div className={`ev-card${done ? ' done' : ''}`} style={{ background: tone.tint, cursor: 'default', boxShadow: `inset 6px 0 0 ${tone.base}` }}>
      <span className="ev-emoji" aria-hidden="true" style={{ background: tone.soft }}>{categoryIcon('tasks', t.category)}</span>
      <button type="button" className="ev-body item-main-btn" onClick={() => onOpen(t)}>
        <span className="ev-title" style={{ display: 'block' }}>{t.title}</span>
        <span className="ev-time" style={{ display: 'block', color: late ? 'var(--alert-fg)' : undefined }}>
          {t.dueDate ? `${late ? 'Atrasada · ' : ''}${relativeDay(t.dueDate)}${t.dueTime ? ` ${t.dueTime}` : ''}` : 'Sin fecha'}{t.priority === 'alta' ? ' · ⚑ prioritaria' : ''}
        </span>
      </button>
      <AvatarStack ids={t.assigneeId ? [t.assigneeId] : []} profiles={profiles} />
      <button type="button" className={`check${done ? ' on' : ''}`} aria-pressed={done} aria-label={done ? `Reabrir ${t.title}` : `Completar ${t.title}`} onClick={() => onToggle(t)} style={{ width: 32, height: 32 }}>
        {done && <Check size={18} strokeWidth={3} />}
      </button>
    </div>
  );
}
