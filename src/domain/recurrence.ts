import type { ISODate, Recurrence } from './types';
import { addDays, addMonths, parseISODate, diffDays } from './dates';

/** Siguiente fecha estrictamente posterior a `after` según la regla, partiendo de `anchor`. */
export function nextOccurrence(rule: Recurrence, anchor: ISODate, after: ISODate): ISODate | null {
  const list = occurrencesBetween(rule, anchor, addDays(after, 1), addDays(after, 800), 1);
  return list[0] ?? null;
}

/** Ocurrencias de la regla en [from, to] (inclusive). anchor = primera ocurrencia de la serie. */
export function occurrencesBetween(rule: Recurrence, anchor: ISODate, from: ISODate, to: ISODate, limit = 500): ISODate[] {
  const out: ISODate[] = [];
  const interval = Math.max(1, Number(rule.interval) || 1);
  const until = rule.until && rule.until < to ? rule.until : to;
  let index = 0;
  const push = (d: ISODate) => {
    index++;
    if (rule.count && index > rule.count) return false;
    if (d > until) return false;
    if (d >= from) out.push(d);
    return out.length < limit;
  };
  if (rule.freq === 'daily') {
    let d = anchor;
    if (!rule.count && from > anchor) { // salto directo para no iterar años
      const k = Math.floor(diffDays(from, anchor) / interval);
      d = addDays(anchor, k * interval);
    }
    for (let i = 0; i < 5000; i++) { if (!push(d)) break; d = addDays(d, interval); }
  } else if (rule.freq === 'weekly') {
    const days = rule.byWeekday && rule.byWeekday.length ? [...rule.byWeekday].sort((a, b) => a - b) : [parseISODate(anchor).getDay()];
    const anchorDow = parseISODate(anchor).getDay();
    let weekStart = addDays(anchor, -anchorDow); // domingo de la semana del ancla
    for (let w = 0; w < 3000; w++) {
      let cont = true;
      for (const wd of days) {
        const d = addDays(weekStart, wd);
        if (d < anchor) continue;
        if (!push(d)) { cont = false; break; }
      }
      if (!cont) break;
      weekStart = addDays(weekStart, 7 * interval);
    }
  } else {
    const step = rule.freq === 'monthly' ? interval : 12 * interval;
    const anchorDay = parseISODate(anchor).getDate();
    for (let i = 0; i < 3000; i++) {
      const d = addMonths(anchor, i * step, anchorDay);
      if (!push(d)) break;
    }
  }
  return out;
}

export function describeRecurrence(r?: Recurrence | null): string {
  if (!r) return 'No se repite';
  const n = r.interval > 1 ? r.interval : 0;
  const base = {
    daily: n ? `Cada ${n} días` : 'Todos los días', weekly: n ? `Cada ${n} semanas` : 'Todas las semanas',
    monthly: n ? `Cada ${n} meses` : 'Todos los meses', yearly: n ? `Cada ${n} años` : 'Todos los años',
  }[r.freq];
  const dn = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  let s = base;
  if (r.freq === 'weekly' && r.byWeekday?.length) s += ` (${r.byWeekday.map((d) => dn[d]).join(', ')})`;
  if (r.until) s += ` hasta ${r.until}`;
  if (r.count) s += `, ${r.count} veces`;
  return s;
}
