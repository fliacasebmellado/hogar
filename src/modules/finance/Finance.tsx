import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Wallet, Repeat, Download } from 'lucide-react';
import { useApp, useLive } from '../../app/context';
import type { Expense, Payment } from '../../domain/types';
import { effectivePaymentStatus, formatMoney, monthSummary, monthlyEvolution, toCSV, upcomingPayments } from '../../domain/finance';
import { CategoryChip, ChipFilter, Empty, Segmented, StatusChip, SyncMark, Banner } from '../../ui/components';
import { addMonths, formatDate, monthLabel, relativeDay, today } from '../../domain/dates';
import { ExpenseSheet, PaymentSheet } from './FinanceSheets';
import { downloadBlob } from '../../services/backup';

type Tab = 'resumen' | 'pagos' | 'gastos' | 'reportes';

export function PaymentRow({ p, onOpen }: { p: Payment; onOpen: (p: Payment) => void }) {
  const { backend, categories } = useApp();
  const st = effectivePaymentStatus(p);
  return (
    <li>
      <button className="item" onClick={() => onOpen(p)}>
        <div className="item-main">
          <div className="item-title">{p.concept}</div>
          <div className="item-sub">
            {p.dueDate && <span>{st === 'pagado' ? `Pagado ${p.paidDate ? formatDate(p.paidDate) : ''}` : `Vence ${relativeDay(p.dueDate).toLowerCase()}`}</span>}
            <CategoryChip id={p.category} categories={categories('payments')} />
            {p.seriesId && <Repeat size={12} aria-label="Recurrente" />}
            <SyncMark state={p._sync} configured={!!backend} />
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="strong">{formatMoney(p.amount, p.currency)}</div>
          <StatusChip tone={st === 'pagado' ? 'ok' : st === 'vencido' ? 'alert' : st === 'programado' ? 'info' : 'warn'}>{st}</StatusChip>
        </div>
      </button>
    </li>
  );
}

export default function Finance() {
  const { categories, backend, can } = useApp();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('resumen');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [payFilter, setPayFilter] = useState<'pendientes' | 'vencidos' | 'pagados' | ''>('pendientes');
  const [expCat, setExpCat] = useState('');
  const [payment, setPayment] = useState<Payment | null | undefined>(undefined);
  const [expense, setExpense] = useState<Expense | null | undefined>(undefined);
  const payments = useLive((r) => r.list('payments'), [], [] as Payment[]);
  const expenses = useLive((r) => r.list('expenses'), [], [] as Expense[]);

  useEffect(() => {
    const pid = params.get('pago'), eid = params.get('gasto');
    if (pid && payments.length) { const p = payments.find((x) => x.id === pid); if (p) { setTab('pagos'); setPayment(p); } }
    if (eid && expenses.length) { const e = expenses.find((x) => x.id === eid); if (e) { setTab('gastos'); setExpense(e); } }
  }, [params, payments.length, expenses.length]);

  const visiblePayments = payments.filter((p) => !p.isSeries);
  const summary = useMemo(() => monthSummary(expenses, payments, month), [expenses, payments, month]);
  const upcoming = useMemo(() => upcomingPayments(payments, 15), [payments]);
  const overdue = visiblePayments.filter((p) => effectivePaymentStatus(p) === 'vencido');
  const evolution = useMemo(() => monthlyEvolution(expenses, 12, `${month}-01`), [expenses, month]);
  const close = () => { setPayment(undefined); setExpense(undefined); if (params.toString()) setParams({}, { replace: true }); };
  const ars = summary.byCategory.ARS ?? {};
  const maxCat = Math.max(1, ...Object.values(ars));
  const maxEvo = Math.max(1, ...evolution.map((e) => e.amount));

  const filteredPayments = visiblePayments.filter((p) => {
    const st = effectivePaymentStatus(p);
    return payFilter === '' || (payFilter === 'pendientes' ? st === 'pendiente' || st === 'programado' : payFilter === 'vencidos' ? st === 'vencido' : st === 'pagado');
  }).sort((a, b) => ((a.dueDate ?? '') < (b.dueDate ?? '') ? (payFilter === 'pagados' ? 1 : -1) : payFilter === 'pagados' ? -1 : 1));
  const monthExpenses = expenses.filter((e) => e.date.startsWith(month) && (!expCat || e.category === expCat)).sort((a, b) => (a.date < b.date ? 1 : -1));

  const exportCSV = (kind: 'gastos' | 'pagos') => {
    const csv = kind === 'gastos'
      ? toCSV(expenses.sort((a, b) => (a.date < b.date ? -1 : 1)), [{ key: 'date', label: 'Fecha' }, { key: 'concept', label: 'Concepto' }, { key: 'category', label: 'Categoría' }, { key: 'amount', label: 'Importe' }, { key: 'currency', label: 'Moneda' }, { key: 'extraordinary', label: 'Extraordinario' }, { key: 'paymentId', label: 'Pago vinculado' }, { key: 'id', label: 'ID' }])
      : toCSV(visiblePayments.map((p) => ({ ...p, estado: effectivePaymentStatus(p) })), [{ key: 'dueDate', label: 'Vencimiento' }, { key: 'concept', label: 'Concepto' }, { key: 'provider', label: 'Proveedor' }, { key: 'category', label: 'Categoría' }, { key: 'amount', label: 'Importe' }, { key: 'currency', label: 'Moneda' }, { key: 'estado', label: 'Estado' }, { key: 'paidDate', label: 'Fecha de pago' }, { key: 'expenseId', label: 'Gasto vinculado' }, { key: 'id', label: 'ID' }]);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `hogar-${kind}-${today()}.csv`);
  };

  return (
    <div>
      <div className="tabs-scroll" style={{ marginBottom: 12 }}>
        <Segmented label="Secciones de economía" value={tab} onChange={setTab} options={[{ value: 'resumen', label: 'Resumen' }, { value: 'pagos', label: 'Pagos', badge: overdue.length }, { value: 'gastos', label: 'Gastos' }, { value: 'reportes', label: 'Reportes' }]} />
      </div>
      {can('finance.edit') && (
        <div className="row-wrap" style={{ marginBottom: 12 }}>
          <button className="btn btn-primary" onClick={() => setPayment(null)}><Plus size={18} /> Pago a vencer</button>
          <button className="btn" onClick={() => setExpense(null)}><Plus size={18} /> Gasto realizado</button>
        </div>
      )}
      {(tab === 'resumen' || tab === 'gastos' || tab === 'reportes') && (
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn btn-sm" onClick={() => setMonth(addMonths(`${month}-01`, -1).slice(0, 7))} aria-label="Mes anterior">‹</button>
          <h2 style={{ flex: 1, textAlign: 'center', textTransform: 'capitalize' }}>{monthLabel(month)}</h2>
          <button className="btn btn-sm" onClick={() => setMonth(addMonths(`${month}-01`, 1).slice(0, 7))} aria-label="Mes siguiente">›</button>
        </div>
      )}

      {tab === 'resumen' && (
        <div className="stack">
          {overdue.length > 0 && <Banner tone="alert">{overdue.length} pago(s) vencido(s) sin confirmar. <button className="link-btn" onClick={() => { setTab('pagos'); setPayFilter('vencidos'); }}>Ver</button></Banner>}
          <div className="stat-row">
            <div className="stat"><div className="n">{formatMoney(summary.total.ARS ?? 0)}</div><div className="l">Gastado en el mes</div></div>
            <div className="stat"><div className="n">{formatMoney(summary.pendingObligations.ARS ?? 0)}</div><div className="l">Obligaciones pendientes del mes</div></div>
            <div className="stat"><div className="n">{summary.count}</div><div className="l">Gastos registrados</div></div>
          </div>
          {Object.keys(summary.total).filter((c) => c !== 'ARS').map((c) => <p key={c} className="small muted">También: {formatMoney(summary.total[c], c)} en {c}.</p>)}
          <div className="section-head"><h2>Próximos vencimientos (15 días)</h2></div>
          {upcoming.length ? <div className="card"><ul className="list">{upcoming.map((p) => <PaymentRow key={p.id} p={p} onOpen={setPayment} />)}</ul></div>
            : <p className="muted small">No hay vencimientos próximos registrados.</p>}
          {summary.extraordinary.length > 0 && <>
            <div className="section-head"><h2>Gastos extraordinarios del mes</h2></div>
            <div className="card"><ul className="list">{summary.extraordinary.map((e) => <ExpenseRow key={e.id} e={e} onOpen={setExpense} />)}</ul></div>
          </>}
          <p className="muted tiny">Los totales suman solo gastos efectivamente realizados. Los pagos pendientes son obligaciones futuras y se muestran por separado. Al confirmar un pago se crea un único gasto vinculado.</p>
        </div>
      )}

      {tab === 'pagos' && (
        <div className="stack-sm">
          <ChipFilter label="Estado" value={payFilter} onChange={(v) => setPayFilter(v as any)} options={[{ value: 'pendientes', label: 'Pendientes' }, { value: 'vencidos', label: 'Vencidos' }, { value: 'pagados', label: 'Pagados' }]} />
          {filteredPayments.length ? <div className="card"><ul className="list">{filteredPayments.map((p) => <PaymentRow key={p.id} p={p} onOpen={setPayment} />)}</ul></div>
            : <div className="card"><Empty icon={<Wallet size={36} />} title="No hay pagos en esta vista." /></div>}
        </div>
      )}

      {tab === 'gastos' && (
        <div className="stack-sm">
          <ChipFilter label="Categoría" value={expCat} onChange={setExpCat} options={categories('expenses').map((c) => ({ value: c.id, label: c.label }))} />
          {monthExpenses.length ? <div className="card"><ul className="list">{monthExpenses.map((e) => <ExpenseRow key={e.id} e={e} onOpen={setExpense} />)}</ul></div>
            : <div className="card"><Empty icon={<Wallet size={36} />} title="No hay gastos registrados en este mes." /></div>}
        </div>
      )}

      {tab === 'reportes' && (
        <div className="stack">
          <div className="card card-pad">
            <h3 style={{ marginBottom: 10 }}>Gastos por categoría (ARS)</h3>
            {Object.keys(ars).length === 0 ? <p className="muted small">Sin gastos en ARS este mes.</p> : (
              <div className="bars">
                {Object.entries(ars).sort((a, b) => b[1] - a[1]).map(([cat, v]) => (
                  <div className="bar-row" key={cat}>
                    <span className="truncate">{categories('expenses').find((c) => c.id === cat)?.label ?? cat}</span>
                    <div className="bar-track" aria-hidden="true"><div className="bar-fill" style={{ width: `${(v / maxCat) * 100}%` }} /></div>
                    <span className="strong">{formatMoney(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card card-pad">
            <h3>Evolución mensual (ARS, 12 meses)</h3>
            <div className="vbars" role="img" aria-label={evolution.map((e) => `${monthLabel(e.month)}: ${formatMoney(e.amount)}`).join('; ')}>
              {evolution.map((e) => (
                <div key={e.month} className={`vbar${e.month === month ? ' current' : ''}`} title={`${monthLabel(e.month)}: ${formatMoney(e.amount)}`}>
                  <div style={{ height: `${(e.amount / maxEvo) * 100}%` }} />
                  <span>{e.month.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card card-pad stack-sm">
            <h3>Exportar</h3>
            <p className="muted small">CSV en UTF-8, compatible con Google Sheets (Archivo → Importar) y Excel.{backend ? ' Además, con Google conectado los datos ya están en la planilla "Hogar — datos".' : ''}</p>
            <div className="row-wrap">
              <button className="btn" onClick={() => exportCSV('gastos')}><Download size={16} /> Gastos (CSV)</button>
              <button className="btn" onClick={() => exportCSV('pagos')}><Download size={16} /> Pagos (CSV)</button>
            </div>
          </div>
        </div>
      )}
      <PaymentSheet open={payment !== undefined} payment={payment ?? null} onClose={close} />
      <ExpenseSheet open={expense !== undefined} expense={expense ?? null} onClose={close} />
    </div>
  );
}

function ExpenseRow({ e, onOpen }: { e: Expense; onOpen: (e: Expense) => void }) {
  const { categories, backend } = useApp();
  return (
    <li>
      <button className="item" onClick={() => onOpen(e)}>
        <div className="item-main">
          <div className="item-title">{e.concept}</div>
          <div className="item-sub">
            <span>{formatDate(e.date)}</span>
            <CategoryChip id={e.category} categories={categories('expenses')} />
            {e.extraordinary && <StatusChip tone="warn">Extraordinario</StatusChip>}
            {e.paymentId && <span className="tiny">De un pago</span>}
            <SyncMark state={e._sync} configured={!!backend} />
          </div>
        </div>
        <span className="strong">{formatMoney(e.amount, e.currency)}</span>
      </button>
    </li>
  );
}
