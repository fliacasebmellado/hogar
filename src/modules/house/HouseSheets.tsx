import { useEffect, useState } from 'react';
import { useApp, useLive } from '../../app/context';
import type { Asset, Maintenance, Provider, Repair, Room } from '../../domain/types';
import { Sheet } from '../../ui/Sheet';
import { CategorySelect, Checkbox, DateField, NumberField, PersonSelect, RecurrenceField, SelectField, TextArea, TextField } from '../../ui/fields';
import { AttachmentList, HistoryList } from '../../ui/records';
import { DocField } from '../../ui/DocField';
import { Banner, StatusChip } from '../../ui/components';
import { createMaintenance, createRepair, linkRepairInvoice, updateMaintenance, warrantyStatus } from '../../services/house';
import { createTask } from '../../services/tasks';
import { validateRecord } from '../../domain/validation';
import { REPAIR_STATUS_LABEL } from '../../domain/catalog';
import { formatMoney } from '../../domain/finance';
import { formatDate, today } from '../../domain/dates';
import { describeRecurrence } from '../../domain/recurrence';
import type { EntityName } from '../../domain/types';

function clean<T>(d: Partial<T>): any { const { id, version, createdAt, updatedAt, rev, _sync, ...rest } = d as any; return rest; }

function useSave<T>(entity: EntityName, record: { id: string } | null | undefined, onClose: () => void) {
  const { repo, profile, run } = useApp();
  return async (d: Partial<T>, label: string) => {
    const errs = validateRecord(entity, { id: 'x', ...d });
    if (errs.length) return errs;
    const ok = await run(() => (record ? repo.update(entity, record.id, clean(d), { by: profile?.id }) : repo.create(entity, clean(d), { by: profile?.id })), record ? 'Cambios guardados' : `${label} creado`);
    if (ok) onClose();
    return [];
  };
}

function Foot({ onSave, onDelete, canDelete }: { onSave: () => void; onDelete?: () => void; canDelete: boolean }) {
  return <>{canDelete && onDelete && <button className="btn btn-danger" onClick={onDelete}>Eliminar</button>}<span className="spacer" /><button className="btn btn-primary" onClick={onSave}>Guardar</button></>;
}

export function RoomSheet({ open, onClose, room }: { open: boolean; onClose: () => void; room?: Room | null }) {
  const { repo, profile, run } = useApp();
  const [d, setD] = useState<Partial<Room>>({});
  const [errs, setErrs] = useState<string[]>([]);
  useEffect(() => { if (open) { setD(room ? { ...room } : { name: '' }); setErrs([]); } }, [open, room?.id]);
  const save = useSave<Room>('rooms', room, onClose);
  return (
    <Sheet open={open} onClose={onClose} title={room ? 'Ambiente' : 'Nuevo ambiente'}
      footer={<Foot canDelete={!!room} onSave={async () => setErrs(await save(d, 'Ambiente'))} onDelete={() => run(() => repo.remove('rooms', room!.id, { by: profile?.id }), 'Ambiente eliminado').then(onClose)} />}>
      <div className="form">
        {errs.length > 0 && <div className="banner banner-alert" role="alert">{errs.join(' ')}</div>}
        <TextField label="Nombre" required value={d.name} onChange={(v) => setD({ ...d, name: v })} placeholder="Cocina, Living, Patio…" autoFocus={!room} />
        <TextField label="Planta / sector" value={d.floor} onChange={(v) => setD({ ...d, floor: v })} />
        <TextArea label="Notas" value={d.notes} onChange={(v) => setD({ ...d, notes: v })} rows={2} />
      </div>
    </Sheet>
  );
}

export function ProviderSheet({ open, onClose, provider }: { open: boolean; onClose: () => void; provider?: Provider | null }) {
  const { repo, profile, run } = useApp();
  const [d, setD] = useState<Partial<Provider>>({});
  const [errs, setErrs] = useState<string[]>([]);
  useEffect(() => { if (open) { setD(provider ? { ...provider } : { name: '' }); setErrs([]); } }, [open, provider?.id]);
  const save = useSave<Provider>('providers', provider, onClose);
  return (
    <Sheet open={open} onClose={onClose} title={provider ? 'Proveedor' : 'Nuevo proveedor'}
      footer={<Foot canDelete={!!provider} onSave={async () => setErrs(await save(d, 'Proveedor'))} onDelete={() => run(() => repo.remove('providers', provider!.id, { by: profile?.id }), 'Proveedor eliminado').then(onClose)} />}>
      <div className="form">
        {errs.length > 0 && <div className="banner banner-alert" role="alert">{errs.join(' ')}</div>}
        <TextField label="Nombre" required value={d.name} onChange={(v) => setD({ ...d, name: v })} autoFocus={!provider} />
        <TextField label="Rubro" value={d.trade} onChange={(v) => setD({ ...d, trade: v })} placeholder="Plomero, electricista, piletero…" />
        <div className="form-row">
          <TextField label="Teléfono" type="tel" value={d.phone} onChange={(v) => setD({ ...d, phone: v })} />
          <TextField label="Correo" type="email" value={d.email} onChange={(v) => setD({ ...d, email: v })} />
        </div>
        {d.phone && <a className="btn btn-sm" href={`tel:${d.phone}`}>Llamar</a>}
        <TextField label="Dirección" value={d.address} onChange={(v) => setD({ ...d, address: v })} />
        <TextArea label="Notas" value={d.notes} onChange={(v) => setD({ ...d, notes: v })} rows={2} />
      </div>
    </Sheet>
  );
}

export function AssetSheet({ open, onClose, asset }: { open: boolean; onClose: () => void; asset?: Asset | null }) {
  const { repo, profile, categories, run, can } = useApp();
  const [d, setD] = useState<Partial<Asset>>({});
  const [errs, setErrs] = useState<string[]>([]);
  const rooms = useLive((r) => r.list('rooms'), [], [] as Room[]);
  const providers = useLive((r) => r.list('providers'), [], [] as Provider[]);
  const related = useLive(async (r) => {
    if (!asset) return { repairs: [], plans: [], cost: 0 };
    const [repairs, plans, expenses] = await Promise.all([r.list('repairs'), r.list('maintenance'), r.list('expenses')]);
    const reps = repairs.filter((x) => x.assetId === asset.id);
    const cost = expenses.filter((e) => e.assetId === asset.id || reps.some((rp) => rp.expenseId === e.id)).reduce((a, e) => a + (e.currency === 'ARS' ? e.amount : 0), 0);
    return { repairs: reps, plans: plans.filter((m) => m.assetId === asset.id), cost };
  }, [asset?.id], { repairs: [] as Repair[], plans: [] as Maintenance[], cost: 0 });
  useEffect(() => { if (open) { setD(asset ? { ...asset } : { name: '', category: 'electrodomesticos', photoIds: [] }); setErrs([]); } }, [open, asset?.id]);
  const save = useSave<Asset>('assets', asset, onClose);
  const w = warrantyStatus(d.warrantyUntil);
  return (
    <Sheet open={open} onClose={onClose} title={asset ? asset.name : 'Nuevo elemento de la casa'}
      footer={<Foot canDelete={!!asset && can('house.edit')} onSave={async () => setErrs(await save(d, 'Elemento'))} onDelete={() => run(() => repo.remove('assets', asset!.id, { by: profile?.id }), 'Elemento eliminado').then(onClose)} />}>
      <div className="form">
        {errs.length > 0 && <div className="banner banner-alert" role="alert">{errs.join(' ')}</div>}
        <TextField label="Nombre" required value={d.name} onChange={(v) => setD({ ...d, name: v })} placeholder="Lavarropas, bomba de la pileta…" autoFocus={!asset} />
        <div className="form-row">
          <CategorySelect value={d.category} onChange={(v) => setD({ ...d, category: v })} categories={categories('assets')} required />
          <SelectField label="Ambiente" value={d.roomId ?? ''} onChange={(v) => setD({ ...d, roomId: v || undefined })} options={[{ value: '', label: '—' }, ...rooms.map((r) => ({ value: r.id, label: r.name }))]} />
        </div>
        <div className="form-row">
          <TextField label="Marca" value={d.brand} onChange={(v) => setD({ ...d, brand: v })} />
          <TextField label="Modelo" value={d.model} onChange={(v) => setD({ ...d, model: v })} />
        </div>
        <div className="form-row">
          <DateField label="Compra / instalación" value={d.purchaseDate} onChange={(v) => setD({ ...d, purchaseDate: v })} />
          <DateField label="Garantía hasta" value={d.warrantyUntil} onChange={(v) => setD({ ...d, warrantyUntil: v })} />
        </div>
        {w && <div><StatusChip tone={w === 'vigente' ? 'ok' : w === 'por_vencer' ? 'warn' : 'neutral'}>Garantía {w.replace('_', ' ')}</StatusChip></div>}
        <SelectField label="Proveedor / service" value={d.providerId ?? ''} onChange={(v) => setD({ ...d, providerId: v || undefined })} options={[{ value: '', label: '—' }, ...providers.map((p) => ({ value: p.id, label: p.name }))]} />
        <DocField label="Manual" category="manuales" related={{ type: 'assets', id: asset?.id }} docId={d.manualDocId} onChange={(id) => setD({ ...d, manualDocId: id })} />
        <details className="more"><summary>Datos técnicos, fotos y notas</summary>
          <div className="form" style={{ marginTop: 8 }}>
            <TextField label="N.º de serie" value={d.serial} onChange={(v) => setD({ ...d, serial: v })} />
            <TextArea label="Datos técnicos" value={d.specs} onChange={(v) => setD({ ...d, specs: v })} rows={2} />
            <div className="field"><span className="field-label">Fotos</span><AttachmentList ids={d.photoIds ?? []} folder="casa/Fotos" onChange={(ids) => setD({ ...d, photoIds: ids })} /></div>
            <TextArea label="Notas" value={d.notes} onChange={(v) => setD({ ...d, notes: v })} rows={2} />
          </div>
        </details>
        {asset && (
          <div className="stack-sm">
            <h3>Historial del elemento</h3>
            {related.repairs.length ? related.repairs.map((r) => <div key={r.id} className="small">Reparación: {r.title} · {REPAIR_STATUS_LABEL[r.status]} · {formatDate(r.reportedAt)}{r.cost ? ` · ${formatMoney(r.cost)}` : ''}</div>) : <p className="muted small">Sin reparaciones registradas.</p>}
            {related.plans.map((m) => <div key={m.id} className="small">Mantenimiento: {m.title} · {describeRecurrence(m.recurrence)}</div>)}
            {can('finance.view') && <p className="small">Costos asociados registrados: <strong>{formatMoney(related.cost)}</strong></p>}
            <details className="more"><summary>Cambios</summary><HistoryList entity="assets" recordId={asset.id} /></details>
          </div>
        )}
      </div>
    </Sheet>
  );
}

export function RepairSheet({ open, onClose, repair }: { open: boolean; onClose: () => void; repair?: Repair | null }) {
  const { repo, profile, profiles, run, can } = useApp();
  const [d, setD] = useState<Partial<Repair> & { withTask?: boolean; taskAssigneeId?: string; taskDueDate?: string }>({});
  const [errs, setErrs] = useState<string[]>([]);
  const [inv, setInv] = useState<{ amount?: number; date?: string; docId?: string } | null>(null);
  const rooms = useLive((r) => r.list('rooms'), [], [] as Room[]);
  const assets = useLive((r) => r.list('assets'), [], [] as Asset[]);
  const providers = useLive((r) => r.list('providers'), [], [] as Provider[]);
  const task = useLive((r) => (repair?.taskId ? r.get('tasks', repair.taskId) : undefined), [repair?.taskId], undefined);
  useEffect(() => { if (open) { setD(repair ? { ...repair } : { title: '', status: 'reportada', reportedAt: today(), withTask: true, taskAssigneeId: profile?.id }); setErrs([]); setInv(null); } }, [open, repair?.id]);
  const save = async () => {
    const e = validateRecord('repairs', { id: 'x', ...d });
    setErrs(e);
    if (e.length) return;
    const { withTask, taskAssigneeId, taskDueDate, ...data } = d;
    const patch = { ...clean<Repair>(data), resolvedAt: data.status === 'resuelta' ? data.resolvedAt ?? today() : undefined };
    const ok = await run<unknown>(() => (repair ? repo.update('repairs', repair.id, patch, { by: profile?.id }) : createRepair(repo, { ...patch, title: d.title!, createTask: withTask, taskAssigneeId, taskDueDate }, profile?.id)), repair ? 'Reparación actualizada' : 'Reparación registrada');
    if (ok) onClose();
  };
  const assetRoom = (id?: string) => assets.find((a) => a.id === id)?.roomId;
  return (
    <Sheet open={open} onClose={onClose} title={repair ? 'Reparación' : 'Nueva reparación'}
      footer={<Foot canDelete={!!repair} onSave={save} onDelete={() => run(() => repo.remove('repairs', repair!.id, { by: profile?.id }), 'Reparación eliminada').then(onClose)} />}>
      <div className="form">
        {errs.length > 0 && <div className="banner banner-alert" role="alert">{errs.join(' ')}</div>}
        <TextField label="¿Qué hay que reparar?" required value={d.title} onChange={(v) => setD({ ...d, title: v })} autoFocus={!repair} />
        <TextArea label="Descripción" value={d.description} onChange={(v) => setD({ ...d, description: v })} rows={2} />
        <div className="form-row">
          <SelectField label="Elemento" value={d.assetId ?? ''} onChange={(v) => setD({ ...d, assetId: v || undefined, roomId: d.roomId ?? assetRoom(v) })} options={[{ value: '', label: '—' }, ...assets.map((a) => ({ value: a.id, label: a.name }))]} />
          <SelectField label="Ambiente" value={d.roomId ?? ''} onChange={(v) => setD({ ...d, roomId: v || undefined })} options={[{ value: '', label: '—' }, ...rooms.map((r) => ({ value: r.id, label: r.name }))]} />
        </div>
        <div className="form-row">
          <SelectField label="Estado" value={d.status} onChange={(v) => setD({ ...d, status: v as any })} options={Object.entries(REPAIR_STATUS_LABEL).map(([value, label]) => ({ value: value as any, label }))} />
          <DateField label="Reportada" value={d.reportedAt} onChange={(v) => setD({ ...d, reportedAt: v })} />
        </div>
        <SelectField label="Proveedor" value={d.providerId ?? ''} onChange={(v) => setD({ ...d, providerId: v || undefined })} options={[{ value: '', label: '—' }, ...providers.map((p) => ({ value: p.id, label: `${p.name}${p.trade ? ` (${p.trade})` : ''}` }))]} />
        {!repair && (
          <>
            <Checkbox label="Crear una tarea para gestionarla" checked={!!d.withTask} onChange={(v) => setD({ ...d, withTask: v })} />
            {d.withTask && <div className="form-row">
              <PersonSelect label="Responsable de la tarea" value={d.taskAssigneeId} onChange={(v) => setD({ ...d, taskAssigneeId: v })} profiles={profiles} />
              <DateField label="Fecha de la tarea" value={d.taskDueDate} onChange={(v) => setD({ ...d, taskDueDate: v })} />
            </div>}
          </>
        )}
        {repair && (
          <div className="stack-sm">
            {task ? <p className="small">Tarea vinculada: <a href={`#/tareas?id=${task.id}`}>{task.title}</a> ({task.status})</p>
              : <button className="btn btn-sm" onClick={() => run(async () => { const t = await createTask(repo, { title: `Reparar: ${repair.title}`, category: 'mantenimiento', relatedType: 'repairs', relatedId: repair.id, assetId: repair.assetId, roomId: repair.roomId }, { by: profile?.id }); await repo.update('repairs', repair.id, { taskId: t.id }, { by: profile?.id }); }, 'Tarea creada')}>Crear tarea</button>}
            {can('finance.edit') && (repair.expenseId
              ? <p className="small">Factura vinculada al gasto: <strong>{formatMoney(repair.cost)}</strong>. <button className="link-btn" onClick={() => setInv({ amount: repair.cost, date: today(), docId: repair.invoiceDocId })}>Corregir</button></p>
              : <button className="btn btn-sm" onClick={() => setInv({ date: today() })}>Vincular factura / registrar costo</button>)}
            {inv && (
              <div className="card card-pad form">
                <Banner tone="info">Se registra un único gasto vinculado a esta reparación y su factura. Si ya existía, se actualiza.</Banner>
                <div className="form-row">
                  <NumberField label="Importe (ARS)" required value={inv.amount} onChange={(v) => setInv({ ...inv, amount: v })} />
                  <DateField label="Fecha" value={inv.date} onChange={(v) => setInv({ ...inv, date: v })} />
                </div>
                <DocField label="Factura" category="facturas" related={{ type: 'repairs', id: repair.id }} docId={inv.docId} onChange={(id) => setInv({ ...inv, docId: id })} />
                <button className="btn btn-primary" disabled={!inv.amount} onClick={() => run(() => linkRepairInvoice(repo, repair.id, { amount: inv.amount!, date: inv.date, docId: inv.docId, by: profile?.id }), 'Factura vinculada').then((r) => { if (r) { setInv(null); onClose(); } })}>Guardar factura</button>
              </div>
            )}
            <details className="more"><summary>Historial</summary><HistoryList entity="repairs" recordId={repair.id} /></details>
          </div>
        )}
      </div>
    </Sheet>
  );
}

export function MaintenanceSheet({ open, onClose, plan }: { open: boolean; onClose: () => void; plan?: Maintenance | null }) {
  const { repo, profile, profiles, categories, run } = useApp();
  const [d, setD] = useState<Partial<Maintenance> & { startDate?: string }>({});
  const [errs, setErrs] = useState<string[]>([]);
  const assets = useLive((r) => r.list('assets'), [], [] as Asset[]);
  const rooms = useLive((r) => r.list('rooms'), [], [] as Room[]);
  useEffect(() => { if (open) { setD(plan ? { ...plan } : { title: '', category: 'preventivo', active: true, recurrence: null as any, startDate: today(), assigneeId: profile?.id }); setErrs([]); } }, [open, plan?.id]);
  const save = async () => {
    const e = validateRecord('maintenance', { id: 'x', ...d });
    setErrs(e);
    if (e.length) return;
    const { startDate, ...rest } = d;
    const ok = await run(() => (plan ? updateMaintenance(repo, plan.id, clean(rest), profile?.id) : createMaintenance(repo, { ...clean<Maintenance>(rest), title: d.title!, recurrence: d.recurrence!, startDate }, profile?.id)), plan ? 'Plan actualizado' : 'Plan de mantenimiento creado');
    if (ok) onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={plan ? 'Mantenimiento' : 'Nuevo mantenimiento'}
      footer={<Foot canDelete={!!plan} onSave={save} onDelete={() => run(() => updateMaintenance(repo, plan!.id, { active: false }, profile?.id).then(() => repo.remove('maintenance', plan!.id, { by: profile?.id })), 'Plan eliminado').then(onClose)} />}>
      <div className="form">
        {errs.length > 0 && <div className="banner banner-alert" role="alert">{errs.join(' ')}</div>}
        <TextField label="Tarea de mantenimiento" required value={d.title} onChange={(v) => setD({ ...d, title: v })} placeholder="Limpiar filtro, purgar radiadores…" autoFocus={!plan} />
        <CategorySelect value={d.category} onChange={(v) => setD({ ...d, category: v })} categories={categories('maintenance')} required />
        <div className="form-row">
          <SelectField label="Elemento" value={d.assetId ?? ''} onChange={(v) => setD({ ...d, assetId: v || undefined })} options={[{ value: '', label: '—' }, ...assets.map((a) => ({ value: a.id, label: a.name }))]} />
          <SelectField label="Ambiente" value={d.roomId ?? ''} onChange={(v) => setD({ ...d, roomId: v || undefined })} options={[{ value: '', label: '—' }, ...rooms.map((r) => ({ value: r.id, label: r.name }))]} />
        </div>
        <RecurrenceField label="Frecuencia (obligatoria)" value={d.recurrence} onChange={(v) => setD({ ...d, recurrence: v as any })} hint="La app no impone frecuencias técnicas: usá la del manual, el técnico o la que decida la familia." />
        <TextField label="Fuente de la frecuencia" value={d.frequencySource} onChange={(v) => setD({ ...d, frequencySource: v })} placeholder="Manual del fabricante, técnico, criterio propio…" />
        {!plan && <DateField label="Primera vez" value={d.startDate} onChange={(v) => setD({ ...d, startDate: v })} />}
        <PersonSelect label="Responsable" value={d.assigneeId} onChange={(v) => setD({ ...d, assigneeId: v })} profiles={profiles} />
        {plan && <Checkbox label="Activo (genera tareas)" checked={d.active !== false} onChange={(v) => setD({ ...d, active: v })} />}
        <TextArea label="Notas" value={d.notes} onChange={(v) => setD({ ...d, notes: v })} rows={2} />
      </div>
    </Sheet>
  );
}
