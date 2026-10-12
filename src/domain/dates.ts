// Utilidades de fecha en hora local. Las fechas de negocio se guardan como 'YYYY-MM-DD' y 'YYYY-MM-DDTHH:mm'.
import type { ISODate } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function toISODateTime(d: Date): string {
  return `${toISODate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function parseISODate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  const out = new Date(y, m - 1, d);
  if (s.length > 10) {
    const [hh, mm] = s.slice(11, 16).split(':').map(Number);
    out.setHours(hh || 0, mm || 0, 0, 0);
  }
  return out;
}
export function isValidISODate(s?: string): boolean {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toISODate(parseISODate(s)) === s;
}
export function isValidISODateTime(s?: string): boolean {
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return false;
  const [h, m] = s.slice(11).split(':').map(Number);
  return isValidISODate(s.slice(0, 10)) && h < 24 && m < 60;
}
export function today(now = new Date()): ISODate { return toISODate(now); }
export function addDays(date: ISODate, n: number): ISODate {
  const d = parseISODate(date); d.setDate(d.getDate() + n); return toISODate(d);
}
export function daysInMonth(y: number, m0: number) { return new Date(y, m0 + 1, 0).getDate(); }
/** Suma meses conservando el día; si no existe (31 de febrero) usa el último día del mes. */
export function addMonths(date: ISODate, n: number, anchorDay?: number): ISODate {
  const d = parseISODate(date);
  const day = anchorDay ?? d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  target.setDate(Math.min(day, daysInMonth(target.getFullYear(), target.getMonth())));
  return toISODate(target);
}
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(a.slice(0, 10)).getTime() - parseISODate(b.slice(0, 10)).getTime()) / 86400000);
}
export function startOfWeek(date: ISODate): ISODate { // semana de lunes a domingo
  const d = parseISODate(date); const wd = (d.getDay() + 6) % 7; return addDays(date, -wd);
}
export function startOfMonth(date: ISODate): ISODate { return date.slice(0, 8) + '01'; }
export function monthKey(date: ISODate) { return date.slice(0, 7); }
export function nowISO() { return new Date().toISOString(); }
export function addMinutesToDateTime(dt: string, minutes: number): string {
  const d = parseISODate(dt); d.setMinutes(d.getMinutes() + minutes); return toISODateTime(d);
}

const DOW = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MON = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const WEEKDAYS_ES = DOW;
export const MONTHS_ES = MON;

export function formatDate(date?: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  if (!date) return '';
  const d = parseISODate(date);
  let s = `${d.getDate()} de ${MON[d.getMonth()]}`;
  if (opts.weekday) s = `${DOW[d.getDay()]} ${s}`;
  if (opts.year) s += ` de ${d.getFullYear()}`;
  return s;
}
export function formatShortDate(date?: string): string {
  if (!date) return '';
  const d = parseISODate(date);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}
export function formatTime(dt?: string) { return dt && dt.length > 10 ? dt.slice(11, 16) : ''; }
export function relativeDay(date: ISODate, ref: ISODate = today()): string {
  const n = diffDays(date, ref);
  if (n === 0) return 'Hoy';
  if (n === 1) return 'Mañana';
  if (n === -1) return 'Ayer';
  if (n > 1 && n < 7) return DOW[parseISODate(date).getDay()].replace(/^./, (c) => c.toUpperCase());
  if (n < 0 && n > -30) return `Hace ${-n} días`;
  return formatDate(date);
}
export function monthLabel(ym: string) { const [y, m] = ym.split('-').map(Number); return `${MON[m - 1]} ${y}`; }
export function formatDateTimeHuman(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${toISODate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
