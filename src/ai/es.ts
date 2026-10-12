// Extracción local en español rioplatense: fechas, horas, importes, personas y repeticiones.
// Todo se ejecuta en el dispositivo; no se envía texto a ningún servicio.
import type { ISODate, Recurrence } from '../domain/types';
import { addDays, daysInMonth, toISODate, isValidISODate } from '../domain/dates';
import type { Ambiguity } from './types';

/** Minúsculas y sin tildes, conservando la longitud (para mapear posiciones al texto original). */
export function fold(s: string): string {
  const map: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n', Á: 'a', É: 'e', Í: 'i', Ó: 'o', Ú: 'u', Ü: 'u', Ñ: 'n' };
  let out = '';
  for (const ch of s) {
    const r = map[ch] ?? ch.toLowerCase();
    out += r.length === ch.length ? r : ch;
  }
  return out;
}

export interface Span { start: number; end: number }
export interface DateHit extends Span { date?: ISODate; ambiguity?: Ambiguity; raw: string; vague?: boolean }
export interface TimeHit extends Span { time?: string; endTime?: string; ambiguity?: Ambiguity; raw: string; partOfDay?: string }
export interface AmountHit extends Span { amount: number; currency: string; assumedCurrency: boolean; raw: string }

const WD = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTH_RE = '(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)';
const monthIndex = (m: string) => (m === 'setiembre' ? 8 : MONTHS.indexOf(m));

function overlaps(a: Span, list: Span[]) { return list.some((b) => a.start < b.end && b.start < a.end); }

function resolveDayMonth(day: number, month0: number, year: number | null, ref: Date): ISODate | null {
  let y = year ?? ref.getFullYear();
  if (y < 100) y += 2000;
  if (month0 < 0 || month0 > 11 || day < 1 || day > daysInMonth(y, month0)) return null;
  let d = toISODate(new Date(y, month0, day));
  // sin año explícito y más de 60 días en el pasado → probablemente el año próximo
  if (year === null && (new Date(y, month0, day).getTime() - ref.getTime()) / 86400000 < -60) d = toISODate(new Date(y + 1, month0, day));
  return isValidISODate(d) ? d : null;
}

export function extractDates(text: string, now: Date): DateHit[] {
  const f = fold(text);
  const ref = toISODate(now);
  const hits: DateHit[] = [];
  const add = (h: DateHit) => { if (!overlaps(h, hits)) hits.push(h); };
  let m: RegExpExecArray | null;

  // dd/mm(/aaaa)
  const reNum = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/g;
  while ((m = reNum.exec(f))) {
    const d = resolveDayMonth(+m[1], +m[2] - 1, m[3] ? +m[3] : null, now);
    if (d) add({ start: m.index, end: m.index + m[0].length, date: d, raw: text.slice(m.index, m.index + m[0].length) });
  }
  // 15 de octubre (de 2026)
  const reLong = new RegExp(`\\b(\\d{1,2})(?:°|º|ro)?\\s+de\\s+${MONTH_RE}(?:\\s+(?:de|del)\\s+(\\d{4}))?`, 'g');
  while ((m = reLong.exec(f))) {
    const d = resolveDayMonth(+m[1], monthIndex(m[2]), m[3] ? +m[3] : null, now);
    if (d) add({ start: m.index, end: m.index + m[0].length, date: d, raw: text.slice(m.index, m.index + m[0].length) });
  }
  // pasado mañana / mañana / hoy
  const rePasado = /\bpasado\s+manana\b/g;
  while ((m = rePasado.exec(f))) add({ start: m.index, end: m.index + m[0].length, date: addDays(ref, 2), raw: m[0] });
  const reManana = /\bmanana\b/g;
  while ((m = reManana.exec(f))) {
    const before = f.slice(Math.max(0, m.index - 8), m.index);
    if (/(la|de la|por la|esta)\s+$/.test(before)) continue; // "a la mañana" = parte del día
    add({ start: m.index, end: m.index + m[0].length, date: addDays(ref, 1), raw: text.slice(m.index, m.index + 6) });
  }
  const reHoy = /\bhoy\b/g;
  while ((m = reHoy.exec(f))) add({ start: m.index, end: m.index + 3, date: ref, raw: 'hoy' });
  const reDias = /\b(?:en|dentro de)\s+(\d{1,3})\s+dias\b/g;
  while ((m = reDias.exec(f))) add({ start: m.index, end: m.index + m[0].length, date: addDays(ref, +m[1]), raw: m[0] });

  // días de la semana
  const reWd = /\b(?:(este|esta|el|proximo|el proximo)\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)(\s+(?:que viene|proximo))?\b/g;
  while ((m = reWd.exec(f))) {
    const target = WD.indexOf(m[2]);
    const cur = now.getDay();
    let delta = (target - cur + 7) % 7;
    const span = { start: m.index, end: m.index + m[0].length };
    if (/\b(todos|todas|cada)\s+(los|las)?\s*$/.test(f.slice(Math.max(0, m.index - 12), m.index))) continue; // repetición, no fecha
    if (delta === 0) {
      if (m[1] === 'este' || m[1] === 'esta') { add({ ...span, date: ref, raw: m[0] }); continue; }
      const opts = [{ label: `Hoy (${WD[target]})`, value: ref }, { label: `El ${WD[target]} próximo (${addDays(ref, 7)})`, value: addDays(ref, 7) }];
      add({ ...span, date: addDays(ref, 7), raw: m[0], ambiguity: { field: 'date', message: `"${m[0]}": ¿hoy o la semana próxima?`, options: opts } });
      continue;
    }
    add({ ...span, date: addDays(ref, delta), raw: text.slice(span.start, span.end) });
  }
  // el 15 / el día 15 / vence el 20
  const reDay = /\b(?:el|dia|del)\s+(?:dia\s+)?(\d{1,2})\b(?!\s*(?:[/:.%-]|hs|h\b|horas|de\s+[a-z]))/g;
  while ((m = reDay.exec(f))) {
    const day = +m[1];
    if (day < 1 || day > 31) continue;
    let y = now.getFullYear(), mo = now.getMonth();
    if (day < now.getDate()) { mo++; if (mo > 11) { mo = 0; y++; } }
    if (day > daysInMonth(y, mo)) continue;
    add({ start: m.index, end: m.index + m[0].length, date: toISODate(new Date(y, mo, day)), raw: text.slice(m.index, m.index + m[0].length) });
  }
  // expresiones vagas
  const reVague = /\b(la semana que viene|la proxima semana|el mes que viene|el proximo mes|fin de mes|a fin de mes|este finde|el finde|el fin de semana)\b/g;
  while ((m = reVague.exec(f))) {
    const span = { start: m.index, end: m.index + m[0].length };
    if (overlaps(span, hits)) continue;
    const phrase = m[1];
    let options: { label: string; value: string }[] = [];
    if (phrase.includes('semana que viene') || phrase.includes('proxima semana')) {
      const monday = addDays(ref, ((1 - now.getDay() + 7) % 7) || 7);
      options = [0, 1, 2, 3, 4, 5, 6].map((k) => ({ label: `${WD[(1 + k) % 7]} ${addDays(monday, k)}`, value: addDays(monday, k) }));
    } else if (phrase.includes('mes')) {
      if (phrase.includes('fin de mes')) {
        const last = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
        hits.push({ ...span, date: last, raw: m[0], vague: true });
        continue;
      }
      const first = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 1));
      options = [{ label: `Principio de mes (${first})`, value: first }, { label: `Mediados (${first.slice(0, 8)}15)`, value: first.slice(0, 8) + '15' }];
    } else {
      const sat = addDays(ref, (6 - now.getDay() + 7) % 7);
      options = [{ label: `Sábado ${sat}`, value: sat }, { label: `Domingo ${addDays(sat, 1)}`, value: addDays(sat, 1) }];
    }
    hits.push({ ...span, raw: m[0], vague: true, ambiguity: { field: 'date', message: `"${m[0]}" no indica un día exacto. ¿Qué día?`, options } });
  }
  return hits.sort((a, b) => a.start - b.start);
}

export function extractTimes(text: string): TimeHit[] {
  const f = fold(text);
  const hits: TimeHit[] = [];
  const add = (h: TimeHit) => { if (!overlaps(h, hits)) hits.push(h); };
  const pad = (n: number) => String(n).padStart(2, '0');
  const qual = (q?: string) => (q ? (/(tarde|noche|pm)/.test(q) ? 'pm' : 'am') : undefined);
  const finalize = (h: number, min: number, q: string | undefined, explicitH: boolean, span: Span, raw: string): TimeHit => {
    let hour = h;
    if (q === 'pm' && hour < 12) hour += 12;
    const time = `${pad(hour)}:${pad(min)}`;
    if (!q && !explicitH && hour >= 1 && hour <= 7) {
      return { ...span, raw, time, ambiguity: { field: 'time', message: `"${raw.trim()}": ¿${time} o ${pad(hour + 12)}:${pad(min)}?`, options: [{ label: `${time} (mañana)`, value: time }, { label: `${pad(hour + 12)}:${pad(min)} (tarde/noche)`, value: `${pad(hour + 12)}:${pad(min)}` }] } };
    }
    return { ...span, raw, time };
  };
  let m: RegExpExecArray | null;
  // rango: de 18 a 20 (hs)
  const reRange = /\bde\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:hs\b|h\b)?\s+a\s+(\d{1,2})(?:[:.](\d{2}))?\s*(hs|h|horas)?\b/g;
  while ((m = reRange.exec(f))) {
    const h1 = +m[1], h2 = +m[3];
    if (h1 > 23 || h2 > 23) continue;
    const startHit = finalize(h1, +(m[2] ?? 0), undefined, !!m[5] || h1 >= 8, { start: m.index, end: m.index + m[0].length }, m[0]);
    let eh = h2;
    if (startHit.time && eh < +startHit.time.slice(0, 2) && eh < 12) eh += 12;
    add({ ...startHit, endTime: `${pad(eh)}:${pad(+(m[4] ?? 0))}` });
  }
  const reAt = /\b(?:a\s+las|a\s+la|desde\s+las|tipo|tipo\s+a\s+las)\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*(hs|h|horas)\b)?(?:\s+(de\s+la\s+manana|de\s+la\s+tarde|de\s+la\s+noche|am|pm))?/g;
  while ((m = reAt.exec(f))) {
    const h = +m[1];
    if (h > 23) continue;
    add(finalize(h, +(m[2] ?? 0), qual(m[4]), !!m[3] || h >= 8 || !!m[2], { start: m.index, end: m.index + m[0].length }, m[0]));
  }
  const reClock = /\b(\d{1,2}):(\d{2})\s*(hs|h)?\b/g;
  while ((m = reClock.exec(f))) {
    if (+m[1] > 23 || +m[2] > 59) continue;
    add({ start: m.index, end: m.index + m[0].length, raw: m[0], time: `${pad(+m[1])}:${m[2]}` });
  }
  const reHs = /\b(\d{1,2})(?:\.(\d{2}))?\s*(hs|h)\b/g;
  while ((m = reHs.exec(f))) {
    if (+m[1] > 23) continue;
    add({ start: m.index, end: m.index + m[0].length, raw: m[0], time: `${pad(+m[1])}:${pad(+(m[2] ?? 0))}` });
  }
  const reNoon = /\b(al\s+)?mediodia\b/g;
  while ((m = reNoon.exec(f))) add({ start: m.index, end: m.index + m[0].length, raw: m[0], time: '12:00' });
  const rePart = /\b(?:a|por)\s+la\s+(manana|tarde|noche)\b/g;
  while ((m = rePart.exec(f))) {
    const span = { start: m.index, end: m.index + m[0].length };
    if (overlaps(span, hits)) continue;
    hits.push({ ...span, raw: m[0], partOfDay: m[1] });
  }
  return hits.sort((a, b) => a.start - b.start);
}

/** Interpreta números con convenciones argentinas: "12.500,50" → 12500.5; "1.500" → 1500; "1,5" → 1.5. */
export function parseNumberAR(raw: string): number | null {
  let s = raw.replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = s.split(sep);
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = parts.join('');
    else s = parts.join('.');
  }
  const n = Number(s);
  return isFinite(n) ? n : null;
}

export function extractAmounts(text: string, opts: { bareNumbers?: boolean } = {}): AmountHit[] {
  const f = fold(text);
  const hits: AmountHit[] = [];
  const add = (h: AmountHit) => { if (!overlaps(h, hits) && h.amount > 0) hits.push(h); };
  const mult = (w?: string) => (w && /^(mil|k|luca|lucas)$/.test(w) ? 1000 : 1);
  let m: RegExpExecArray | null;
  const USD = '(usd|u\\$s|us\\$|u\\$d|dolares|dolar|dls)';
  const reUsdPre = new RegExp(`\\b${USD}\\s*(\\d[\\d.,]*)\\s*(mil|k)?`, 'g');
  while ((m = reUsdPre.exec(f))) { const n = parseNumberAR(m[2]); if (n != null) add({ start: m.index, end: m.index + m[0].length, amount: n * mult(m[3]), currency: 'USD', assumedCurrency: false, raw: m[0] }); }
  const reUsdPost = new RegExp(`(\\d[\\d.,]*)\\s*(mil|k)?\\s*${USD}\\b`, 'g');
  while ((m = reUsdPost.exec(f))) { const n = parseNumberAR(m[1]); if (n != null) add({ start: m.index, end: m.index + m[0].length, amount: n * mult(m[2]), currency: 'USD', assumedCurrency: false, raw: m[0] }); }
  const rePesoPre = /(?:\$|\bars\b)\s*(\d[\d.,]*)\s*(mil|k|lucas?)?/g;
  while ((m = rePesoPre.exec(f))) { const n = parseNumberAR(m[1]); if (n != null) add({ start: m.index, end: m.index + m[0].length, amount: n * mult(m[2]), currency: 'ARS', assumedCurrency: false, raw: m[0] }); }
  const rePesoPost = /(\d[\d.,]*)\s*(mil|k|lucas?)?\s*(?:pesos\b|\$|ars\b)/g;
  while ((m = rePesoPost.exec(f))) {
    if (!/(pesos|\$|ars)/.test(m[0])) continue;
    const n = parseNumberAR(m[1]); if (n != null) add({ start: m.index, end: m.index + m[0].length, amount: n * mult(m[2]), currency: 'ARS', assumedCurrency: false, raw: m[0] });
  }
  const reMil = /\b(\d+(?:[.,]\d+)?)\s*(mil|lucas?)\b/g;
  while ((m = reMil.exec(f))) { const n = parseNumberAR(m[1]); if (n != null) add({ start: m.index, end: m.index + m[0].length, amount: n * 1000, currency: 'ARS', assumedCurrency: true, raw: m[0] }); }
  if (opts.bareNumbers) {
    const reBare = /(?<![\d/:.,-])(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{3,7}(?:,\d{1,2})?)(?![\d/:]|\s*(?:hs|h\b|horas|de\s+[a-z]|dias|kg|g\b|l\b|ml|%|cm|m\b|unidades|u\b))/g;
    while ((m = reBare.exec(f))) {
      const n = parseNumberAR(m[1]);
      if (n == null || n < 100) continue;
      if (n >= 1900 && n <= 2100 && !m[1].includes('.')) continue; // probablemente un año
      add({ start: m.index, end: m.index + m[0].length, amount: n, currency: 'ARS', assumedCurrency: true, raw: m[0] });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

export interface PersonRef { id: string; name: string; role: 'adult' | 'child' | 'family'; aliases: string[]; active: boolean }
export interface PeopleHit { ids: string[]; responsibleId?: string; explicitResponsible: boolean; vagueSomeone: boolean; spans: Span[] }

export function findPeople(text: string, people: PersonRef[], currentId?: string): PeopleHit {
  const f = fold(text);
  const ids: string[] = [];
  const spans: Span[] = [];
  const pushId = (id: string) => { if (!ids.includes(id)) ids.push(id); };
  let responsibleId: string | undefined;
  let explicit = false;
  const persons = people.filter((x) => x.active && x.role !== 'family'); // el perfil Familia no es una persona
  for (const p of persons) {
    for (const alias of [p.name, ...(p.aliases ?? [])]) {
      const a = fold(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!a) continue;
      const re = new RegExp(`(^|[^a-z0-9ñ])(${a})(?![a-z0-9ñ])`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(f))) {
        pushId(p.id);
        const start = m.index + m[1].length;
        spans.push({ start, end: start + m[2].length });
        const before = f.slice(Math.max(0, start - 22), start);
        const after = f.slice(start + m[2].length, start + m[2].length + 16);
        if (/(le toca a|lo hace|la hace|encargad[oa]|responsable|a cargo de|que lo haga|que la haga|asignar a|asignale a|para que)\s*:?\s*$/.test(before) || /^\s+(tiene que|se encarga|lo hace|la hace|va a|debe)/.test(after)) {
          responsibleId = p.id; explicit = true;
        }
      }
    }
  }
  const kids = people.filter((p) => p.active && p.role === 'child');
  const reKids = /\b(los chicos|los nenes|los hijos|los pibes|los ninos)\b/g;
  let mk: RegExpExecArray | null;
  while ((mk = reKids.exec(f))) { kids.forEach((k) => pushId(k.id)); spans.push({ start: mk.index, end: mk.index + mk[0].length }); }
  const reAll = /\b(toda la familia|todos nosotros|todos juntos|la familia)\b/g;
  while ((mk = reAll.exec(f))) { persons.forEach((p) => pushId(p.id)); spans.push({ start: mk.index, end: mk.index + mk[0].length }); }
  if (currentId && /\b(yo|me toca|tengo que|me encargo|voy a)\b/.test(f)) { pushId(currentId); if (!responsibleId) { responsibleId = currentId; explicit = true; } }
  const vagueSomeone = /\b(alguien|alguno de nosotros|alguno|cualquiera)\b/.test(f);
  return { ids, responsibleId, explicitResponsible: explicit, vagueSomeone, spans };
}

export function extractRecurrence(text: string): { rule: Recurrence; span: Span } | null {
  const f = fold(text);
  let m: RegExpExecArray | null;
  const num = (s: string) => ({ dos: 2, tres: 3, cuatro: 4, seis: 6, quince: 15 } as Record<string, number>)[s] ?? Number(s);
  if ((m = /\b(?:todos los|todas las|cada)\s+((?:(?:lunes|martes|miercoles|jueves|viernes|sabado|sabados|domingo|domingos)(?:\s*(?:,|y)\s*)?)+)/.exec(f))) {
    const days = [...m[1].matchAll(/lunes|martes|miercoles|jueves|viernes|sabado|domingo/g)].map((x) => WD.indexOf(x[0]));
    return { rule: { freq: 'weekly', interval: 1, byWeekday: [...new Set(days)] }, span: { start: m.index, end: m.index + m[0].length } };
  }
  if ((m = /\bcada\s+(\d+|dos|tres|cuatro|seis|quince)\s+(dias|semanas|meses|anos)\b/.exec(f))) {
    const freq = m[2] === 'dias' ? 'daily' : m[2] === 'semanas' ? 'weekly' : m[2] === 'meses' ? 'monthly' : 'yearly';
    return { rule: { freq, interval: num(m[1]) }, span: { start: m.index, end: m.index + m[0].length } };
  }
  if ((m = /\b(todos los dias|todas las mananas|todas las noches|diariamente|cada dia)\b/.exec(f))) return { rule: { freq: 'daily', interval: 1 }, span: { start: m.index, end: m.index + m[0].length } };
  if ((m = /\b(todas las semanas|cada semana|semanalmente|una vez por semana)\b/.exec(f))) return { rule: { freq: 'weekly', interval: 1 }, span: { start: m.index, end: m.index + m[0].length } };
  if ((m = /\b(cada quince dias|cada 15 dias|quincenalmente)\b/.exec(f))) return { rule: { freq: 'daily', interval: 15 }, span: { start: m.index, end: m.index + m[0].length } };
  if ((m = /\b(todos los meses|cada mes|mensualmente|mensual|una vez por mes)\b/.exec(f))) return { rule: { freq: 'monthly', interval: 1 }, span: { start: m.index, end: m.index + m[0].length } };
  if ((m = /\b(todos los anos|cada ano|anualmente|anual|una vez por ano)\b/.exec(f))) return { rule: { freq: 'yearly', interval: 1 }, span: { start: m.index, end: m.index + m[0].length } };
  return null;
}
