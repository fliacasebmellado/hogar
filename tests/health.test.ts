// Salud: lectura de indicaciones, horarios de medicación y alarmas.
import { describe, it, expect } from 'vitest';
import { buildDoseCalendar, doseSchedule, dosesBetween, parsePrescription, timesFromInterval } from '../src/services/health';

describe('lectura de indicaciones médicas', () => {
  it('entiende una receta típica de guardia', () => {
    const r = parsePrescription(`Dx: Bronquitis obstructiva
1) Amoxicilina 500 mg 1 comprimido cada 8 horas por 7 días
2) Salbutamol 2 puff c/4 hs x 5 días
3) Prednisona 20 mg una vez al día durante 3 días
4) Ibuprofeno 5 ml si fiebre
Dra. Gómez`);
    expect(r.diagnosis).toBe('Bronquitis obstructiva');
    expect(r.doctor).toContain('Gómez');
    expect(r.meds.map((m) => [m.name, m.dose, m.everyHours, m.days, !!m.asNeeded])).toEqual([
      ['Amoxicilina', '500 mg', 8, 7, false],
      ['Salbutamol', '2 puff', 4, 5, false],
      ['Prednisona', '20 mg', 24, 3, false],
      ['Ibuprofeno', '5 ml', undefined, undefined, true],
    ]);
    expect(r.meds.every((m) => m.issues.length === 0)).toBe(true);
  });
  it('marca lo que falta para revisar y guarda lo que no entiende', () => {
    const r = parsePrescription('Cetirizina gotas cada 12 horas\nreposo y abundante líquido');
    expect(r.meds[0].name).toBe('Cetirizina gotas');
    expect(r.meds[0].issues).toEqual(expect.arrayContaining(['Falta la dosis', 'Falta por cuántos días']));
    expect(r.unread).toEqual(['reposo y abundante líquido']);
  });
  it('3 veces por día = cada 8 horas', () => {
    expect(parsePrescription('Paracetamol 10 ml 3 veces por día por 4 días').meds[0]).toMatchObject({ everyHours: 8, days: 4, dose: '10 ml' });
  });
});

describe('horarios', () => {
  it('cada 8 horas por 2 días = 6 tomas', () => {
    expect(doseSchedule({ firstDose: '2026-10-20T09:00', everyHours: 8, days: 2, status: 'activo' })).toEqual([
      '2026-10-20T09:00', '2026-10-20T17:00', '2026-10-21T01:00', '2026-10-21T09:00', '2026-10-21T17:00', '2026-10-22T01:00']);
  });
  it('horarios acomodados a mano (para que coincidan con otro medicamento)', () => {
    expect(timesFromInterval('09:00', 8)).toEqual(['01:00', '09:00', '17:00']);
    expect(doseSchedule({ firstDose: '2026-10-20T13:00', times: ['08:00', '14:00', '20:00'], days: 1, status: 'activo' })).toEqual(['2026-10-20T14:00', '2026-10-20T20:00', '2026-10-21T08:00']);
  });
  it('"solo si hace falta" no programa tomas; estado de cada toma', () => {
    expect(doseSchedule({ firstDose: '2026-10-20T09:00', asNeeded: true, status: 'activo' })).toEqual([]);
    const med: any = { id: 'm1', treatmentId: 't1', name: 'Amoxicilina', firstDose: '2026-10-20T08:00', everyHours: 8, days: 1, status: 'activo' };
    const logs: any[] = [{ id: 'l1', medicationId: 'm1', plannedAt: '2026-10-20T08:00', takenAt: '2026-10-20T08:05' }];
    const items = dosesBetween([med], logs, [{ id: 't1', status: 'activo' } as any], new Date(2026, 9, 20), new Date(2026, 9, 21), new Date(2026, 9, 20, 15, 30));
    expect(items.map((i) => [i.plannedAt.slice(11), i.status])).toEqual([['08:00', 'dada'], ['16:00', 'proxima']]);
  });
  it('genera alarmas para el calendario con identificador fijo por toma', () => {
    const ics = buildDoseCalendar([{ med: { id: 'm1', name: 'Amoxicilina', dose: '500 mg' } as any, personName: 'Hija', times: ['2026-10-20T08:00'] }]);
    expect(ics).toContain('DTSTART:20261020T080000');
    expect(ics).toContain('UID:hogar-m1-20261020T080000@hogar');
    expect(ics).toContain('BEGIN:VALARM');
  });
});

describe('vacunas', () => {
  it('fecha que corresponde según la edad y estados', async () => {
    const { dueDateFor, vaccineState } = await import('../src/services/vaccines');
    expect(dueDateFor('2015-03-10', 132)).toBe('2026-03-10'); // 11 años
    expect(vaccineState({ status: 'pendiente', dueDate: '2026-10-01' }, '2026-10-20')).toBe('toca_ahora');
    expect(vaccineState({ status: 'pendiente', dueDate: '2026-11-15' }, '2026-10-20')).toBe('proxima');
    expect(vaccineState({ status: 'pendiente', dueDate: '2020-01-01' }, '2026-10-20')).toBe('sin_registrar'); // vieja: no avisa
    expect(vaccineState({ status: 'aplicada', dueDate: '2026-10-01' }, '2026-10-20')).toBe('aplicada');
  });
  it('arma el calendario completo de cada chico una sola vez (ID fijo)', async () => {
    const { Repo } = await import('../src/db/repo');
    const { ensureVaccinePlan, VACCINE_SCHEDULE } = await import('../src/services/vaccines');
    const { uuid } = await import('../src/domain/ids');
    const repo = await Repo.open('vac-' + uuid());
    const kid: any = { id: 'k1', name: 'Hijo', role: 'child', active: true, birthDate: '2015-03-10', aliases: [], prefs: {} };
    await repo.create('profiles', kid);
    expect(await ensureVaccinePlan(repo, [kid])).toBe(VACCINE_SCHEDULE.length);
    expect(await ensureVaccinePlan(repo, [kid])).toBe(0);
    expect((await repo.get('vaccinations', 'vac-k1-vph'))).toMatchObject({ dueDate: '2026-03-10', status: 'pendiente', vaccine: expect.stringContaining('VPH') });
  });
});
