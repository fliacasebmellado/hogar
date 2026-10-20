// Registros que llegan del servidor pueden haberse cargado a mano en una planilla: se completan los valores por
// defecto y las listas vacías para que la app nunca falle por un campo ausente.
import type { EntityName } from './types';

const ARRAYS: Partial<Record<EntityName, string[]>> = {
  tasks: ['collaboratorIds', 'attachmentIds'], events: ['participantIds', 'reminders', 'attachmentIds'], expenses: ['shoppingItemIds'],
  assets: ['photoIds'], documents: ['tags'], notes: ['personIds'], captures: ['attachmentIds', 'proposals', 'decisions'], profiles: ['aliases'],
};
const DEFAULTS: Partial<Record<EntityName, Record<string, any>>> = {
  tasks: { category: 'otras', priority: 'media', status: 'pendiente', title: '(sin título)' },
  events: { category: 'otros', rsvp: 'pendiente', allDay: false, syncCalendar: false },
  shoppingItems: { category: 'supermercado', priority: 'media', status: 'pendiente', listId: 'list-principal', name: '(sin nombre)' },
  payments: { category: 'otros', currency: 'ARS', status: 'pendiente', concept: '(sin concepto)' },
  expenses: { category: 'otros', currency: 'ARS', extraordinary: false, concept: '(sin concepto)', amount: 0 },
  repairs: { status: 'reportada' },
  documents: { category: 'otros', visibility: 'adultos' },
  profiles: { prefs: {}, active: true },
  investments: { kind: 'otro', currency: 'USD' },
  investmentContracts: { currency: 'ARS', status: 'vigente', kind: 'otro' },
  investmentTaxes: { currency: 'ARS', status: 'pendiente' },
  investmentWorks: { currency: 'ARS', status: 'pendiente' },
  healthNotes: { kind: 'indicacion', attachmentIds: [] },
  treatments: { status: 'activo', attachmentIds: [] },
  medications: { status: 'activo' },
  doctors: { personIds: [] },
  vaccinations: { status: 'pendiente' },
};

export function normalizeRecord(entity: EntityName, r: any): any {
  const out = { ...r, deleted: !!r.deleted, version: Number(r.version ?? 0) };
  for (const k of ARRAYS[entity] ?? []) if (!Array.isArray(out[k])) out[k] = out[k] == null || out[k] === '' ? [] : [out[k]];
  for (const [k, v] of Object.entries(DEFAULTS[entity] ?? {})) if (out[k] === undefined || out[k] === null || out[k] === '') out[k] = v;
  if (entity === 'expenses' && !out.date) out.date = (out.createdAt ?? new Date().toISOString()).slice(0, 10);
  return out;
}
