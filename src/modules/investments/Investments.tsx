import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, ExternalLink, Check, FileText } from 'lucide-react';
import { useApp, useLive } from '../../app/context';
import type { DocumentRecord, Investment, InvestmentContract, InvestmentTax, InvestmentWork } from '../../domain/types';
import { Banner, Empty, Segmented, StatusChip, SyncMark } from '../../ui/components';
import { Sheet, ConfirmSheet } from '../../ui/Sheet';
import { RecordForm, type FieldDef } from '../../ui/RecordForm';
import { FilePickButton, useOpenAttachment } from '../../ui/records';
import { formatMoney } from '../../domain/finance';
import { formatDate, relativeDay, today } from '../../domain/dates';
import { validateRecord } from '../../domain/validation';
import { addDocument } from '../../services/documents';
import { CONTRACT_FREQ, CONTRACT_KINDS, INVESTMENT_KINDS, INVESTMENT_STATUS, TAX_PRESETS, contractStatus, kindIcon, kindLabel, markTaxPaid, monthlyRent, nextPeriodDraft, summarize, taxStatus, type InvestmentSummary } from '../../services/investments';
import { MODULE_COLOR, tones } from '../../ui/theme';
import { DriveFiles } from './DriveFiles';

const opts = (l: string[]) => l.map((x) => ({ value: x, label: x.charAt(0).toUpperCase() + x.slice(1) }));
const CUR = opts(['ARS', 'USD']);
const tone = (s: string) => (s === 'pagado' || s === 'vigente' || s === 'terminado' ? 'ok' : s === 'vencido' ? 'alert' : s === 'por vencer' || s === 'pendiente' ? 'warn' : 'neutral') as any;
const clean = (d: any) => { const { id, version, createdAt, updatedAt, rev, _sync, ...r } = d; return r; };

const INV_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Nombre', type: 'text', required: true, hint: 'Se usa también como nombre de su carpeta en Drive' },
  { key: 'kind', label: 'Tipo', type: 'select', options: INVESTMENT_KINDS.map((k) => ({ value: k.id, label: `${k.icon} ${k.label}` })), half: true },
  { key: 'status', label: 'Estado', type: 'select', options: opts(INVESTMENT_STATUS), half: true },
  { key: 'address', label: 'Dirección / detalle', type: 'text' },
  { key: 'owners', label: 'Titulares', type: 'text', hint: 'Ej.: Papá y Mamá 50% c/u' },
  { key: 'purchaseDate', label: 'Fecha de compra', type: 'date', half: true },
  { key: 'purchaseValue', label: 'Valor de compra', type: 'number', half: true },
  { key: 'currency', label: 'Moneda', type: 'select', options: CUR, half: true },
  { key: 'taxIds', label: 'Partidas / nomenclatura', type: 'text', half: true },
  { key: 'notes', label: 'Notas', type: 'textarea' },
];
const CONTRACT_FIELDS: FieldDef[] = [
  { key: 'kind', label: 'Tipo de contrato', type: 'select', options: opts(CONTRACT_KINDS), required: true, half: true },
  { key: 'counterpart', label: 'Contraparte', type: 'text', hint: 'Inquilino, administración, aseguradora…', half: true },
  { key: 'startDate', label: 'Inicio', type: 'date', half: true }, { key: 'endDate', label: 'Fin', type: 'date', half: true },
  { key: 'amount', label: 'Importe', type: 'number', half: true }, { key: 'currency', label: 'Moneda', type: 'select', options: CUR, half: true },
  { key: 'frequency', label: 'Periodicidad', type: 'select', options: opts(CONTRACT_FREQ), half: true }, { key: 'dueDay', label: 'Día de cobro/pago', type: 'number', half: true },
  { key: 'adjustment', label: 'Actualización', type: 'text', hint: 'Ej.: ICL cada 12 meses, IPC trimestral' },
  { key: 'status', label: 'Estado', type: 'select', options: opts(['vigente', 'rescindido']) },
  { key: 'notes', label: 'Notas', type: 'textarea' },
];
const TAX_FIELDS: FieldDef[] = [
  { key: 'tax', label: 'Impuesto / servicio', type: 'text', required: true, list: TAX_PRESETS },
  { key: 'period', label: 'Período', type: 'text', hint: 'Ej.: 2026-10 o 5.ª cuota', half: true }, { key: 'dueDate', label: 'Vencimiento', type: 'date', half: true },
  { key: 'amount', label: 'Importe', type: 'number', half: true }, { key: 'currency', label: 'Moneda', type: 'select', options: CUR, half: true },
  { key: 'accountNumber', label: 'N.º de cuenta / partida', type: 'text', half: true }, { key: 'method', label: 'Medio de pago', type: 'text', half: true },
  { key: 'status', label: 'Estado', type: 'select', options: opts(['pendiente', 'pagado']), half: true }, { key: 'paidDate', label: 'Fecha de pago', type: 'date', half: true },
  { key: 'notes', label: 'Notas', type: 'textarea' },
];
const WORK_FIELDS: FieldDef[] = [
  { key: 'title', label: 'Trabajo', type: 'text', required: true, hint: 'Ej.: pintura, plomería, cambio de termotanque' },
  { key: 'date', label: 'Fecha', type: 'date', half: true }, { key: 'status', label: 'Estado', type: 'select', options: opts(['pendiente', 'en curso', 'terminado']), half: true },
  { key: 'provider', label: 'Proveedor', type: 'text', half: true }, { key: 'paidBy', label: 'Pagó', type: 'text', hint: 'Propietario, inquilino…', half: true },
  { key: 'cost', label: 'Costo', type: 'number', half: true }, { key: 'currency', label: 'Moneda', type: 'select', options: CUR, half: true },
  { key: 'notes', label: 'Notas', type: 'textarea' },
];

export default function Investments() {
  const { can } = useApp();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<Investment | null | undefined>(undefined);
  const invs = useLive((r) => r.list('investments'), [], [] as Investment[]);
  const contracts = useLive((r) => r.list('investmentContracts'), [], [] as InvestmentContract[]);
  const taxes = useLive((r) => r.list('investmentTaxes'), [], [] as InvestmentTax[]);
  const works = useLive((r) => r.list('investmentWorks'), [], [] as InvestmentWork[]);
  const sums = useMemo(() => invs.map((i) => summarize(i, contracts, taxes, works)).sort((a, b) => a.inv.name.localeCompare(b.inv.name)), [invs, contracts, taxes, works]);
  useEffect(() => { const id = params.get('id'); if (id && invs.length) { const i = invs.find((x) => x.id === id); if (i) setOpen(i); } }, [params, invs.length]);
  const rent = monthlyRent(sums);
  const overdue = sums.flatMap((s) => s.overdueTaxes);
  const pendingTaxes = taxes.filter((t) => t.status !== 'pagado');
  const ending = sums.flatMap((s) => s.endingContracts);
  const close = () => { setOpen(undefined); if (params.get('id')) setParams({}, { replace: true }); };
  return (
    <div>
      <div className="stat-row" style={{ marginBottom: 12 }}>
        <div className="stat"><div className="n">{invs.length}</div><div className="l">Inversiones</div></div>
        <div className="stat"><div className="n" style={{ fontSize: '1.05rem' }}>{Object.keys(rent).length ? Object.entries(rent).map(([c, v]) => formatMoney(v, c)).join(' + ') : '—'}</div><div className="l">Alquileres por mes</div></div>
        <div className="stat"><div className="n" style={overdue.length ? { color: 'var(--alert-fg)' } : undefined}>{pendingTaxes.length}</div><div className="l">Impuestos pendientes{overdue.length ? ` (${overdue.length} vencidos)` : ''}</div></div>
      </div>
      {ending.length > 0 && <Banner tone="warn">{ending.length} contrato(s) vencen en los próximos 60 días: {ending.map((c) => invs.find((i) => i.id === c.investmentId)?.name).join(', ')}.</Banner>}
      {can('finance.edit') && <div className="row" style={{ margin: '12px 0' }}><button className="btn btn-primary" onClick={() => setOpen(null)}><Plus size={18} /> Nueva inversión</button></div>}
      {sums.length === 0 ? <div className="card"><Empty title="Todavía no hay inversiones. Al conectar Google, cada carpeta dentro de “Inversiones” en Drive aparece acá automáticamente." /></div> : (
        <div className="cards">{sums.map((s) => <InvestmentCard key={s.inv.id} s={s} onOpen={() => setOpen(s.inv)} />)}</div>
      )}
      <InvestmentSheet open={open !== undefined} inv={open ?? null} onClose={close} contracts={contracts} taxes={taxes} works={works} />
    </div>
  );
}

function InvestmentCard({ s, onOpen }: { s: InvestmentSummary; onOpen: () => void }) {
  const { backend } = useApp();
  const t = tones(MODULE_COLOR.economia);
  return (
    <button type="button" className="ev-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: `inset 6px 0 0 ${t.base}`, alignItems: 'flex-start' }} onClick={onOpen}>
      <span className="ev-emoji" style={{ background: t.tint }} aria-hidden="true">{kindIcon(s.inv.kind)}</span>
      <span className="ev-body">
        <span className="ev-title" style={{ display: 'block' }}>{s.inv.name}</span>
        <span className="ev-sub" style={{ display: 'block', color: 'var(--text-3)' }}>{[kindLabel(s.inv.kind), s.inv.address].filter(Boolean).join(' · ')}<SyncMark state={s.inv._sync} configured={!!backend} /></span>
        <span className="row-wrap" style={{ marginTop: 6, gap: 6 }}>
          {s.inv.status && <StatusChip tone={s.inv.status === 'alquilada' ? 'ok' : 'neutral'}>{s.inv.status}</StatusChip>}
          {s.rent && <span className="chip">🔑 {formatMoney(s.rent.amount, s.rent.currency)}/{s.rent.frequency === 'anual' ? 'año' : 'mes'}{s.rent.endDate ? ` · hasta ${formatDate(s.rent.endDate)}` : ''}</span>}
          {s.nextTax && <StatusChip tone={tone(taxStatus(s.nextTax))}>🧾 {s.nextTax.tax}{s.nextTax.dueDate ? ` · ${relativeDay(s.nextTax.dueDate).toLowerCase()}` : ''}</StatusChip>}
          {s.endingContracts.length > 0 && <StatusChip tone="warn">Contrato por vencer</StatusChip>}
          {s.openWorks.length > 0 && <span className="chip">🔧 {s.openWorks.length} trabajo(s)</span>}
        </span>
      </span>
    </button>
  );
}

type Tab = 'datos' | 'contratos' | 'impuestos' | 'mantenimiento' | 'documentos';

function InvestmentSheet({ open, inv, onClose, contracts, taxes, works }: { open: boolean; inv: Investment | null; onClose: () => void; contracts: InvestmentContract[]; taxes: InvestmentTax[]; works: InvestmentWork[] }) {
  const { repo, profile, run, can, backend } = useApp();
  const [tab, setTab] = useState<Tab>('datos');
  const [d, setD] = useState<Record<string, any>>({});
  const [errs, setErrs] = useState<string[]>([]);
  const [del, setDel] = useState(false);
  useEffect(() => { if (open) { setTab('datos'); setErrs([]); setD(inv ? { ...inv } : { name: '', kind: 'departamento', currency: 'USD' }); } }, [open, inv?.id]);
  const editable = can('finance.edit');
  const save = async () => {
    const e = validateRecord('investments', { id: 'x', ...d });
    setErrs(e);
    if (e.length) return;
    const r = await run(() => (inv ? repo.update('investments', inv.id, clean(d), { by: profile?.id }) : repo.create('investments', clean(d), { by: profile?.id })), inv ? 'Inversión actualizada' : `Inversión creada${backend ? ': se crea su carpeta en Drive al sincronizar' : ''}`);
    if (r && !inv) onClose();
  };
  const own = <T extends { investmentId: string }>(l: T[]) => (inv ? l.filter((x) => x.investmentId === inv.id) : []);
  return (
    <>
      <Sheet open={open} onClose={onClose} title={inv ? `${kindIcon(inv.kind)} ${inv.name}` : 'Nueva inversión'} wide
        footer={tab === 'datos' && editable ? <>{inv && <button className="btn btn-danger" onClick={() => setDel(true)}>Eliminar</button>}<span className="spacer" /><button className="btn btn-primary" onClick={save}>{inv ? 'Guardar' : 'Crear'}</button></> : undefined}>
        {inv && (
          <div className="tabs-scroll" style={{ marginBottom: 14 }}>
            <Segmented label="Secciones de la inversión" value={tab} onChange={setTab} options={[
              { value: 'datos', label: 'Datos' }, { value: 'contratos', label: 'Contratos', badge: own(contracts).length },
              { value: 'impuestos', label: 'Impuestos', badge: own(taxes).filter((t) => t.status !== 'pagado').length },
              { value: 'mantenimiento', label: 'Mantenimiento', badge: own(works).filter((w) => w.status !== 'terminado').length },
              { value: 'documentos', label: 'Documentos' },
            ]} />
          </div>
        )}
        {tab === 'datos' && (
          <div className="stack">
            {inv?.driveUrl && <a className="btn btn-sm" href={inv.driveUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Abrir su carpeta en Drive</a>}
            {inv && <DriveFiles inv={inv} onlySheets />}
            <RecordForm fields={INV_FIELDS} value={d} onChange={setD} errors={errs} />
          </div>
        )}
        {inv && tab === 'contratos' && (
          <ChildList entity="investmentContracts" fields={CONTRACT_FIELDS} items={own(contracts)} investmentId={inv.id} draft={{ kind: 'alquiler', currency: 'ARS', status: 'vigente', frequency: 'mensual' }}
            title={(c) => `${c.kind.charAt(0).toUpperCase() + c.kind.slice(1)}${c.counterpart ? ` · ${c.counterpart}` : ''}`}
            sub={(c) => [c.amount != null && `${formatMoney(c.amount, c.currency)} ${c.frequency ?? ''}`, c.startDate && `desde ${formatDate(c.startDate, { year: true })}`, c.endDate && `hasta ${formatDate(c.endDate, { year: true })}`, c.adjustment].filter(Boolean).join(' · ')}
            status={(c) => contractStatus(c)} />
        )}
        {inv && tab === 'impuestos' && (
          <ChildList entity="investmentTaxes" fields={TAX_FIELDS} items={own(taxes).sort((a, b) => ((a.dueDate ?? '') < (b.dueDate ?? '') ? 1 : -1))} investmentId={inv.id} draft={{ currency: 'ARS', status: 'pendiente', dueDate: today() }}
            title={(t) => `${t.tax}${t.period ? ` · ${t.period}` : ''}`}
            sub={(t) => [t.dueDate && `vence ${formatDate(t.dueDate, { year: true })}`, t.amount != null && formatMoney(t.amount, t.currency), t.paidDate && `pagado ${formatDate(t.paidDate)}`].filter(Boolean).join(' · ')}
            status={(t) => taxStatus(t)}
            actions={(t) => (<>
              {t.status !== 'pagado' && editable && <button className="btn btn-sm" onClick={() => run(() => markTaxPaid(repo, t.id, { by: profile?.id }), 'Marcado como pagado')}><Check size={14} /> Pagado</button>}
              {t.status === 'pagado' && editable && <button className="btn btn-sm btn-ghost" onClick={() => run(() => repo.create('investmentTaxes', nextPeriodDraft(t), { by: profile?.id }), 'Próximo período cargado como pendiente')}>+ Próximo período</button>}
            </>)} />
        )}
        {inv && tab === 'mantenimiento' && (
          <ChildList entity="investmentWorks" fields={WORK_FIELDS} items={own(works)} investmentId={inv.id} draft={{ currency: 'ARS', status: 'pendiente', date: today() }}
            title={(w) => w.title} sub={(w) => [w.date && formatDate(w.date, { year: true }), w.provider, w.cost != null && formatMoney(w.cost, w.currency), w.paidBy && `pagó ${w.paidBy}`].filter(Boolean).join(' · ')} status={(w) => w.status} />
        )}
        {inv && tab === 'documentos' && <div className="stack"><InvestmentDocs inv={inv} /><DriveFiles inv={inv} /></div>}
      </Sheet>
      <ConfirmSheet open={del} onClose={() => setDel(false)} title="Eliminar inversión" danger confirmLabel="Eliminar"
        message={<p>Se marca como eliminada en la app y en la planilla. Su carpeta en Drive y los archivos <strong>no</strong> se borran.</p>}
        onConfirm={() => { run(() => repo.remove('investments', inv!.id, { by: profile?.id }), 'Inversión eliminada').then(onClose); }} />
    </>
  );
}

function ChildList<T extends { id: string; investmentId: string; _sync?: any }>({ entity, fields, items, investmentId, draft, title, sub, status, actions }: {
  entity: 'investmentContracts' | 'investmentTaxes' | 'investmentWorks'; fields: FieldDef[]; items: T[]; investmentId: string; draft: Record<string, any>;
  title: (t: T) => string; sub: (t: T) => string; status: (t: T) => string; actions?: (t: T) => React.ReactNode;
}) {
  const { repo, profile, run, can, backend } = useApp();
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const [errs, setErrs] = useState<string[]>([]);
  const editable = can('finance.edit');
  const save = async () => {
    const rec: Record<string, any> = { ...editing, investmentId };
    const e = validateRecord(entity, { id: 'x', ...rec });
    setErrs(e);
    if (e.length) return;
    const ok = await run(() => (rec.id ? repo.update(entity, rec.id, clean(rec), { by: profile?.id }) : repo.create(entity, clean(rec) as any, { by: profile?.id })), 'Guardado');
    if (ok) setEditing(null);
  };
  if (editing) {
    return (
      <div className="stack">
        <RecordForm fields={fields} value={editing} onChange={setEditing} errors={errs} />
        <div className="row">
          {editing.id && <button className="btn btn-danger btn-sm" onClick={() => run(() => repo.remove(entity, editing.id, { by: profile?.id }), 'Eliminado').then(() => setEditing(null))}>Eliminar</button>}
          <span className="spacer" />
          <button className="btn" onClick={() => setEditing(null)}>Volver</button>
          <button className="btn btn-primary" onClick={save}>Guardar</button>
        </div>
      </div>
    );
  }
  return (
    <div className="stack-sm">
      {editable && <button className="btn btn-sm" onClick={() => { setErrs([]); setEditing({ ...draft }); }}><Plus size={14} /> Agregar</button>}
      {items.length === 0 ? <p className="muted small">Todavía no hay registros. También se pueden cargar directamente en la planilla “Inversiones” de Drive.</p> : (
        <div className="card"><ul className="list">
          {items.map((t) => (
            <li key={t.id}>
              <div className="item">
                <button type="button" className="item-main item-main-btn" onClick={() => editable && setEditing({ ...t })}>
                  <div className="item-title">{title(t)}</div>
                  <div className="item-sub"><span>{sub(t)}</span><SyncMark state={t._sync} configured={!!backend} /></div>
                </button>
                <StatusChip tone={tone(status(t))}>{status(t)}</StatusChip>
                {actions?.(t)}
              </div>
            </li>
          ))}
        </ul></div>
      )}
    </div>
  );
}

function InvestmentDocs({ inv }: { inv: Investment }) {
  const { repo, profile, run } = useApp();
  const [cat, setCat] = useState('contratos');
  const docs = useLive((r) => r.db.entity('documents').filter((d) => !d.deleted && d.relatedType === 'investments' && d.relatedId === inv.id).toArray(), [inv.id], [] as DocumentRecord[]);
  const open = useOpenAttachment();
  return (
    <div className="stack-sm">
      <div className="row-wrap">
        <select className="input" style={{ width: 'auto' }} aria-label="Tipo de documento" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="contratos">Contrato</option><option value="impuestos">Impuesto / boleta</option><option value="comprobantes">Comprobante de pago</option>
          <option value="vivienda">Escritura / planos</option><option value="seguros">Seguro</option><option value="otros">Otro</option>
        </select>
        <FilePickButton label="Subir archivo" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" onFiles={async (fs) => {
          for (const f of fs) await run(() => addDocument(repo, { name: f.name.replace(/\.[^.]+$/, ''), category: cat, file: f, fileName: f.name, relatedType: 'investments', relatedId: inv.id, visibility: 'adultos' }, profile?.id));
        }} />
      </div>
      <p className="tiny muted">Se guardan en Drive: Inversiones / {inv.name} / {cat === 'contratos' ? 'Contratos' : ['impuestos', 'comprobantes'].includes(cat) ? 'Impuestos' : 'Otros'}.</p>
      {docs.length === 0 ? <p className="muted small">Sin documentos.</p> : (
        <div className="card"><ul className="list">{docs.map((d) => (
          <li key={d.id}><button className="item" onClick={() => d.attachmentId && open(d.attachmentId)}><FileText size={18} className="muted" /><div className="item-main"><div className="item-title">{d.name}</div><div className="item-sub">{d.category}{d.date ? ` · ${formatDate(d.date, { year: true })}` : ''}</div></div></button></li>
        ))}</ul></div>
      )}
    </div>
  );
}
