// Reglas comunes a cualquier procesador (reglas locales o modelo opcional): campos obligatorios,
// posibles duplicados y relaciones con registros existentes. Se recalculan en cada edición de la propuesta.
import type { ExistingIndex, Proposal } from './types';
import { productKey } from '../services/shopping';
import { norm } from '../services/tasks';
import { diffDays, isValidISODate, isValidISODateTime } from '../domain/dates';

export function tokens(s: string): Set<string> {
  return new Set(productKey(s).split(' ').filter((w) => w.length > 2));
}
export function similarity(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return norm(a) === norm(b) ? 1 : 0;
  let inter = 0;
  A.forEach((t) => { if (B.has(t)) inter++; });
  return inter / (A.size + B.size - inter);
}

const REQUIRED: Record<string, { field: string; label: string; check?: (v: any, f: any) => boolean }[]> = {
  evento: [{ field: 'title', label: 'título' }, { field: 'start', label: 'fecha', check: (v, f) => (f.allDay ? isValidISODate(String(v).slice(0, 10)) : isValidISODateTime(v) || isValidISODate(v)) }],
  tarea: [{ field: 'title', label: 'título' }],
  compra: [{ field: 'items', label: 'al menos un producto', check: (v) => Array.isArray(v) && v.some((i: any) => i.include && i.name?.trim()) }],
  pago: [{ field: 'concept', label: 'concepto' }, { field: 'dueDate', label: 'vencimiento', check: (v) => isValidISODate(v) }],
  gasto: [{ field: 'concept', label: 'concepto' }, { field: 'amount', label: 'importe', check: (v) => typeof v === 'number' && v > 0 }, { field: 'date', label: 'fecha', check: (v) => isValidISODate(v) }],
  documento: [{ field: 'name', label: 'nombre' }, { field: 'category', label: 'categoría' }],
  reparacion: [{ field: 'title', label: 'título' }],
  mantenimiento: [{ field: 'title', label: 'título' }, { field: 'recurrence', label: 'frecuencia', check: (v) => !!v && !!v.freq }],
  nota: [{ field: 'title', label: 'título' }],
  consulta: [], otro: [],
};

export const FIELD_LABEL: Record<string, string> = {
  title: 'título', start: 'fecha y hora', dueDate: 'fecha', amount: 'importe', date: 'fecha', concept: 'concepto', items: 'productos',
  recurrence: 'frecuencia', name: 'nombre', category: 'categoría', time: 'hora', responsible: 'responsable', kind: 'tipo de acción',
};

export function computeMissing(p: Proposal): string[] {
  const out: string[] = [];
  for (const r of REQUIRED[p.kind] ?? []) {
    const v = p.fields[r.field];
    const ok = r.check ? r.check(v, p.fields) : v !== undefined && v !== null && String(v).trim() !== '';
    if (!ok) out.push(r.field);
  }
  return out;
}

export function findDuplicates(p: Proposal, ex: ExistingIndex): Proposal['duplicates'] {
  const out: Proposal['duplicates'] = [];
  const f = p.fields;
  if (p.kind === 'evento' && f.title) {
    for (const e of ex.events) {
      const s = similarity(f.title, e.title);
      const sameDay = f.start && e.start.slice(0, 10) === String(f.start).slice(0, 10);
      const near = f.start && Math.abs(diffDays(e.start.slice(0, 10), String(f.start).slice(0, 10))) <= 7;
      if ((sameDay && s >= 0.34) || (near && s >= 0.75)) out.push({ entity: 'events', id: e.id, title: e.title, detail: e.start.replace('T', ' '), score: s });
    }
  } else if (p.kind === 'tarea' && f.title) {
    for (const t of ex.tasks) if (t.status !== 'completada' && similarity(f.title, t.title) >= 0.6) out.push({ entity: 'tasks', id: t.id, title: t.title, detail: t.dueDate, score: similarity(f.title, t.title) });
  } else if (p.kind === 'pago' && f.concept) {
    for (const x of ex.payments) {
      if (x.status === 'pagado') continue;
      const s = Math.max(similarity(f.concept, x.concept), f.provider && x.provider && norm(f.provider) === norm(x.provider) ? 0.6 : 0);
      const close = !f.dueDate || !x.dueDate || Math.abs(diffDays(f.dueDate, x.dueDate)) <= 5;
      if (s >= 0.5 && close) out.push({ entity: 'payments', id: x.id, title: x.concept, detail: x.dueDate, score: s });
    }
  } else if (p.kind === 'gasto' && f.concept) {
    for (const x of ex.expenses) {
      const s = similarity(f.concept, x.concept);
      if (s >= 0.5 && x.date === f.date && (f.amount == null || x.amount === f.amount)) out.push({ entity: 'expenses', id: x.id, title: x.concept, detail: `${x.date} · ${x.amount}`, score: s });
    }
  } else if (p.kind === 'reparacion' && f.title) {
    for (const r of ex.repairs) if (r.status !== 'resuelta' && similarity(f.title, r.title) >= 0.5) out.push({ entity: 'repairs', id: r.id, title: r.title, score: similarity(f.title, r.title) });
  } else if (p.kind === 'documento' && f.name) {
    for (const d of ex.documents) if (similarity(f.name, d.name) >= 0.8 && (!f.date || d.date === f.date)) out.push({ entity: 'documents', id: d.id, title: d.name, detail: d.date, score: 1 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

/** Relaciones: un gasto "pagué la luz" puede corresponder a un pago pendiente → se ofrece marcarlo como pagado. */
export function findRelations(p: Proposal, ex: ExistingIndex): Proposal['relations'] {
  const rel: Proposal['relations'] = [];
  if (p.kind === 'gasto' && p.fields.concept) {
    for (const x of ex.payments) {
      if (x.status === 'pagado') continue;
      if (similarity(p.fields.concept, x.concept) >= 0.5 || (x.provider && norm(p.fields.concept).includes(norm(x.provider)))) {
        rel.push({ entity: 'payments', id: x.id, label: `Pago pendiente "${x.concept}"${x.dueDate ? ` (vence ${x.dueDate})` : ''}`, kind: 'marcar_pagado' });
      }
    }
  }
  return rel.slice(0, 3);
}

/** Marca en los productos propuestos cuáles ya están pendientes en la lista. */
export function markShoppingDuplicates(p: Proposal, ex: ExistingIndex, listId?: string) {
  if (p.kind !== 'compra' || !Array.isArray(p.fields.items)) return;
  const warnings: string[] = [];
  for (const it of p.fields.items) {
    const dup = ex.shoppingItems.find((s) => s.status === 'pendiente' && (!listId || s.listId === listId) && productKey(s.name) === productKey(it.name));
    if (dup) { it.duplicateOf = dup.id; if (it.include && !it.confirmedDuplicate) it.include = false; warnings.push(`"${it.name}" ya está en la lista.`); }
  }
  if (warnings.length) p.warnings = [...p.warnings.filter((w) => !w.includes('ya está en la lista')), ...warnings];
}

export function finalizeProposal(p: Proposal, ex: ExistingIndex): Proposal {
  const out = { ...p, fields: { ...p.fields } };
  out.missing = computeMissing(out);
  out.duplicates = findDuplicates(out, ex);
  out.relations = findRelations(out, ex);
  markShoppingDuplicates(out, ex, out.fields.listId);
  return out;
}

/** Una propuesta incluida solo se puede confirmar si no le faltan datos ni tiene ambigüedades sin resolver. */
export function blockingIssues(p: Proposal): string[] {
  if (!p.include) return [];
  const issues: string[] = [];
  for (const m of computeMissing(p)) issues.push(`Falta ${FIELD_LABEL[m] ?? m}.`);
  for (const a of p.ambiguities) if (!a.resolved) issues.push(a.message);
  if (p.duplicates.length && !p.duplicateChoice) issues.push('Posible duplicado: elegí si actualizar, vincular o crear uno nuevo.');
  if (p.kind === 'consulta' || p.kind === 'otro') issues.push('Elegí un tipo de registro o desmarcá este elemento.');
  return issues;
}
