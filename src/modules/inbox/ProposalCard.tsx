// Tarjeta de revisión de una propuesta: muestra lo interpretado, pregunta lo ambiguo y permite editar todo.
import { AlertTriangle, CheckCircle2, HelpCircle, Copy, Link2 } from 'lucide-react';
import { useApp, useLive } from '../../app/context';
import type { Proposal, ProposalKind } from '../../ai/types';
import { KIND_LABEL, KIND_MODULE } from '../../ai/types';
import { blockingIssues, FIELD_LABEL } from '../../ai/finalize';
import { changeKind, resolveAmbiguity } from '../../ai/pipeline';
import { CategorySelect, Checkbox, DateField, NumberField, PeoplePicker, PersonSelect, RecurrenceField, SelectField, TextArea, TextField, TimeField } from '../../ui/fields';
import { CURRENCIES, ENTITY_LABEL, PRIORITY_LABEL, UNITS, VISIBILITY_LABEL } from '../../domain/catalog';
import type { Asset, ShoppingList } from '../../domain/types';

const KINDS: ProposalKind[] = ['evento', 'tarea', 'compra', 'pago', 'gasto', 'documento', 'reparacion', 'mantenimiento', 'nota', 'consulta', 'otro'];
// Qué campo resuelve cada tipo de ambigüedad cuando la persona lo edita a mano.
const AMBIG_FIELDS: Record<string, string[]> = { date: ['start', 'dueDate', 'date'], time: ['start', 'dueTime', 'allDay'], amount: ['amount'], responsible: ['assigneeId', 'ownerId', 'responsibleId', 'taskAssigneeId'], category: ['category'] };

export function ProposalCard({ p, onChange }: { p: Proposal; onChange: (p: Proposal) => void }) {
  const { profiles, categories, can } = useApp();
  const lists = useLive((r) => r.list('shoppingLists'), [], [] as ShoppingList[]);
  const assets = useLive((r) => r.list('assets'), [], [] as Asset[]);
  const f = p.fields;
  const setF = (patch: Record<string, any>) => {
    const keys = Object.keys(patch);
    const ambiguities = p.ambiguities.map((a) => (!a.resolved && (AMBIG_FIELDS[a.field] ?? []).some((k) => keys.includes(k)) ? { ...a, resolved: true } : a));
    onChange({ ...p, fields: { ...f, ...patch }, ambiguities });
  };
  const issues = blockingIssues(p);
  const financeBlocked = (p.kind === 'pago' || p.kind === 'gasto') && !can('finance.edit');
  const score = p.ruleScore == null ? null : p.ruleScore >= 0.75 ? 'alta' : p.ruleScore >= 0.45 ? 'media' : 'baja';
  const dateOf = (s?: string) => (s ? s.slice(0, 10) : undefined);
  const timeOf = (s?: string) => (s && s.length > 10 ? s.slice(11, 16) : undefined);

  return (
    <article className={`proposal${p.include ? '' : ' excluded'}`} aria-label={`Propuesta: ${KIND_LABEL[p.kind]}`}>
      <div className="proposal-head">
        <Checkbox label={<strong>Guardar</strong>} checked={p.include} onChange={(v) => onChange({ ...p, include: v })} />
        <select className="input" style={{ width: 'auto', minHeight: 36 }} aria-label="Tipo de registro" value={p.kind} onChange={(e) => onChange(changeKind(p, e.target.value as ProposalKind))}>
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <span className="muted small">→ {KIND_MODULE[p.kind]}</span>
        <span className="spacer" />
        {score && <span className="chip" title="Indicador heurístico de coincidencia de reglas; no es una probabilidad">Coincidencia {score}</span>}
        {p.include && (issues.length ? <span className="chip chip-warn"><AlertTriangle size={12} /> Revisar</span> : <span className="chip chip-ok"><CheckCircle2 size={12} /> Lista</span>)}
      </div>
      <div className="proposal-body">
        {p.sourceText && <div className="source-quote" aria-label="Texto original">{p.sourceText}</div>}
        {financeBlocked && <div className="banner banner-warn">Tu perfil no puede registrar pagos ni gastos. Pedile a un adulto que lo confirme o cambiá el tipo.</div>}
        {p.ambiguities.map((a, i) => (
          <div key={i} className={`question${a.resolved ? ' resolved' : ''}`} role={a.resolved ? undefined : 'alert'}>
            <div className="row small"><HelpCircle size={16} /> <strong>{a.resolved ? 'Resuelto: ' : 'Aclarar: '}</strong>{a.message}</div>
            {!a.resolved && a.options && (
              <div className="opts">{a.options.map((o, k) => <button key={k} type="button" onClick={() => onChange(resolveAmbiguity(p, i, o.value))}>{o.label}</button>)}</div>
            )}
            {!a.resolved && !a.options && <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => onChange({ ...p, ambiguities: p.ambiguities.map((x, k) => (k === i ? { ...x, resolved: true } : x)) })}>Ya lo revisé</button>}
            {!a.resolved && a.options && <div className="tiny" style={{ marginTop: 4 }}>…o completalo a mano abajo.</div>}
          </div>
        ))}
        {p.include && p.missing.length > 0 && <div className="banner banner-warn">Faltan datos: {p.missing.map((m) => FIELD_LABEL[m] ?? m).join(', ')}.</div>}
        {p.warnings.length > 0 && <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{p.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        {p.duplicates.length > 0 && (
          <div className="card card-pad stack-sm" style={{ background: 'var(--surface-2)' }}>
            <div className="row small"><Copy size={16} /> <strong>Posible duplicado de un registro existente</strong></div>
            {p.duplicates.map((d) => <div key={d.id} className="small">• {ENTITY_LABEL[d.entity]}: "{d.title}"{d.detail ? ` (${d.detail})` : ''}</div>)}
            <div className="chips-toggle" role="radiogroup" aria-label="Qué hacer con el posible duplicado">
              {([['nuevo', 'Crear uno nuevo igualmente'], ['actualizar', 'Actualizar el existente'], ['vincular', 'Solo vincular']] as const)
                .filter(([v]) => v !== 'actualizar' || ['evento', 'tarea', 'pago'].includes(p.kind))
                .map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={p.duplicateChoice === v} aria-pressed={p.duplicateChoice === v} onClick={() => onChange({ ...p, duplicateChoice: v, duplicateTargetId: p.duplicates[0].id })}>{l}</button>)}
            </div>
          </div>
        )}
        {p.kind === 'gasto' && p.relations.filter((r) => r.kind === 'marcar_pagado').length > 0 && (
          <div className="card card-pad stack-sm" style={{ background: 'var(--surface-2)' }}>
            <div className="row small"><Link2 size={16} /> <strong>¿Corresponde a un pago pendiente?</strong></div>
            <SelectField label="Si es así, se confirma ese pago (un solo gasto, sin duplicar)" value={f.markPaymentId ?? ''} onChange={(v) => setF({ markPaymentId: v || undefined })}
              options={[{ value: '', label: 'No, es un gasto aparte' }, ...p.relations.filter((r) => r.kind === 'marcar_pagado').map((r) => ({ value: r.id, label: r.label }))]} />
          </div>
        )}

        {p.include && (
          <div className="form">
            {p.kind === 'evento' && <>
              <TextField label="Título" required value={f.title} onChange={(v) => setF({ title: v })} />
              <div className="form-row">
                <DateField label="Fecha" required value={dateOf(f.start)} onChange={(v) => setF({ start: v ? (f.allDay || !timeOf(f.start) ? v : `${v}T${timeOf(f.start)}`) : undefined })} />
                <TimeField label="Hora" value={timeOf(f.start)} onChange={(v) => setF({ start: dateOf(f.start) ? (v ? `${dateOf(f.start)}T${v}` : dateOf(f.start)) : undefined, allDay: !v })} />
              </div>
              <div className="form-row">
                <CategorySelect value={f.category} onChange={(v) => setF({ category: v })} categories={categories('events')} />
                <TextField label="Lugar" value={f.location} onChange={(v) => setF({ location: v })} />
              </div>
              <PeoplePicker label="Participantes" value={f.participantIds ?? []} onChange={(v) => setF({ participantIds: v })} profiles={profiles} />
              <PersonSelect label="Responsable principal" value={f.ownerId} onChange={(v) => setF({ ownerId: v })} profiles={profiles} />
              <RecurrenceField value={f.recurrence} onChange={(v) => setF({ recurrence: v })} />
              <Checkbox label="Enviar a Google Calendar" checked={!!f.syncCalendar} onChange={(v) => setF({ syncCalendar: v })} />
            </>}
            {p.kind === 'tarea' && <>
              <TextField label="Título" required value={f.title} onChange={(v) => setF({ title: v })} />
              <div className="form-row">
                <DateField label="Fecha límite" value={f.dueDate} onChange={(v) => setF({ dueDate: v })} />
                <TimeField label="Hora" value={f.dueTime} onChange={(v) => setF({ dueTime: v })} />
              </div>
              <div className="form-row">
                <PersonSelect label="Responsable" value={f.assigneeId} onChange={(v) => setF({ assigneeId: v })} profiles={profiles} />
                <SelectField label="Prioridad" value={f.priority} onChange={(v) => setF({ priority: v })} options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))} />
              </div>
              <CategorySelect value={f.category} onChange={(v) => setF({ category: v })} categories={categories('tasks')} />
              <RecurrenceField value={f.recurrence} onChange={(v) => setF({ recurrence: v, dueDate: f.dueDate })} />
            </>}
            {p.kind === 'compra' && <>
              <SelectField label="Lista" value={f.listId ?? 'list-principal'} onChange={(v) => setF({ listId: v })} options={lists.filter((l) => !l.isTemplate && !l.archived).map((l) => ({ value: l.id, label: l.name }))} />
              {(f.items ?? []).map((it: any, i: number) => {
                const upd = (patch: any) => setF({ items: f.items.map((x: any, k: number) => (k === i ? { ...x, ...patch } : x)) });
                return (
                  <div key={i} className="row-wrap" style={{ alignItems: 'flex-end' }}>
                    <input type="checkbox" aria-label={`Incluir ${it.name}`} checked={it.include} onChange={(e) => upd({ include: e.target.checked, confirmedDuplicate: it.duplicateOf ? e.target.checked : undefined })} style={{ width: 20, height: 20 }} />
                    <input className="input" style={{ flex: 2, minWidth: 120 }} aria-label="Producto" value={it.name} onChange={(e) => upd({ name: e.target.value })} />
                    <input className="input" style={{ width: 70 }} type="number" min="0" step="any" aria-label="Cantidad" value={it.quantity ?? ''} onChange={(e) => upd({ quantity: e.target.value ? Number(e.target.value) : undefined })} />
                    <select className="input" style={{ width: 80 }} aria-label="Unidad" value={it.unit ?? ''} onChange={(e) => upd({ unit: e.target.value || undefined })}><option value="">—</option>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
                    {it.duplicateOf && <span className="chip chip-warn">Ya está en la lista</span>}
                  </div>
                );
              })}
              <button type="button" className="btn btn-sm" onClick={() => setF({ items: [...(f.items ?? []), { name: '', include: true, category: 'supermercado' }] })}>Agregar producto</button>
            </>}
            {(p.kind === 'pago' || p.kind === 'gasto') && <>
              <TextField label="Concepto" required value={f.concept} onChange={(v) => setF({ concept: v })} />
              <div className="form-row">
                <NumberField label="Importe" required={p.kind === 'gasto'} value={f.amount} onChange={(v) => setF({ amount: v })} />
                <SelectField label="Moneda" value={f.currency} onChange={(v) => setF({ currency: v })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
              </div>
              <div className="form-row">
                {p.kind === 'pago' ? <DateField label="Vencimiento" required value={f.dueDate} onChange={(v) => setF({ dueDate: v })} /> : <DateField label="Fecha" required value={f.date} onChange={(v) => setF({ date: v })} />}
                <CategorySelect value={f.category} onChange={(v) => setF({ category: v })} categories={categories(p.kind === 'pago' ? 'payments' : 'expenses')} />
              </div>
              {p.kind === 'pago' && <TextField label="Proveedor" value={f.provider} onChange={(v) => setF({ provider: v })} />}
              <PersonSelect label="Responsable" value={f.responsibleId} onChange={(v) => setF({ responsibleId: v })} profiles={profiles} />
              {p.kind === 'pago' && <RecurrenceField value={f.recurrence} onChange={(v) => setF({ recurrence: v })} />}
            </>}
            {p.kind === 'documento' && <>
              <TextField label="Nombre" required value={f.name} onChange={(v) => setF({ name: v })} />
              <div className="form-row">
                <CategorySelect value={f.category} onChange={(v) => setF({ category: v })} categories={categories('documents')} required />
                <DateField label="Fecha" value={f.date} onChange={(v) => setF({ date: v })} />
              </div>
              <div className="form-row">
                <PersonSelect label="Persona" value={f.personId} onChange={(v) => setF({ personId: v })} profiles={profiles} />
                <SelectField label="Visibilidad" value={f.visibility} onChange={(v) => setF({ visibility: v })} options={Object.entries(VISIBILITY_LABEL).map(([value, label]) => ({ value, label }))} />
              </div>
            </>}
            {p.kind === 'reparacion' && <>
              <TextField label="¿Qué hay que reparar?" required value={f.title} onChange={(v) => setF({ title: v })} />
              <SelectField label="Elemento de la casa" value={f.assetId ?? ''} onChange={(v) => setF({ assetId: v || undefined })} options={[{ value: '', label: '—' }, ...assets.map((a) => ({ value: a.id, label: a.name }))]} />
              <Checkbox label="Crear tarea para gestionarla" checked={f.createTask !== false} onChange={(v) => setF({ createTask: v })} />
              {f.createTask !== false && <PersonSelect label="Responsable de la tarea" value={f.taskAssigneeId} onChange={(v) => setF({ taskAssigneeId: v })} profiles={profiles} />}
            </>}
            {p.kind === 'mantenimiento' && <>
              <TextField label="Mantenimiento" required value={f.title} onChange={(v) => setF({ title: v })} />
              <RecurrenceField label="Frecuencia (obligatoria)" value={f.recurrence} onChange={(v) => setF({ recurrence: v })} hint="Definila vos: la app no impone frecuencias técnicas." />
              <PersonSelect label="Responsable" value={f.assigneeId} onChange={(v) => setF({ assigneeId: v })} profiles={profiles} />
            </>}
            {(p.kind === 'nota' || p.kind === 'consulta' || p.kind === 'otro') && <>
              <TextField label="Título" value={f.title} onChange={(v) => setF({ title: v })} />
              <TextArea label="Contenido" value={f.body} onChange={(v) => setF({ body: v })} rows={2} />
            </>}
          </div>
        )}
        {p.include && issues.length > 0 && <p className="tiny" style={{ color: 'var(--warn-fg)' }}>Antes de confirmar: {issues.join(' ')}</p>}
      </div>
    </article>
  );
}
