// Validaciones de negocio previas a guardar. Devuelven mensajes legibles; vacío = válido.
import type { EntityName } from './types';
import { isValidISODate, isValidISODateTime } from './dates';

type Rule = (r: any) => string | null;

const required = (field: string, label: string): Rule => (r) =>
  r[field] === undefined || r[field] === null || String(r[field]).trim() === '' ? `Falta ${label}.` : null;
const optDate = (field: string, label: string): Rule => (r) => (r[field] && !isValidISODate(r[field]) ? `${label} no es una fecha válida.` : null);
const oneOf = (field: string, values: string[], label: string): Rule => (r) =>
  r[field] !== undefined && r[field] !== null && r[field] !== '' && !values.includes(r[field]) ? `${label} inválido: ${r[field]}.` : null;
const positive = (field: string, label: string, isRequired = false): Rule => (r) => {
  const v = r[field];
  if (v === undefined || v === null || v === '') return isRequired ? `Falta ${label}.` : null;
  return typeof v !== 'number' || !isFinite(v) || v < 0 ? `${label} debe ser un número positivo.` : null;
};
const maxLen = (field: string, n: number, label: string): Rule => (r) => (r[field] && String(r[field]).length > n ? `${label} supera ${n} caracteres.` : null);

const PRIORITIES = ['baja', 'media', 'alta'];

const RULES: Partial<Record<EntityName, Rule[]>> = {
  profiles: [required('name', 'el nombre'), oneOf('role', ['adult', 'child', 'family'], 'Rol'), maxLen('name', 40, 'El nombre')],
  tasks: [
    required('title', 'el título'), maxLen('title', 200, 'El título'), required('category', 'la categoría'),
    oneOf('status', ['pendiente', 'en_curso', 'bloqueada', 'completada'], 'Estado'), oneOf('priority', PRIORITIES, 'Prioridad'),
    optDate('dueDate', 'La fecha límite'),
    (r) => (r.dueTime && !/^\d{2}:\d{2}$/.test(r.dueTime) ? 'La hora no es válida.' : null),
    (r) => (r.recurrence && !r.dueDate && !r.occurrenceDate ? 'Una tarea recurrente necesita fecha de inicio.' : null),
  ],
  events: [
    required('title', 'el título'), required('start', 'la fecha de inicio'), required('category', 'la categoría'),
    (r) => (r.start && !(r.allDay ? isValidISODate(r.start.slice(0, 10)) : isValidISODateTime(r.start)) ? 'La fecha/hora de inicio no es válida.' : null),
    (r) => (r.end && !(isValidISODateTime(r.end) || isValidISODate(r.end)) ? 'La fecha/hora de fin no es válida.' : null),
    (r) => (r.end && r.start && r.end < r.start ? 'El fin no puede ser anterior al inicio.' : null),
    oneOf('rsvp', ['confirmado', 'pendiente', 'rechazado'], 'Confirmación'),
  ],
  shoppingLists: [required('name', 'el nombre de la lista')],
  shoppingItems: [
    required('name', 'el producto'), required('listId', 'la lista'), positive('quantity', 'La cantidad'),
    oneOf('status', ['pendiente', 'comprado', 'descartado'], 'Estado'), oneOf('priority', PRIORITIES, 'Prioridad'),
  ],
  payments: [
    required('concept', 'el concepto'), required('category', 'la categoría'), positive('amount', 'El importe'),
    required('currency', 'la moneda'), oneOf('status', ['pendiente', 'programado', 'pagado', 'vencido'], 'Estado'),
    optDate('dueDate', 'El vencimiento'), optDate('issueDate', 'La emisión'), optDate('paidDate', 'La fecha de pago'),
    (r) => (r.status === 'pagado' && !r.paidDate ? 'Un pago marcado como pagado necesita fecha de pago.' : null),
    (r) => (!r.isSeries && !r.dueDate && r.status !== 'pagado' ? 'Falta la fecha de vencimiento.' : null),
  ],
  expenses: [
    required('date', 'la fecha'), optDate('date', 'La fecha'), positive('amount', 'El importe', true), required('currency', 'la moneda'),
    required('category', 'la categoría'), required('concept', 'el concepto'),
  ],
  rooms: [required('name', 'el nombre del ambiente')],
  providers: [required('name', 'el nombre del proveedor')],
  assets: [required('name', 'el nombre'), required('category', 'la categoría'), optDate('purchaseDate', 'La fecha de compra'), optDate('warrantyUntil', 'La garantía')],
  maintenance: [required('title', 'el título'), required('category', 'la categoría'), (r) => (!r.recurrence ? 'Definí la frecuencia.' : null)],
  repairs: [required('title', 'el título'), optDate('reportedAt', 'La fecha'), oneOf('status', ['reportada', 'en_curso', 'resuelta'], 'Estado'), positive('cost', 'El costo')],
  documents: [required('name', 'el nombre'), required('category', 'la categoría'), oneOf('visibility', ['familia', 'adultos', 'personal'], 'Visibilidad'), optDate('date', 'La fecha'), optDate('expiresAt', 'El vencimiento')],
  notes: [required('title', 'el título')],
  investments: [required('name', 'el nombre'), positive('purchaseValue', 'El valor de compra'), optDate('purchaseDate', 'La fecha de compra')],
  investmentContracts: [required('investmentId', 'la inversión'), required('kind', 'el tipo de contrato'), optDate('startDate', 'El inicio'), optDate('endDate', 'El fin'),
    positive('amount', 'El importe'), (r) => (r.startDate && r.endDate && r.endDate < r.startDate ? 'El fin no puede ser anterior al inicio.' : null)],
  investmentTaxes: [required('investmentId', 'la inversión'), required('tax', 'el impuesto'), optDate('dueDate', 'El vencimiento'), optDate('paidDate', 'La fecha de pago'),
    positive('amount', 'El importe'), (r) => (r.status === 'pagado' && !r.paidDate ? 'Indicá la fecha de pago.' : null)],
  investmentWorks: [required('investmentId', 'la inversión'), required('title', 'el trabajo'), optDate('date', 'La fecha'), positive('cost', 'El costo')],
  healthNotes: [required('title', 'el título'), optDate('date', 'La fecha')],
  treatments: [required('personId', 'para quién es'), optDate('startDate', 'El inicio')],
  medications: [required('treatmentId', 'el tratamiento'), required('name', 'el medicamento'), positive('everyHours', 'Cada cuántas horas'), positive('days', 'Los días'),
    (r) => (r.everyHours != null && (r.everyHours < 1 || r.everyHours > 72) ? 'Cada cuántas horas debe estar entre 1 y 72.' : null),
    (r) => (r.firstDose && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.firstDose) ? 'La primera toma necesita fecha y hora.' : null)],
  doseLogs: [required('medicationId', 'el medicamento'), required('plannedAt', 'la hora prevista')],
  doctors: [required('name', 'el nombre')],
  healthCards: [required('personId', 'de quién es'), positive('weightKg', 'El peso'), positive('heightCm', 'La altura'), optDate('measuredAt', 'La fecha de medición')],
  vaccinations: [required('vaccine', 'la vacuna'), optDate('dueDate', 'La fecha'), optDate('appliedDate', 'La fecha de aplicación')],
};

export function validateRecord(entity: EntityName, record: any): string[] {
  const errors: string[] = [];
  if (!record || typeof record !== 'object') return ['Registro vacío.'];
  if (!record.id || typeof record.id !== 'string') errors.push('Falta el identificador.');
  for (const rule of RULES[entity] ?? []) {
    const e = rule(record);
    if (e) errors.push(e);
  }
  return errors;
}

export class ValidationError extends Error {
  constructor(public errors: string[]) { super(errors.join(' ')); }
}

// ---- Archivos admitidos ----
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const ALLOWED_MIME = [
  /^image\/(png|jpe?g|webp|gif|heic|heif)$/, /^application\/pdf$/, /^audio\//, /^video\/(mp4|webm|ogg)$/, /^text\/plain$/,
  /^application\/vnd\.openxmlformats-officedocument\./, /^application\/msword$/, /^application\/vnd\.ms-excel$/,
];
const EXT_MIME: Record<string, string> = {
  ogg: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac', webm: 'audio/webm',
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', txt: 'text/plain',
};
export function guessMime(name: string, given?: string): string {
  if (given && given !== 'application/octet-stream') return given;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? given ?? 'application/octet-stream';
}
export function checkFile(name: string, mime: string, size: number): string | null {
  if (size > MAX_FILE_BYTES) return `"${name}" supera el máximo de ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
  if (size === 0) return `"${name}" está vacío.`;
  if (!ALLOWED_MIME.some((re) => re.test(mime))) return `Tipo de archivo no admitido (${mime}).`;
  return null;
}
