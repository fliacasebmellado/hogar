// Agenda: expansión de eventos recurrentes para las vistas (las repeticiones no se materializan como registros;
// un único registro con la regla es la fuente de verdad, igual que en Google Calendar).
import type { CalendarEvent, ISODate } from '../domain/types';
import { addMinutesToDateTime, diffDays, parseISODate, toISODateTime } from '../domain/dates';
import { occurrencesBetween } from '../domain/recurrence';
import { norm } from './tasks';

export interface EventInstance { event: CalendarEvent; date: ISODate; start: string; end?: string }

export function expandEvents(events: CalendarEvent[], from: ISODate, to: ISODate): EventInstance[] {
  const out: EventInstance[] = [];
  for (const e of events) {
    if (e.deleted) continue;
    const startDate = e.start.slice(0, 10);
    const durationMin = e.end ? Math.round((parseISODate(e.end).getTime() - parseISODate(e.start).getTime()) / 60000) : undefined;
    const dates = e.recurrence ? occurrencesBetween(e.recurrence, startDate, from, to) : startDate >= from && startDate <= to ? [startDate] : [];
    // eventos de varios días que empezaron antes del rango
    if (!e.recurrence && e.end && startDate < from && e.end.slice(0, 10) >= from) dates.push(startDate);
    for (const d of dates) {
      const start = d + e.start.slice(10);
      out.push({ event: e, date: d, start, end: durationMin != null ? addMinutesToDateTime(start.length > 10 ? start : start + 'T00:00', durationMin) : undefined });
    }
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/** Días cubiertos por una instancia (para eventos de varios días en la vista mensual). */
export function instanceDays(i: EventInstance): ISODate[] {
  if (!i.end) return [i.date];
  const n = Math.max(0, diffDays(i.end.slice(0, 10), i.date));
  const out: ISODate[] = [];
  for (let k = 0; k <= Math.min(n, 60); k++) { const d = parseISODate(i.date); d.setDate(d.getDate() + k); out.push(toISODateTime(d).slice(0, 10)); }
  return out;
}

export function filterEvents(events: CalendarEvent[], f: { personId?: string; category?: string; text?: string }) {
  const q = f.text ? norm(f.text) : '';
  return events.filter((e) => !e.deleted)
    .filter((e) => !f.personId || e.participantIds?.includes(f.personId) || e.ownerId === f.personId)
    .filter((e) => !f.category || e.category === f.category)
    .filter((e) => !q || norm(`${e.title} ${e.description ?? ''} ${e.location ?? ''}`).includes(q));
}
