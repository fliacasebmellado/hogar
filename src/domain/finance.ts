// Reglas de economía.
// Relación pago ↔ gasto: un Pago es una obligación (factura, cuota). Al confirmarlo como pagado se crea UN Gasto
// enlazado (expense.paymentId / payment.expenseId). Los reportes de gasto real suman SOLO gastos, nunca pagos,
// por lo que no hay doble conteo. Las obligaciones futuras se reportan aparte (próximos vencimientos).
import type { Expense, ISODate, Payment, PaymentStatus } from './types';
import { addDays, diffDays, monthKey, today } from './dates';

export function effectivePaymentStatus(p: Payment, ref: ISODate = today()): PaymentStatus {
  if (p.status === 'pagado') return 'pagado';
  if (p.dueDate && p.dueDate < ref) return 'vencido';
  return p.status === 'vencido' ? 'pendiente' : p.status;
}

export function formatMoney(amount: number | undefined | null, currency = 'ARS'): string {
  if (amount === undefined || amount === null || !isFinite(amount)) return 'Sin importe';
  try {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function upcomingPayments(payments: Payment[], days = 15, ref: ISODate = today()): Payment[] {
  const limit = addDays(ref, days);
  return payments
    .filter((p) => !p.deleted && !p.isSeries && p.status !== 'pagado' && p.dueDate && p.dueDate <= limit)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
}

export interface MonthSummary {
  month: string; total: Record<string, number>; byCategory: Record<string, Record<string, number>>; count: number;
  extraordinary: Expense[]; pendingObligations: Record<string, number>;
}

export function monthSummary(expenses: Expense[], payments: Payment[], month: string): MonthSummary {
  const s: MonthSummary = { month, total: {}, byCategory: {}, count: 0, extraordinary: [], pendingObligations: {} };
  for (const e of expenses) {
    if (e.deleted || monthKey(e.date) !== month) continue;
    s.count++;
    s.total[e.currency] = (s.total[e.currency] ?? 0) + e.amount;
    s.byCategory[e.currency] ??= {};
    s.byCategory[e.currency][e.category] = (s.byCategory[e.currency][e.category] ?? 0) + e.amount;
    if (e.extraordinary) s.extraordinary.push(e);
  }
  for (const p of payments) {
    if (p.deleted || p.isSeries || p.status === 'pagado' || !p.dueDate || monthKey(p.dueDate) !== month || p.amount == null) continue;
    s.pendingObligations[p.currency] = (s.pendingObligations[p.currency] ?? 0) + p.amount;
  }
  return s;
}

/** Evolución de los últimos n meses (suma de gastos por moneda). */
export function monthlyEvolution(expenses: Expense[], months: number, ref: ISODate = today(), currency = 'ARS') {
  const out: { month: string; amount: number }[] = [];
  const [y, m] = ref.split('-').map(Number);
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ month: key, amount: 0 });
  }
  for (const e of expenses) {
    if (e.deleted || e.currency !== currency) continue;
    const row = out.find((o) => o.month === monthKey(e.date));
    if (row) row.amount += e.amount;
  }
  return out;
}

export function daysUntil(date: ISODate, ref: ISODate = today()) { return diffDays(date, ref); }

// ---- CSV (compatible con Google Sheets: UTF-8 con BOM, separador coma, comillas dobles) ----
export function toCSV(rows: Record<string, any>[], columns: { key: string; label: string }[]): string {
  const esc = (v: any) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Evita inyección de fórmulas al abrir el CSV en planillas.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [columns.map((c) => esc(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c.key])).join(','));
  return '﻿' + lines.join('\r\n');
}
