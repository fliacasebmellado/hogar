// Calendario Nacional de Vacunación de Argentina (Ministerio de Salud de la Nación) para chicos y adolescentes.
// Es una referencia para recordar: el calendario puede cambiar y hay vacunas que dependen de la zona (fiebre amarilla)
// o de indicación médica. Siempre confirmar con el pediatra.
import type { Repo } from '../db/repo';
import type { ID, ISODate, Profile, Vaccination } from '../domain/types';
import { addDays, diffDays, today } from '../domain/dates';

export const VACCINE_SOURCE = 'Calendario Nacional de Vacunación · Ministerio de Salud de la Nación (Argentina)';
export const VACCINE_SOURCE_URL = 'https://www.argentina.gob.ar/salud/vacunas';

export interface VaccineStep { id: string; vaccine: string; dose: string; months: number; age: string; note?: string }

export const VACCINE_SCHEDULE: VaccineStep[] = [
  { id: 'bcg', vaccine: 'BCG', dose: 'Única', months: 0, age: 'Recién nacido' },
  { id: 'hb-rn', vaccine: 'Hepatitis B', dose: 'Dosis neonatal', months: 0, age: 'Recién nacido' },
  { id: 'neumo-1', vaccine: 'Neumococo conjugada', dose: '1.ª dosis', months: 2, age: '2 meses' },
  { id: 'quintuple-1', vaccine: 'Quíntuple (pentavalente)', dose: '1.ª dosis', months: 2, age: '2 meses' },
  { id: 'ipv-1', vaccine: 'Polio IPV (Salk)', dose: '1.ª dosis', months: 2, age: '2 meses' },
  { id: 'rota-1', vaccine: 'Rotavirus', dose: '1.ª dosis', months: 2, age: '2 meses' },
  { id: 'mening-1', vaccine: 'Meningococo', dose: '1.ª dosis', months: 3, age: '3 meses' },
  { id: 'neumo-2', vaccine: 'Neumococo conjugada', dose: '2.ª dosis', months: 4, age: '4 meses' },
  { id: 'quintuple-2', vaccine: 'Quíntuple (pentavalente)', dose: '2.ª dosis', months: 4, age: '4 meses' },
  { id: 'ipv-2', vaccine: 'Polio IPV (Salk)', dose: '2.ª dosis', months: 4, age: '4 meses' },
  { id: 'rota-2', vaccine: 'Rotavirus', dose: '2.ª dosis', months: 4, age: '4 meses' },
  { id: 'mening-2', vaccine: 'Meningococo', dose: '2.ª dosis', months: 5, age: '5 meses' },
  { id: 'quintuple-3', vaccine: 'Quíntuple (pentavalente)', dose: '3.ª dosis', months: 6, age: '6 meses' },
  { id: 'ipv-3', vaccine: 'Polio IPV (Salk)', dose: '3.ª dosis', months: 6, age: '6 meses' },
  { id: 'gripe-1', vaccine: 'Antigripal', dose: 'Anual (6 a 24 meses)', months: 6, age: '6 meses', note: 'Cada año, en temporada de gripe, hasta los 2 años.' },
  { id: 'neumo-r', vaccine: 'Neumococo conjugada', dose: 'Refuerzo', months: 12, age: '12 meses' },
  { id: 'hepa', vaccine: 'Hepatitis A', dose: 'Única', months: 12, age: '12 meses' },
  { id: 'tv-1', vaccine: 'Triple viral (sarampión, rubéola, paperas)', dose: '1.ª dosis', months: 12, age: '12 meses' },
  { id: 'mening-r', vaccine: 'Meningococo', dose: 'Refuerzo', months: 15, age: '15 meses' },
  { id: 'vari-1', vaccine: 'Varicela', dose: '1.ª dosis', months: 15, age: '15 meses' },
  { id: 'quintuple-r', vaccine: 'Quíntuple (pentavalente)', dose: 'Refuerzo', months: 15, age: '15 a 18 meses' },
  { id: 'fa-1', vaccine: 'Fiebre amarilla', dose: '1.ª dosis', months: 18, age: '18 meses', note: 'Solo en zonas de riesgo o si viajan a ellas.' },
  { id: 'ipv-r', vaccine: 'Polio IPV (Salk)', dose: 'Refuerzo', months: 60, age: '5 años (ingreso escolar)' },
  { id: 'tv-2', vaccine: 'Triple viral (sarampión, rubéola, paperas)', dose: '2.ª dosis', months: 60, age: '5 años (ingreso escolar)' },
  { id: 'dtp-r', vaccine: 'Triple bacteriana celular (DTP)', dose: 'Refuerzo', months: 60, age: '5 años (ingreso escolar)' },
  { id: 'vari-2', vaccine: 'Varicela', dose: '2.ª dosis', months: 60, age: '5 años (ingreso escolar)' },
  { id: 'vph', vaccine: 'VPH (virus del papiloma humano)', dose: 'Única', months: 132, age: '11 años' },
  { id: 'dtpa-11', vaccine: 'Triple bacteriana acelular (dTpa)', dose: 'Refuerzo', months: 132, age: '11 años' },
  { id: 'mening-11', vaccine: 'Meningococo ACWY', dose: 'Única', months: 132, age: '11 años' },
  { id: 'fa-11', vaccine: 'Fiebre amarilla', dose: 'Refuerzo', months: 132, age: '11 años', note: 'Solo en zonas de riesgo.' },
  { id: 'dt-21', vaccine: 'Doble bacteriana (dT)', dose: 'Refuerzo (cada 10 años)', months: 252, age: '21 años', note: 'Después, un refuerzo cada 10 años.' },
];

/** Fecha en que corresponde una vacuna: nacimiento + meses de edad. */
export function dueDateFor(birth: ISODate, months: number): ISODate {
  const [y, m, d] = birth.split('-').map(Number);
  const dt = new Date(y, m - 1 + months, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
export const hasFullBirthDate = (p?: Pick<Profile, 'birthDate'>) => !!p?.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(p.birthDate);

/**
 * Crea (una sola vez, con un ID fijo por persona y vacuna) las filas del calendario de cada chico que tenga fecha de
 * nacimiento completa: así la planilla "Salud - Vacunas" muestra el calendario entero y se van marcando como aplicadas.
 */
export async function ensureVaccinePlan(repo: Repo, profiles: Profile[], by?: ID): Promise<number> {
  let n = 0;
  for (const p of profiles.filter((x) => x.active && x.role === 'child' && hasFullBirthDate(x))) {
    for (const s of VACCINE_SCHEDULE) {
      const id = `vac-${p.id}-${s.id}`;
      const due = dueDateFor(p.birthDate!, s.months);
      const cur = await repo.get('vaccinations', id);
      if (cur) { if (cur.dueDate !== due && cur.status === 'pendiente') await repo.update('vaccinations', id, { dueDate: due }, { by, skipHistory: true }); continue; }
      await repo.create('vaccinations', { id, personId: p.id, scheduleId: s.id, vaccine: s.vaccine, dose: s.dose, ageLabel: s.age, dueDate: due, status: 'pendiente', notes: s.note } as any, { by, origin: 'sistema', skipHistory: true });
      n++;
    }
  }
  return n;
}

export type VaccineState = 'aplicada' | 'no_corresponde' | 'proxima' | 'toca_ahora' | 'atrasada' | 'sin_registrar' | 'futura';
/**
 * Estado de una vacuna:
 * - "toca ahora": ya cumplió la edad hace menos de un año y no está marcada.
 * - "próxima": le toca en los próximos 60 días.
 * - "sin registrar": correspondía hace más de un año: seguramente se aplicó, falta marcarla mirando el carnet (no avisa).
 */
export function vaccineState(v: Pick<Vaccination, 'status' | 'dueDate'>, ref: ISODate = today()): VaccineState {
  if (v.status === 'aplicada') return 'aplicada';
  if (v.status === 'no corresponde') return 'no_corresponde';
  if (!v.dueDate) return 'futura';
  const d = diffDays(v.dueDate, ref);
  if (d > 60) return 'futura';
  if (d > 0) return 'proxima';
  if (d >= -365) return 'toca_ahora';
  return 'sin_registrar';
}
export const VACCINE_STATE_LABEL: Record<VaccineState, string> = {
  aplicada: 'Aplicada', no_corresponde: 'No corresponde', proxima: 'Próxima', toca_ahora: 'Le toca', atrasada: 'Atrasada', sin_registrar: 'Sin registrar', futura: 'Más adelante',
};

/** Marca como aplicadas todas las que correspondían hasta hoy (después de revisar el carnet). */
export async function markPastAsApplied(repo: Repo, list: Vaccination[], by?: ID) {
  const ref = today();
  await repo.tx(async () => {
    for (const v of list) if (v.status === 'pendiente' && v.dueDate && v.dueDate <= ref) await repo.update('vaccinations', v.id, { status: 'aplicada' }, { by });
  });
}
export { addDays };
