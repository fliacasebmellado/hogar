// Salud: horarios de medicación, lectura de indicaciones médicas (receta en foto o texto) y alarmas para el calendario.
import type { DoseLog, Medication, Treatment } from '../domain/types';
import type { Repo } from '../db/repo';
import { addDays } from '../domain/dates';

export const NOTE_KINDS: { id: string; label: string; icon: string }[] = [
  { id: 'plan', label: 'Plan para una crisis', icon: '🚨' },
  { id: 'indicacion', label: 'Indicación general', icon: '📋' },
  { id: 'diagnostico', label: 'Diagnóstico', icon: '🩺' },
  { id: 'alergia', label: 'Alergia', icon: '⚠️' },
  { id: 'control', label: 'Control / estudio', icon: '🔬' },
  { id: 'vacuna', label: 'Vacuna', icon: '💉' },
];
export const noteKind = (id?: string) => NOTE_KINDS.find((k) => k.id === id) ?? NOTE_KINDS[1];

// ---------- Horarios ----------
const pad = (n: number) => String(n).padStart(2, '0');
/** "AAAA-MM-DDTHH:mm" en hora local. */
export function localStamp(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export const parseStamp = (s: string) => { const [d, t = '00:00'] = s.split('T'); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return new Date(y, m - 1, dd, h, mi); };

/** Horarios del día que resultan de "cada X horas" a partir de una hora ("08:00" cada 8 → 08:00, 16:00, 00:00). */
export function timesFromInterval(start: string, everyHours: number): string[] {
  if (!everyHours || everyHours > 24 || 24 % everyHours !== 0) return [];
  const [h, m] = start.split(':').map(Number);
  return Array.from({ length: 24 / everyHours }, (_, k) => `${pad((h + k * everyHours) % 24)}:${pad(m)}`).sort();
}

/**
 * Todas las tomas de un medicamento ("AAAA-MM-DDTHH:mm"), ordenadas.
 * - Con horarios fijos: cada día desde la primera toma, durante `days` días (si la primera toma es a media mañana, ese
 *   día solo cuentan los horarios posteriores).
 * - Si no: cada `everyHours` desde la primera toma hasta completar `days` días.
 * Sin días indicados se calculan 30 días como máximo. "Solo si hace falta" no tiene tomas programadas.
 */
export function doseSchedule(m: Pick<Medication, 'firstDose' | 'everyHours' | 'days' | 'times' | 'asNeeded' | 'status'>): string[] {
  if (m.asNeeded || !m.firstDose || m.status === 'suspendido') return [];
  const start = parseStamp(m.firstDose);
  const days = Math.min(m.days && m.days > 0 ? m.days : 30, 120);
  const end = new Date(start.getTime() + days * 24 * 3600 * 1000);
  const out: string[] = [];
  if (m.times?.length) {
    const day0 = m.firstDose.slice(0, 10);
    for (let k = 0; k <= days; k++) {
      const d = addDays(day0, k);
      for (const t of [...m.times].sort()) {
        const s = `${d}T${t}`;
        const at = parseStamp(s);
        if (at >= start && at < end) out.push(s);
      }
    }
    return out;
  }
  if (!m.everyHours) return [m.firstDose];
  for (let t = start.getTime(); t < end.getTime() && out.length < 1000; t += m.everyHours * 3600 * 1000) out.push(localStamp(new Date(t)));
  return out;
}

export interface DoseItem { med: Medication; treatment?: Treatment; plannedAt: string; log?: DoseLog; status: 'dada' | 'salteada' | 'atrasada' | 'proxima' | 'pendiente' }

/** Tomas entre dos momentos (para "Hoy" y para los avisos), con su estado. */
export function dosesBetween(meds: Medication[], logs: DoseLog[], treatments: Treatment[], from: Date, to: Date, now = new Date()): DoseItem[] {
  const out: DoseItem[] = [];
  for (const med of meds) {
    if (med.deleted || med.status !== 'activo') continue;
    const tr = treatments.find((t) => t.id === med.treatmentId);
    if (tr && (tr.deleted || tr.status === 'terminado')) continue;
    for (const s of doseSchedule(med)) {
      const at = parseStamp(s);
      if (at < from || at >= to) continue;
      const log = logs.find((l) => !l.deleted && l.medicationId === med.id && l.plannedAt === s);
      const mins = (at.getTime() - now.getTime()) / 60000;
      const status: DoseItem['status'] = log ? (log.skipped ? 'salteada' : 'dada') : mins < -30 ? 'atrasada' : mins <= 60 ? 'proxima' : 'pendiente';
      out.push({ med, treatment: tr, plannedAt: s, log, status });
    }
  }
  return out.sort((a, b) => a.plannedAt.localeCompare(b.plannedAt));
}

/** Cuántas tomas lleva y cuántas son en total (para "3 de 21"). */
export function progress(med: Medication, logs: DoseLog[]) {
  const all = doseSchedule(med);
  const done = all.filter((s) => logs.some((l) => !l.deleted && l.medicationId === med.id && l.plannedAt === s)).length;
  return { done, total: all.length, last: all[all.length - 1] };
}

// ---------- Lectura de indicaciones médicas ----------
export interface ParsedMed { name: string; dose?: string; everyHours?: number; days?: number; asNeeded?: boolean; notes?: string; source: string; issues: string[] }
export interface ParsedPrescription { diagnosis?: string; doctor?: string; meds: ParsedMed[]; unread: string[] }

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const UNIT = '(mg|mcg|g|ml|cc|gotas?|gts|puff|puffs|disparos?|inhalaciones?|comprimidos?|comp|cp|caps(?:ulas?)?|sobres?|cucharad(?:a|ita)s?|ampollas?|ui|u)';
const QTY = '(\\d+(?:[.,]\\d+)?|\\d\\/\\d|½|medio|media|un|una|uno|dos|tres)';
const WORD_NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, diez: 10, catorce: 14 };
const num = (s: string) => WORD_NUM[s] ?? Number(s.replace(',', '.'));

function frequency(f: string): number | undefined {
  let m = f.match(/cada\s*(\d{1,2})\s*(?:h|hs|hrs|horas?)\b/) || f.match(/c\s*\/\s*(\d{1,2})\s*(?:h|hs|hrs|horas?)?\b/) || f.match(/\bq\s*(\d{1,2})\s*h\b/);
  if (m) return Number(m[1]);
  m = f.match(/(\d|una|un|dos|tres|cuatro)\s*(?:veces|vez)\s*(?:al|por|x)\s*dia/);
  if (m) { const n = num(m[1]); return n ? Math.round(24 / n) : undefined; }
  if (/\b(una vez al dia|1 vez al dia|por dia|diario|diaria)\b/.test(f)) return 24;
  if (/\bcada\s*(\d{1,2})\b/.test(f)) return Number(f.match(/\bcada\s*(\d{1,2})\b/)![1]);
  return undefined;
}
function duration(f: string): number | undefined {
  const m = f.match(/(?:por|durante|x)\s*(\d{1,2}|[a-z]+)\s*(?:dias|d)\b/) || f.match(/\b(\d{1,2})\s*dias\b/);
  if (m) { const n = num(m[1]); return Number.isFinite(n) && n > 0 ? n : undefined; }
  if (/por una semana|durante una semana|x 1 semana/.test(f)) return 7;
  if (/(?:por|durante)\s*(\d|dos)\s*semanas/.test(f)) return num(f.match(/(?:por|durante)\s*(\d|dos)\s*semanas/)![1]) * 7;
  return undefined;
}

/**
 * Interpreta el texto de una indicación médica (escrita o leída de una foto). Cada renglón con dosis o frecuencia es un
 * medicamento. Lo que no se entiende queda en `unread` y cada medicamento lista lo que falta revisar.
 */
export function parsePrescription(text: string): ParsedPrescription {
  const out: ParsedPrescription = { meds: [], unread: [] };
  const lines = text.split(/\n|;/).map((l) => l.replace(/^[\s\-•*·>]+|^\d+\s*[).-]\s*/g, '').trim()).filter(Boolean);
  for (const line of lines) {
    const f = fold(line);
    const dx = line.match(/^(?:dx|diagn[oó]stico|diag)\s*[:.-]\s*(.+)$/i);
    if (dx) { out.diagnosis = dx[1].trim(); continue; }
    const dr = line.match(/\b(?:dra?\.?|doctor(?:a)?)\s+([A-ZÁÉÍÓÚ][\wáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚ][\wáéíóúñ]+)?)/i);
    if (dr && !frequency(f)) { out.doctor = line.trim(); continue; }
    const doseM = f.match(new RegExp(`${QTY}\\s*${UNIT}\\b`));
    const every = frequency(f);
    const days = duration(f);
    const asNeeded = /\b(sos|si hay|si tiene|en caso de|si fiebre|si dolor|si es necesario|segun necesidad)\b/.test(f);
    if (!doseM && !every && !asNeeded) { if (line.length > 2) out.unread.push(line); continue; }
    // Nombre: lo que está antes de la dosis o de la frecuencia.
    const cut = Math.min(...[doseM?.index, f.search(/\b(cada|c\/|tomar|dar|administrar|\d+\s*veces)\b/)].filter((x): x is number => typeof x === 'number' && x >= 0), line.length);
    let name = line.slice(0, cut).replace(/[:,.-]+$/, '').replace(/^(dar|tomar|administrar|aplicar)\s+/i, '').trim();
    if (!name) name = line.split(/\s+/).slice(0, 2).join(' ');
    name = name.charAt(0).toUpperCase() + name.slice(1);
    const dose = doseM ? line.slice(doseM.index!, doseM.index! + doseM[0].length).trim() : undefined;
    const med: ParsedMed = { name, dose, everyHours: every, days, asNeeded, source: line, issues: [] };
    const rest = line.slice(cut).replace(dose ?? '', '').trim();
    if (rest && rest.length > 3) med.notes = rest;
    if (!dose) med.issues.push('Falta la dosis');
    if (!asNeeded && !every) med.issues.push('Falta cada cuántas horas');
    if (!asNeeded && !days) med.issues.push('Falta por cuántos días');
    if (every && (every < 1 || every > 72)) med.issues.push('Revisá la frecuencia');
    out.meds.push(med);
  }
  return out;
}

// ---------- Alarmas para el calendario del celular (.ics) ----------
const icsEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const icsStamp = (s: string) => s.replace(/[-:]/g, '') + '00';

/**
 * Archivo de calendario con una cita por toma y una alarma al momento de darla. Se abre con Google Calendar o el
 * Calendario del iPhone y suena aunque la app esté cerrada. Cada toma tiene un identificador fijo: si se vuelve a
 * importar, Google no la duplica.
 */
export function buildDoseCalendar(items: { med: Medication; personName?: string; times: string[] }[], minutesBefore = 0): string {
  const now = icsStamp(localStamp(new Date()));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hogar//Salud//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Hogar · Medicación'];
  for (const { med, personName, times } of items) {
    for (const s of times) {
      const start = icsStamp(s);
      const endD = new Date(parseStamp(s).getTime() + 15 * 60000);
      const title = `💊 ${med.name}${med.dose ? ` ${med.dose}` : ''}${personName ? ` · ${personName}` : ''}`;
      lines.push('BEGIN:VEVENT', `UID:hogar-${med.id}-${start}@hogar`, `DTSTAMP:${now}`, `DTSTART:${start}`, `DTEND:${icsStamp(localStamp(endD))}`,
        `SUMMARY:${icsEsc(title)}`, `DESCRIPTION:${icsEsc([med.notes, 'Marcala como dada en Hogar → Salud.'].filter(Boolean).join('\n'))}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(title)}`, `TRIGGER:-PT${minutesBefore}M`, 'END:VALARM', 'END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/** Datos de salud para los avisos (tomas y vacunas). */
export async function loadHealth(repo: Repo) {
  const [medications, doseLogs, treatments, vaccinations, profiles] = await Promise.all([repo.list('medications'), repo.list('doseLogs'), repo.list('treatments'), repo.list('vaccinations'), repo.list('profiles')]);
  return { medications, doseLogs, treatments, vaccinations, profiles };
}
