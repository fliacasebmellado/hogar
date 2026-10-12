// Pagos (obligaciones) y gastos (dinero efectivamente gastado).
// - Un pago nunca pasa a "pagado" sin confirmación explícita (confirmPayment).
// - Al confirmar se crea UN gasto vinculado; si ya existía (reintento, otro dispositivo), se reutiliza.
// - Pagos recurrentes: maestra (isSeries) + ocurrencias con id determinista generadas hasta un horizonte.
import type { Repo, WriteOpts } from '../db/repo';
import type { Expense, ID, ISODate, Payment } from '../domain/types';
import { occurrenceId, uuid } from '../domain/ids';
import { occurrencesBetween } from '../domain/recurrence';
import { addDays, today } from '../domain/dates';

export const PAYMENT_HORIZON_DAYS = 45;
const SERIES_FIELDS: (keyof Payment)[] = ['concept', 'category', 'provider', 'amount', 'currency', 'responsibleId', 'method', 'notes'];

export type PaymentInput = Partial<Payment> & { concept: string };

export async function createPayment(repo: Repo, data: PaymentInput, opts: WriteOpts = {}): Promise<Payment> {
  const base: Partial<Payment> = { category: 'otros', currency: 'ARS', status: 'pendiente', ...data };
  if (base.status === 'pagado') throw new Error('Para registrar un pago ya realizado usá "Confirmar pago" o cargá un gasto.');
  if (!base.recurrence) return repo.create('payments', { ...base, recurrence: null }, opts);
  return repo.tx(async () => {
    const id = base.id ?? uuid();
    const start = base.dueDate ?? today();
    await repo.create('payments', { ...base, id, isSeries: true, dueDate: start }, opts);
    await ensurePaymentOccurrences(repo, opts, id);
    return (await repo.get('payments', occurrenceId(id, start)))!;
  });
}

/** Genera ocurrencias de pagos recurrentes hasta el horizonte. Idempotente. */
export async function ensurePaymentOccurrences(repo: Repo, opts: WriteOpts = {}, onlySeries?: ID, ref: ISODate = today()): Promise<number> {
  const all = await repo.list('payments', true);
  const series = all.filter((p) => p.isSeries && p.recurrence && !p.deleted && (!onlySeries || p.id === onlySeries));
  let created = 0;
  for (const s of series) {
    const occs = all.filter((p) => p.seriesId === s.id);
    const last = occs.map((o) => o.occurrenceDate!).sort().pop();
    const from = last ? addDays(last, 1) : s.dueDate!;
    const dates = occurrencesBetween(s.recurrence!, s.dueDate!, from, addDays(ref, PAYMENT_HORIZON_DAYS), 24);
    for (const d of dates) {
      const id = occurrenceId(s.id, d);
      if (await repo.get('payments', id)) continue;
      const occ: Partial<Payment> = { id, seriesId: s.id, occurrenceDate: d, dueDate: d, status: 'pendiente', recurrence: null, isSeries: false };
      for (const f of SERIES_FIELDS) (occ as any)[f] = (s as any)[f];
      if (s.demo) occ.demo = true;
      await repo.create('payments', occ, opts);
      created++;
    }
  }
  return created;
}

export interface ConfirmPaymentInput { paidDate: ISODate; amount: number; method?: string; receiptDocId?: ID; by?: ID; notes?: string }

export async function confirmPayment(repo: Repo, paymentId: ID, input: ConfirmPaymentInput): Promise<{ payment: Payment; expense: Expense }> {
  if (!(input.amount > 0)) throw new Error('Indicá el importe pagado para confirmar.');
  if (!input.paidDate) throw new Error('Indicá la fecha de pago.');
  return repo.tx(async () => {
    const p = await repo.get('payments', paymentId);
    if (!p || p.deleted) throw new Error('El pago no existe.');
    let expense: Expense | undefined = p.expenseId ? await repo.get('expenses', p.expenseId) : undefined;
    if (!expense) expense = (await repo.list('expenses')).find((e) => e.paymentId === paymentId);
    const expData: Partial<Expense> = {
      date: input.paidDate, amount: input.amount, currency: p.currency, category: mapCategory(p.category), concept: p.concept,
      responsibleId: p.responsibleId, receiptDocId: input.receiptDocId ?? p.receiptDocId, paymentId, method: input.method ?? p.method,
      shoppingItemIds: [], extraordinary: false,
    };
    expense = expense
      ? await repo.update('expenses', expense.id, { ...expData, deleted: false }, { by: input.by })
      : await repo.create('expenses', expData, { by: input.by });
    const payment = await repo.update('payments', paymentId, {
      status: 'pagado', paidDate: input.paidDate, amount: input.amount, method: input.method ?? p.method,
      receiptDocId: input.receiptDocId ?? p.receiptDocId, expenseId: expense.id, notes: input.notes ?? p.notes,
    }, { by: input.by, historyAction: 'completar' });
    if (p.seriesId) await ensurePaymentOccurrences(repo, { by: input.by }, p.seriesId);
    return { payment, expense };
  });
}

/** Revierte una confirmación: el pago vuelve a pendiente y el gasto vinculado se elimina (borrado lógico). */
export async function undoPayment(repo: Repo, paymentId: ID, by?: ID) {
  return repo.tx(async () => {
    const p = await repo.get('payments', paymentId);
    if (!p) throw new Error('El pago no existe.');
    if (p.expenseId) await repo.remove('expenses', p.expenseId, { by });
    return repo.update('payments', paymentId, { status: 'pendiente', paidDate: undefined, expenseId: undefined }, { by });
  });
}

function mapCategory(paymentCat: string): string {
  const known = ['servicios', 'impuestos', 'vivienda', 'colegio', 'salud'];
  return known.includes(paymentCat) ? paymentCat : paymentCat === 'actividades' ? 'ocio' : 'otros';
}

export type ExpenseInput = Partial<Expense> & { amount: number; concept: string; date: ISODate };
export async function createExpense(repo: Repo, data: ExpenseInput, opts: WriteOpts = {}): Promise<Expense> {
  return repo.create('expenses', { currency: 'ARS', category: 'otros', shoppingItemIds: [], extraordinary: false, ...data }, opts);
}
