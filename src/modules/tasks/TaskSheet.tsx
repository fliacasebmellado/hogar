import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import type { Task } from '../../domain/types';
import { Sheet, ConfirmSheet } from '../../ui/Sheet';
import { CategorySelect, Checkbox, DateField, PeoplePicker, PersonSelect, RecurrenceField, SelectField, TextArea, TextField, TimeField } from '../../ui/fields';
import { AttachmentList, HistoryList } from '../../ui/records';
import { createTask, completeTask, deleteSeries, editOccurrence, editSeries, reopenTask } from '../../services/tasks';
import { describeRecurrence } from '../../domain/recurrence';
import { PRIORITY_LABEL, TASK_STATUS_LABEL } from '../../domain/catalog';
import { formatDateTimeHuman, today } from '../../domain/dates';
import { validateRecord } from '../../domain/validation';

export function TaskSheet({ open, onClose, task, defaults }: { open: boolean; onClose: () => void; task?: Task | null; defaults?: Partial<Task> }) {
  const { repo, profile, profiles, categories, run, can } = useApp();
  const isNew = !task;
  const [d, setD] = useState<Partial<Task>>({});
  const [scope, setScope] = useState<'one' | 'series'>('one');
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDel, setConfirmDel] = useState(false);
  const [series, setSeries] = useState<Task | undefined>();
  useEffect(() => {
    if (!open) return;
    setErrors([]); setScope('one');
    setD(task ? { ...task } : { title: '', category: 'otras', priority: 'media', status: 'pendiente', assigneeId: profile?.id, collaboratorIds: [], attachmentIds: [], dueDate: today(), ...defaults });
    if (task?.seriesId) repo.get('tasks', task.seriesId).then(setSeries); else setSeries(undefined);
  }, [open, task?.id]);
  const set = (p: Partial<Task>) => setD((x) => ({ ...x, ...p }));
  const cats = categories('tasks');
  const canAssign = can('tasks.assignOthers');

  const save = async () => {
    const errs = validateRecord('tasks', { id: 'x', ...d });
    setErrors(errs);
    if (errs.length) return;
    const ok = await run(async () => {
      if (isNew) return createTask(repo, { ...(d as Task), title: d.title!.trim() }, { by: profile?.id });
      if (task!.seriesId && scope === 'series') {
        const { recurrence, ...rest } = d;
        return editSeries(repo, task!.seriesId, { title: rest.title, description: rest.description, category: rest.category, assigneeId: rest.assigneeId, collaboratorIds: rest.collaboratorIds, priority: rest.priority, dueTime: rest.dueTime, notes: rest.notes, ...(series && recurrence !== undefined ? { recurrence: recurrence ?? series.recurrence } : {}) }, profile?.id);
      }
      if (task!.seriesId) return editOccurrence(repo, task!.id, strip(d), profile?.id);
      return repo.update('tasks', task!.id, strip(d), { by: profile?.id });
    }, isNew ? 'Tarea creada' : 'Cambios guardados');
    if (ok) onClose();
  };

  const toggle = async () => {
    if (!task) return;
    if (task.status === 'completada') await run(() => reopenTask(repo, task.id, profile?.id), 'Tarea reabierta');
    else {
      const r = await run(() => completeTask(repo, task.id, profile?.id), 'Tarea completada');
      if (r?.next) setTimeout(() => undefined, 0);
    }
    onClose();
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title={isNew ? 'Nueva tarea' : 'Tarea'}
        footer={<>
          {!isNew && <button className="btn btn-danger" onClick={() => setConfirmDel(true)}>Eliminar</button>}
          <span className="spacer" />
          {!isNew && <button className="btn" onClick={toggle}>{task!.status === 'completada' ? 'Reabrir' : 'Completar'}</button>}
          <button className="btn btn-primary" onClick={save}>{isNew ? 'Crear' : 'Guardar'}</button>
        </>}>
        <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
          {errors.length > 0 && <div className="banner banner-alert" role="alert">{errors.join(' ')}</div>}
          <TextField label="Título" required value={d.title} onChange={(v) => set({ title: v })} autoFocus={isNew} />
          <div className="form-row">
            <CategorySelect value={d.category} onChange={(v) => set({ category: v })} categories={cats} required />
            <SelectField label="Prioridad" value={d.priority} onChange={(v) => set({ priority: v as Task['priority'] })} options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value: value as any, label }))} />
          </div>
          <div className="form-row">
            <DateField label="Fecha límite" value={d.dueDate} onChange={(v) => set({ dueDate: v })} />
            <TimeField label="Hora" value={d.dueTime} onChange={(v) => set({ dueTime: v })} />
          </div>
          <PersonSelect label="Responsable" value={d.assigneeId} onChange={(v) => set({ assigneeId: v })} profiles={canAssign ? profiles : profiles.filter((p) => p.id === profile?.id)} />
          {!isNew && <SelectField label="Estado" value={d.status} onChange={(v) => set({ status: v as Task['status'] })} options={Object.entries(TASK_STATUS_LABEL).map(([value, label]) => ({ value: value as any, label }))} />}
          {isNew && <RecurrenceField value={d.recurrence} onChange={(v) => set({ recurrence: v })} hint="Las tareas recurrentes generan la siguiente ocurrencia al completar la actual." />}
          {task?.seriesId && (
            <div className="banner banner-info">
              <div>
                Tarea recurrente: {describeRecurrence(series?.recurrence)}.
                <div className="row" style={{ marginTop: 6 }}>
                  <Checkbox label="Aplicar cambios a toda la serie" checked={scope === 'series'} onChange={(v) => setScope(v ? 'series' : 'one')} />
                </div>
                {scope === 'series' && series && <RecurrenceField value={d.recurrence ?? series.recurrence} onChange={(v) => set({ recurrence: v })} label="Repetición de la serie" />}
              </div>
            </div>
          )}
          <details className="more">
            <summary>Más detalles</summary>
            <div className="form" style={{ marginTop: 8 }}>
              <TextArea label="Descripción" value={d.description} onChange={(v) => set({ description: v })} />
              <PeoplePicker label="Colaboradores" value={d.collaboratorIds ?? []} onChange={(v) => set({ collaboratorIds: v })} profiles={profiles} />
              <TextArea label="Notas" value={d.notes} onChange={(v) => set({ notes: v })} rows={2} />
              <div className="field"><span className="field-label">Archivos</span><AttachmentList ids={d.attachmentIds ?? []} onChange={(ids) => set({ attachmentIds: ids })} /></div>
            </div>
          </details>
          {!isNew && (
            <details className="more">
              <summary>Historial</summary>
              <dl className="kv small" style={{ margin: '8px 0' }}>
                <dt>Creada</dt><dd>{formatDateTimeHuman(task!.createdAt)} · {task!.origin === 'asistente' ? 'desde el asistente' : 'manual'}</dd>
                {task!.completedAt && <><dt>Completada</dt><dd>{formatDateTimeHuman(task!.completedAt)} por {profiles.find((p) => p.id === task!.completedBy)?.name ?? '—'}</dd></>}
              </dl>
              <HistoryList entity="tasks" recordId={task!.id} />
            </details>
          )}
        </form>
      </Sheet>
      <ConfirmSheet open={confirmDel} onClose={() => setConfirmDel(false)} title="Eliminar tarea" danger confirmLabel="Eliminar"
        message={task?.seriesId
          ? <><p>Es una tarea recurrente. Las ocurrencias ya completadas se conservan.</p><Checkbox label="Eliminar también las próximas (toda la serie)" checked={scope === 'series'} onChange={(v) => setScope(v ? 'series' : 'one')} /></>
          : <p>La tarea se marcará como eliminada. El registro se conserva como borrado para poder sincronizar la eliminación.</p>}
        onConfirm={() => {
          run(async () => {
            if (task?.seriesId && scope === 'series') await deleteSeries(repo, task.seriesId, profile?.id);
            else await repo.remove('tasks', task!.id, { by: profile?.id });
          }, 'Tarea eliminada').then(onClose);
        }} />
    </>
  );
}

function strip(d: Partial<Task>): Partial<Task> {
  const { id, version, createdAt, updatedAt, rev, _sync, ...rest } = d as any;
  return rest;
}
