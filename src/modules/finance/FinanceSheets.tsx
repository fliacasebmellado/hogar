import { useEffect, useState } from 'react';
import { useApp, useLive } from '../../app/context';
import type { Expense, Payment } from '../../domain/types';
import { Sheet, ConfirmSheet } from '../../ui/Sheet';
import { CategorySelect, Checkbox, DateField, NumberField, PersonSelect, RecurrenceField, SelectField, TextArea, TextField } from '../../ui/fields';
import { HistoryList } from '../../ui/records';
import { DocField } from '../../ui/DocField';
import { confirmPayment, createExpense, createPayment, undoPayment } from '../../services/money';
import { CURRENCIES, PAYMENT_METHODS } from '../../domain/catalog';
import { effectivePaymentStatus, formatMoney } from '../../domain/finance';
import { validateRecord } from '../../domain/validation';
import { today, formatDate } from '../../domain/dates';
import { describeRecurrence } from '../../domain/recurrence';
import { Banner, StatusChip } from '../../ui/components';

function ReceiptField(p: { docId?: string; onChange: (id?: string) => void; label?: string }) {
  return <DocField {...p} category="comprobantes" />;
}

export function PaymentSheet({ open, onClose, payment }: { open: boolean; onClose: () => void; payment?: Payment | null }) {
  const { repo, profile, profiles, categories, run, can } = useApp();
  const isNew = !payment;
  const [d, setD] = useState<Partial<Payment>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [del, setDel] = useState(false);
  const series = useLive((r) => (payment?.seriesId ? r.get('payments', payment.seriesId) : undefined), [payment?.seriesId], undefined);
  useEffect(() => {
    if (!open) return;
    setErrors([]);
    setD(payment ? { ...payment } : { concept: '', category: 'servicios', currency: 'ARS', status: 'pendiente', dueDate: today(), responsibleId: profile?.id });
  }, [open, payment?.id]);
  const set = (p: Partial<Payment>) => setD((x) => ({ ...x, ...p }));
  const editable = can('finance.edit');
  const save = async () => {
    const errs = validateRecord('payments', { id: 'x', ...d, isSeries: false });
    setErrors(errs);
    if (errs.length) return;
    const { id, version, createdAt, updatedAt, rev, _sync, ...data } = d as any;
    const ok = await run(() => (isNew ? createPayment(repo, data, { by: profile?.id }) : repo.update('payments', payment!.id, data, { by: profile?.id })), isNew ? 'Pago registrado como pendiente' : 'Pago actualizado');
    if (ok) onClose();
  };
  const status = payment ? effectivePaymentStatus(payment) : 'pendiente';
  return (
    <>
      <Sheet open={open} onClose={onClose} title={isNew ? 'Nuevo pago a vencer' : 'Pago'}
        footer={editable ? <>
          {!isNew && <button className="btn btn-danger" onClick={() => setDel(true)}>Eliminar</button>}
          <span className="spacer" />
          {!isNew && payment!.status !== 'pagado' && <button className="btn" onClick={() => setConfirming(true)}>Confirmar pago…</button>}
          {!isNew && payment!.status === 'pagado' && <button className="btn" onClick={() => run(() => undoPayment(repo, payment!.id, profile?.id), 'Pago vuelto a pendiente').then(onClose)}>Deshacer pago</button>}
          <button className="btn btn-primary" onClick={save}>{isNew ? 'Guardar' : 'Guardar cambios'}</button>
        </> : undefined}>
        <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
          {errors.length > 0 && <div className="banner banner-alert" role="alert">{errors.join(' ')}</div>}
          {!isNew && <div className="row">Estado: <StatusChip tone={status === 'pagado' ? 'ok' : status === 'vencido' ? 'alert' : 'warn'}>{status}</StatusChip>{payment!.paidDate && <span className="muted small">pagado el {formatDate(payment!.paidDate)}</span>}</div>}
          <TextField label="Concepto" required value={d.concept} onChange={(v) => set({ concept: v })} autoFocus={isNew} placeholder="Ej.: Luz, cuota del colegio" />
          <div className="form-row">
            <CategorySelect value={d.category} onChange={(v) => set({ category: v })} categories={categories('payments')} required />
            <TextField label="Proveedor" value={d.provider} onChange={(v) => set({ provider: v })} />
          </div>
          <div className="form-row">
            <NumberField label="Importe" value={d.amount} onChange={(v) => set({ amount: v })} hint="Puede quedar vacío si aún no llegó la factura" />
            <SelectField label="Moneda" value={d.currency} onChange={(v) => set({ currency: v })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          </div>
          <div className="form-row">
            <DateField label="Vencimiento" required value={d.dueDate} onChange={(v) => set({ dueDate: v })} />
            <DateField label="Emisión" value={d.issueDate} onChange={(v) => set({ issueDate: v })} />
          </div>
          <PersonSelect label="Responsable" value={d.responsibleId} onChange={(v) => set({ responsibleId: v })} profiles={profiles.filter((p) => p.role === 'adult')} />
          <div className="form-row">
            <SelectField label="Estado" value={d.status === 'pagado' ? 'pagado' : d.status} onChange={(v) => set({ status: v as any })}
              options={[{ value: 'pendiente', label: 'Pendiente' }, { value: 'programado', label: 'Programado (débito/agenda)' }, ...(d.status === 'pagado' ? [{ value: 'pagado' as const, label: 'Pagado' }] : [])]} />
            <SelectField label="Medio de pago" value={d.method ?? ''} onChange={(v) => set({ method: v || undefined })} options={[{ value: '', label: '—' }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: m }))]} />
          </div>
          {isNew ? <RecurrenceField value={d.recurrence} onChange={(v) => set({ recurrence: v })} hint="Se generan los próximos vencimientos (45 días) como obligaciones pendientes, no como pagos hechos." />
            : payment!.seriesId && <p className="muted small">Pago recurrente: {describeRecurrence(series?.recurrence)}.</p>}
          <ReceiptField docId={d.receiptDocId} onChange={(id) => set({ receiptDocId: id })} label="Factura o comprobante" />
          <TextArea label="Notas" value={d.notes} onChange={(v) => set({ notes: v })} rows={2} />
          {!isNew && <details className="more"><summary>Origen e historial</summary><p className="small muted">Origen: {payment!.origin ?? 'manual'}{payment!.expenseId ? ' · tiene un gasto vinculado' : ''}</p><HistoryList entity="payments" recordId={payment!.id} /></details>}
        </form>
      </Sheet>
      {payment && <ConfirmPaymentSheet open={confirming} onClose={() => setConfirming(false)} payment={payment} onDone={onClose} />}
      <ConfirmSheet open={del} onClose={() => setDel(false)} title="Eliminar pago" danger confirmLabel="Eliminar" message={<p>¿Eliminar "{payment?.concept}"?{payment?.expenseId ? ' El gasto vinculado no se elimina.' : ''}</p>}
        onConfirm={() => { run(() => repo.remove('payments', payment!.id, { by: profile?.id }), 'Pago eliminado').then(onClose); }} />
    </>
  );
}

/** Confirmación explícita del pago: crea UN gasto vinculado (sin duplicar si ya existía). */
export function ConfirmPaymentSheet({ open, onClose, payment, onDone }: { open: boolean; onClose: () => void; payment: Payment; onDone?: () => void }) {
  const { repo, profile, run } = useApp();
  const [amount, setAmount] = useState<number | undefined>(payment.amount);
  const [date, setDate] = useState<string | undefined>(today());
  const [method, setMethod] = useState(payment.method ?? '');
  const [receipt, setReceipt] = useState<string | undefined>(payment.receiptDocId);
  useEffect(() => { if (open) { setAmount(payment.amount); setDate(today()); setMethod(payment.method ?? ''); setReceipt(payment.receiptDocId); } }, [open]);
  const ok = !!amount && amount > 0 && !!date;
  return (
    <Sheet open={open} onClose={onClose} title={`Confirmar pago: ${payment.concept}`}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!ok} onClick={async () => {
        const r = await run(() => confirmPayment(repo, payment.id, { amount: amount!, paidDate: date!, method: method || undefined, receiptDocId: receipt, by: profile?.id }), 'Pago confirmado y gasto registrado');
        if (r) { onClose(); onDone?.(); }
      }}>Confirmar pago</button></>}>
      <div className="form">
        <Banner tone="info">Confirmá solo si el pago ya se realizó. Se registrará un gasto vinculado a este pago. La app no realiza pagos ni movimientos bancarios.</Banner>
        <NumberField label={`Importe pagado (${payment.currency})`} required value={amount} onChange={setAmount} />
        <div className="form-row">
          <DateField label="Fecha de pago" required value={date} onChange={setDate} />
          <SelectField label="Medio de pago" value={method} onChange={setMethod} options={[{ value: '', label: '—' }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: m }))]} />
        </div>
        <ReceiptField docId={receipt} onChange={setReceipt} />
      </div>
    </Sheet>
  );
}

export function ExpenseSheet({ open, onClose, expense }: { open: boolean; onClose: () => void; expense?: Expense | null }) {
  const { repo, profile, profiles, categories, run, can } = useApp();
  const isNew = !expense;
  const [d, setD] = useState<Partial<Expense>>({});
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    setErrors([]);
    setD(expense ? { ...expense } : { concept: '', category: 'supermercado', currency: 'ARS', date: today(), extraordinary: false, shoppingItemIds: [], responsibleId: profile?.id });
  }, [open, expense?.id]);
  const set = (p: Partial<Expense>) => setD((x) => ({ ...x, ...p }));
  const save = async () => {
    const errs = validateRecord('expenses', { id: 'x', ...d });
    setErrors(errs);
    if (errs.length) return;
    const { id, version, createdAt, updatedAt, rev, _sync, ...data } = d as any;
    const ok = await run(() => (isNew ? createExpense(repo, data, { by: profile?.id }) : repo.update('expenses', expense!.id, data, { by: profile?.id })), isNew ? 'Gasto registrado' : 'Gasto actualizado');
    if (ok) onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={isNew ? 'Nuevo gasto' : 'Gasto'}
      footer={can('finance.edit') ? <>
        {!isNew && <button className="btn btn-danger" onClick={() => run(() => repo.remove('expenses', expense!.id, { by: profile?.id }), 'Gasto eliminado').then(onClose)}>Eliminar</button>}
        <span className="spacer" /><button className="btn btn-primary" onClick={save}>{isNew ? 'Registrar' : 'Guardar'}</button>
      </> : undefined}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {errors.length > 0 && <div className="banner banner-alert" role="alert">{errors.join(' ')}</div>}
        {expense?.paymentId && <Banner tone="info">Este gasto corresponde a un pago confirmado. Para anularlo, usá "Deshacer pago" en el pago.</Banner>}
        <TextField label="Concepto" required value={d.concept} onChange={(v) => set({ concept: v })} autoFocus={isNew} />
        <div className="form-row">
          <NumberField label="Importe" required value={d.amount} onChange={(v) => set({ amount: v })} />
          <SelectField label="Moneda" value={d.currency} onChange={(v) => set({ currency: v })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </div>
        <div className="form-row">
          <DateField label="Fecha" required value={d.date} onChange={(v) => set({ date: v })} />
          <CategorySelect value={d.category} onChange={(v) => set({ category: v })} categories={categories('expenses')} required />
        </div>
        <PersonSelect label="Responsable (opcional)" value={d.responsibleId} onChange={(v) => set({ responsibleId: v })} profiles={profiles} />
        <SelectField label="Medio de pago" value={d.method ?? ''} onChange={(v) => set({ method: v || undefined })} options={[{ value: '', label: '—' }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: m }))]} />
        <Checkbox label="Gasto extraordinario" checked={!!d.extraordinary} onChange={(v) => set({ extraordinary: v })} />
        <ReceiptField docId={d.receiptDocId} onChange={(id) => set({ receiptDocId: id })} />
        <TextArea label="Notas" value={d.notes} onChange={(v) => set({ notes: v })} rows={2} />
        {!isNew && <details className="more"><summary>Historial</summary><HistoryList entity="expenses" recordId={expense!.id} /></details>}
      </form>
    </Sheet>
  );
}

export { formatMoney };
