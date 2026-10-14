// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { addMonths, isValidISODate, startOfWeek } from '../src/domain/dates';
import { describeRecurrence, nextOccurrence, occurrencesBetween } from '../src/domain/recurrence';
import { extractAmounts, extractDates, extractRecurrence, extractTimes, findPeople, parseNumberAR } from '../src/ai/es';
import { parseShoppingItems, segment } from '../src/ai/rules';
import { productKey } from '../src/services/shopping';
import { effectivePaymentStatus, toCSV } from '../src/domain/finance';
import { checkFile, validateRecord } from '../src/domain/validation';
import { inQuietHours } from '../src/services/notifications';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../src/services/config';
import schema from '../shared/schema.json';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const NOW = new Date(2026, 9, 11, 10, 0); // domingo
const PEOPLE = [
  { id: 'n', name: 'Papá', role: 'adult' as const, aliases: ['papá'], active: true },
  { id: 's', name: 'Mamá', role: 'adult' as const, aliases: ['mamá'], active: true },
  { id: 't', name: 'Hijo', role: 'child' as const, aliases: [], active: true },
  { id: 'l', name: 'Hija', role: 'child' as const, aliases: [], active: true },
];

describe('fechas y repeticiones', () => {
  it('suma meses respetando fin de mes y valida fechas', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 2, 31)).toBe('2026-03-31');
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(startOfWeek('2026-10-11')).toBe('2026-10-05');
  });
  it('genera ocurrencias semanales, mensuales y con límite', () => {
    expect(occurrencesBetween({ freq: 'weekly', interval: 1, byWeekday: [1, 3] }, '2026-10-12', '2026-10-01', '2026-10-25')).toEqual(['2026-10-12', '2026-10-14', '2026-10-19', '2026-10-21']);
    expect(occurrencesBetween({ freq: 'monthly', interval: 1 }, '2026-01-31', '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occurrencesBetween({ freq: 'daily', interval: 1, count: 3 }, '2026-10-01', '2026-10-01', '2026-12-31')).toHaveLength(3);
    expect(nextOccurrence({ freq: 'daily', interval: 15 }, '2026-10-12', '2026-10-12')).toBe('2026-10-27');
    expect(occurrencesBetween({ freq: 'yearly', interval: 1, until: '2028-01-01' }, '2026-03-10', '2026-01-01', '2030-01-01')).toEqual(['2026-03-10', '2027-03-10']);
    expect(describeRecurrence({ freq: 'weekly', interval: 2, byWeekday: [1] })).toBe('Cada 2 semanas (lun)');
  });
});

describe('extracción en español', () => {
  const d = (s: string) => extractDates(s, NOW).map((h) => h.date ?? '?');
  it('fechas relativas y absolutas', () => {
    expect(d('hoy')).toEqual(['2026-10-11']);
    expect(d('mañana a la mañana')).toEqual(['2026-10-12']);
    expect(d('pasado mañana')).toEqual(['2026-10-13']);
    expect(d('el martes')).toEqual(['2026-10-13']);
    expect(d('el 15/10')).toEqual(['2026-10-15']);
    expect(d('el 3 de noviembre')).toEqual(['2026-11-03']);
    expect(d('vence el 20')).toEqual(['2026-10-20']);
    expect(d('el 5')).toEqual(['2026-11-05']); // día ya pasado → mes siguiente
    expect(d('en 10 días')).toEqual(['2026-10-21']);
    expect(d('15/01')).toEqual(['2027-01-15']); // muy en el pasado → año siguiente
    const sunday = extractDates('el domingo', NOW)[0];
    expect(sunday.ambiguity?.options).toHaveLength(2); // hoy es domingo: ¿hoy o el próximo?
  });
  it('horas, rangos y ambigüedad AM/PM', () => {
    expect(extractTimes('a las 18:30')[0].time).toBe('18:30');
    expect(extractTimes('a las 9 de la noche')[0].time).toBe('21:00');
    expect(extractTimes('18hs')[0].time).toBe('18:00');
    expect(extractTimes('de 14 a 16 hs')[0]).toMatchObject({ time: '14:00', endTime: '16:00' });
    expect(extractTimes('a las 5')[0].ambiguity).toBeTruthy();
    expect(extractTimes('a las 18 hay reunión')[0].time).toBe('18:00');
    expect(extractTimes('al mediodía')[0].time).toBe('12:00');
  });
  it('importes con formato argentino y monedas', () => {
    expect(parseNumberAR('12.500,50')).toBe(12500.5);
    expect(parseNumberAR('1.500')).toBe(1500);
    expect(parseNumberAR('1,5')).toBe(1.5);
    expect(extractAmounts('$ 45.000').map((a) => [a.amount, a.currency])).toEqual([[45000, 'ARS']]);
    expect(extractAmounts('USD 120').map((a) => [a.amount, a.currency])).toEqual([[120, 'USD']]);
    expect(extractAmounts('15 lucas')[0]).toMatchObject({ amount: 15000, assumedCurrency: true });
    expect(extractAmounts('pagar 3500', { bareNumbers: true })[0]).toMatchObject({ amount: 3500, assumedCurrency: true });
    expect(extractAmounts('el 15/10 a las 18', { bareNumbers: true })).toEqual([]);
  });
  it('personas, apodos y responsables', () => {
    expect(findPeople('le toca a Hijo', PEOPLE).responsibleId).toBe('t');
    expect(findPeople('papá lleva a Hija', PEOPLE).ids).toEqual(['n', 'l']);
    expect(findPeople('los chicos tienen acto', PEOPLE).ids).toEqual(['t', 'l']);
    expect(findPeople('alguien tiene que ir', PEOPLE).vagueSomeone).toBe(true);
    expect(findPeople('yo me encargo', PEOPLE, 's').responsibleId).toBe('s');
    const withFamily = [...PEOPLE, { id: 'f', name: 'Familia', role: 'family' as const, aliases: ['todos'], active: true }];
    expect(findPeople('cena con toda la familia', withFamily).ids).toEqual(['n', 's', 't', 'l']); // el perfil Familia no es una persona
  });
  it('repeticiones', () => {
    expect(extractRecurrence('todos los lunes y jueves')!.rule).toEqual({ freq: 'weekly', interval: 1, byWeekday: [1, 4] });
    expect(extractRecurrence('cada 3 meses')!.rule).toEqual({ freq: 'monthly', interval: 3 });
    expect(extractRecurrence('una vez por semana')!.rule.freq).toBe('weekly');
  });
  it('segmentación y listas', () => {
    expect(segment('Comprar:\n- leche\n- 2 kg de papas\n- media docena de huevos')).toHaveLength(1);
    expect(segment('Reunión mañana a las 18 y hay que llevar la autorización')).toHaveLength(2);
    expect(parseShoppingItems('comprar 1 paquete de fideos, yerba x 2 y lavandina').map((i) => [i.name, i.quantity, i.unit, i.category]))
      .toEqual([['Fideos', 1, 'paq', 'supermercado'], ['Yerba', 2, undefined, 'supermercado'], ['Lavandina', undefined, undefined, 'limpieza']]);
    expect(productKey('Papeles higiénicos')).toBe(productKey('papel higienico'));
  });
});

describe('reglas de negocio', () => {
  it('estado efectivo de pagos: vencido sin confirmar, pagado solo con confirmación', () => {
    const base: any = { status: 'pendiente', dueDate: '2026-10-01', concept: 'x', currency: 'ARS', category: 'otros' };
    expect(effectivePaymentStatus(base, '2026-10-11')).toBe('vencido');
    expect(effectivePaymentStatus({ ...base, status: 'pagado' }, '2026-10-11')).toBe('pagado');
    expect(effectivePaymentStatus({ ...base, dueDate: '2026-10-20' }, '2026-10-11')).toBe('pendiente');
  });
  it('CSV compatible con planillas y sin inyección de fórmulas', () => {
    const csv = toCSV([{ a: '=SUM(A1)', b: 'con, coma', c: -5 }], [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(`'=SUM(A1)`);
    expect(csv).toContain('"con, coma"');
    expect(csv.trim().endsWith(',-5')).toBe(true);
  });
  it('valida registros y tipos de archivo', () => {
    expect(validateRecord('payments', { id: 'p', concept: 'Luz', category: 'servicios', currency: 'ARS', status: 'pagado' })).toContain('Un pago marcado como pagado necesita fecha de pago.');
    expect(validateRecord('documents', { id: 'd', name: 'x', category: 'otros', visibility: 'publico' })[0]).toContain('Visibilidad');
    expect(checkFile('a.exe', 'application/x-msdownload', 10)).toContain('no admitido');
    expect(checkFile('audio.opus', 'audio/ogg', 10)).toBeNull();
    expect(checkFile('grande.pdf', 'application/pdf', 20 * 1024 * 1024)).toContain('supera');
  });
  it('horario de silencio de avisos', () => {
    expect(inQuietHours(DEFAULT_NOTIFICATION_SETTINGS, new Date(2026, 9, 11, 23, 0))).toBe(true);
    expect(inQuietHours(DEFAULT_NOTIFICATION_SETTINGS, new Date(2026, 9, 11, 12, 0))).toBe(false);
  });
  it('el esquema del backend (Schema.gs) coincide con shared/schema.json', () => {
    const gs = readFileSync(path.join(__dirname, '../apps-script/Schema.gs'), 'utf8');
    const parsed = JSON.parse(gs.slice(gs.indexOf('{'), gs.lastIndexOf('}') + 1));
    expect(parsed).toEqual(schema);
  });
});

describe('cambio de perfil: adultos libres, chicos con PIN de adulto', () => {
  it('aplica las reglas', async () => {
    const { pinHoldersFor } = await import('../src/domain/permissions');
    const P = (id: string, role: any, pin = false) => ({ id, name: id, role, active: true, pinHash: pin ? 'x' : undefined }) as any;
    const papa = P('papa', 'adult', true), mama = P('mama', 'adult', true), hijo = P('hijo', 'child'), hija = P('hija', 'child'), fam = P('fam', 'family');
    const all = [papa, mama, hijo, hija, fam];
    const ids = (l: any[]) => l.map((x) => x.id).sort();
    expect(pinHoldersFor(papa, mama, all)).toEqual([]); // adulto → adulto: libre
    expect(pinHoldersFor(mama, hijo, all)).toEqual([]); // adulto → chico: libre
    expect(pinHoldersFor(fam, papa, all)).toEqual([]); // Familia → adulto: libre
    expect(ids(pinHoldersFor(hijo, hija, all))).toEqual(['mama', 'papa']); // chico → hermano: PIN de adulto
    expect(ids(pinHoldersFor(hijo, fam, all))).toEqual(['mama', 'papa']); // chico → Familia: PIN de adulto
    expect(ids(pinHoldersFor(hijo, papa, all))).toEqual(['mama', 'papa']);
    expect(pinHoldersFor(undefined, hijo, all)).toEqual([]); // pantalla inicial: chico entra directo
    expect(ids(pinHoldersFor(undefined, papa, all))).toEqual(['papa']);
    expect(pinHoldersFor(hijo, hija, [P('papa', 'adult'), hijo, hija])).toEqual([]); // sin PIN cargado no se puede bloquear
  });
});
