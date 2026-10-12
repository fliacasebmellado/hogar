// Tareas puntuales y recurrentes.
// Modelo de series: una tarea "maestra" (isSeries=true, oculta en listas) guarda la regla; cada ocurrencia es una
// tarea normal con seriesId y occurrenceDate. El id de la ocurrencia es determinista (serie__fecha), por lo que dos
// dispositivos que generan la misma ocurrencia producen el mismo registro y no se duplican.
// Política: cada serie mantiene UNA ocurrencia abierta; al completarla se genera la siguiente.
import type { Repo, WriteOpts } from '../db/repo';
import type { ID, ISODate, Task } from '../domain/types';
import { occurrenceId, uuid } from '../domain/ids';
import { nextOccurrence } from '../domain/recurrence';
import { addDays, nowISO, today } from '../domain/dates';

const SERIES_FIELDS: (keyof Task)[] = ['title', 'description', 'category', 'assigneeId', 'collaboratorIds', 'priority', 'dueTime', 'notes', 'assetId', 'roomId', 'maintenanceId', 'relatedType', 'relatedId'];

export type TaskInput = Partial<Task> & { title: string };

function defaults(data: TaskInput): Partial<Task> {
  return {
    category: 'otras', collaboratorIds: [], priority: 'media', status: 'pendiente', attachmentIds: [], ...data,
  };
}

export async function createTask(repo: Repo, data: TaskInput, opts: WriteOpts = {}): Promise<Task> {
  const base = defaults(data);
  if (!base.recurrence) return repo.create('tasks', { ...base, recurrence: null }, opts);
  const start = base.dueDate ?? today();
  return repo.tx(async () => {
    const seriesId = base.id ?? uuid();
    await repo.create('tasks', { ...base, id: seriesId, isSeries: true, dueDate: start, nextRun: start, status: 'pendiente' }, opts);
    return createOccurrence(repo, (await repo.get('tasks', seriesId))!, start, opts);
  });
}

async function createOccurrence(repo: Repo, series: Task, date: ISODate, opts: WriteOpts): Promise<Task> {
  const id = occurrenceId(series.id, date);
  const existing = await repo.get('tasks', id);
  if (existing) return existing; // idempotente
  const occ: Partial<Task> = {
    id, seriesId: series.id, occurrenceDate: date, dueDate: date, recurrence: null, isSeries: false, status: 'pendiente',
    attachmentIds: [], collaboratorIds: [],
  };
  for (const f of SERIES_FIELDS) (occ as any)[f] = (series as any)[f];
  if (series.demo) occ.demo = true;
  const created = await repo.create('tasks', occ, { ...opts, origin: series.origin === 'asistente' ? 'asistente' : opts.origin });
  await repo.update('tasks', series.id, { nextRun: date }, { ...opts, skipHistory: true });
  return created;
}

/** Garantiza que cada serie activa tenga su ocurrencia abierta. Idempotente; seguro de ejecutar en cada inicio. */
export async function ensureTaskOccurrences(repo: Repo, opts: WriteOpts = {}): Promise<number> {
  const all = await repo.list('tasks');
  const series = all.filter((t) => t.isSeries && t.recurrence);
  let created = 0;
  for (const s of series) {
    const occs = all.filter((t) => t.seriesId === s.id);
    if (occs.some((o) => o.status !== 'completada')) continue;
    const last = occs.map((o) => o.occurrenceDate!).sort().pop();
    const next = last ? nextOccurrence(s.recurrence!, s.dueDate!, last) : s.dueDate!;
    if (!next) continue;
    if (!occs.find((o) => o.occurrenceDate === next)) {
      const deletedOcc = await repo.get('tasks', occurrenceId(s.id, next));
      if (deletedOcc) continue; // fue eliminada a propósito: no recrear
      await createOccurrence(repo, s, next, opts);
      created++;
    }
  }
  return created;
}

export async function completeTask(repo: Repo, id: ID, by?: ID): Promise<{ task: Task; next?: Task }> {
  return repo.tx(async () => {
    const task = await repo.update('tasks', id, { status: 'completada', completedAt: nowISO(), completedBy: by }, { by, historyAction: 'completar' });
    let next: Task | undefined;
    if (task.seriesId) {
      const series = await repo.get('tasks', task.seriesId);
      if (series && !series.deleted && series.recurrence) {
        const n = nextOccurrence(series.recurrence, series.dueDate!, task.occurrenceDate ?? task.dueDate ?? today());
        if (n) next = await createOccurrence(repo, series, n, { by });
      }
    }
    return { task, next };
  });
}

export async function reopenTask(repo: Repo, id: ID, by?: ID) {
  return repo.update('tasks', id, { status: 'pendiente', completedAt: undefined, completedBy: undefined }, { by });
}

/** Edita solo esta ocurrencia: queda "desacoplada" y los cambios de la serie no la pisan. */
export async function editOccurrence(repo: Repo, id: ID, patch: Partial<Task>, by?: ID) {
  return repo.update('tasks', id, { ...patch, detached: true }, { by });
}

/** Edita la serie completa: actualiza la maestra y las ocurrencias abiertas no desacopladas. */
export async function editSeries(repo: Repo, seriesId: ID, patch: Partial<Task>, by?: ID) {
  return repo.tx(async () => {
    const series = await repo.get('tasks', seriesId);
    if (!series) throw new Error('Serie inexistente');
    const rulePatch = patch.recurrence !== undefined && JSON.stringify(patch.recurrence) !== JSON.stringify(series.recurrence);
    const startChanged = patch.dueDate && patch.dueDate !== series.dueDate;
    await repo.update('tasks', seriesId, patch, { by });
    const occs = (await repo.list('tasks')).filter((t) => t.seriesId === seriesId && t.status !== 'completada' && !t.detached);
    if (rulePatch || startChanged) {
      for (const o of occs) await repo.remove('tasks', o.id, { by });
      const s2 = (await repo.get('tasks', seriesId))!;
      const from = s2.dueDate! > today() ? s2.dueDate! : today();
      const first = s2.dueDate! >= from ? s2.dueDate! : nextOccurrence(s2.recurrence!, s2.dueDate!, addDays(from, -1));
      if (first) {
        const existing = await repo.get('tasks', occurrenceId(seriesId, first));
        if (existing?.deleted) await repo.update('tasks', existing.id, { deleted: false, status: 'pendiente', ...pick(s2) }, { by });
        else if (!existing) await createOccurrence(repo, s2, first, { by });
      }
    } else {
      const fieldPatch: Partial<Task> = {};
      for (const f of SERIES_FIELDS) if (f in patch) (fieldPatch as any)[f] = (patch as any)[f];
      for (const o of occs) await repo.update('tasks', o.id, fieldPatch, { by });
    }
    return repo.get('tasks', seriesId);
  });
}

function pick(s: Task) { const o: any = {}; for (const f of SERIES_FIELDS) o[f] = (s as any)[f]; return o; }

export async function deleteSeries(repo: Repo, seriesId: ID, by?: ID) {
  return repo.tx(async () => {
    const occs = (await repo.list('tasks')).filter((t) => t.seriesId === seriesId && t.status !== 'completada');
    for (const o of occs) await repo.remove('tasks', o.id, { by });
    await repo.remove('tasks', seriesId, { by });
  });
}

// ---- Consultas ----
export interface TaskFilter { assigneeId?: string; category?: string; status?: string; priority?: string; from?: ISODate; to?: ISODate; text?: string; overdue?: boolean }

export function filterTasks(tasks: Task[], f: TaskFilter, ref: ISODate = today()): Task[] {
  const q = f.text ? norm(f.text) : '';
  return tasks
    .filter((t) => !t.deleted && !t.isSeries)
    .filter((t) => !f.assigneeId || t.assigneeId === f.assigneeId || t.collaboratorIds?.includes(f.assigneeId))
    .filter((t) => !f.category || t.category === f.category)
    .filter((t) => !f.status || (f.status === 'abiertas' ? t.status !== 'completada' : t.status === f.status))
    .filter((t) => !f.priority || t.priority === f.priority)
    .filter((t) => !f.from || (t.dueDate && t.dueDate >= f.from))
    .filter((t) => !f.to || (t.dueDate && t.dueDate <= f.to))
    .filter((t) => !f.overdue || (t.status !== 'completada' && !!t.dueDate && t.dueDate < ref))
    .filter((t) => !q || norm(`${t.title} ${t.description ?? ''} ${t.notes ?? ''}`).includes(q))
    .sort(taskSort);
}

const PRIO = { alta: 0, media: 1, baja: 2 } as const;
export function taskSort(a: Task, b: Task) {
  const ca = a.status === 'completada' ? 1 : 0, cb = b.status === 'completada' ? 1 : 0;
  if (ca !== cb) return ca - cb;
  const da = a.dueDate ?? '9999', dbb = b.dueDate ?? '9999';
  if (da !== dbb) return da < dbb ? -1 : 1;
  return PRIO[a.priority] - PRIO[b.priority];
}

export function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
