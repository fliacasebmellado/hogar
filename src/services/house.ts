// Casa y mantenimiento: reparaciones (con tarea y factura vinculadas) y planes de mantenimiento (series de tareas).
import type { Repo } from '../db/repo';
import type { Expense, ID, ISODate, Maintenance, Repair } from '../domain/types';
import { today } from '../domain/dates';
import { createTask, deleteSeries, editSeries } from './tasks';
import { createExpense } from './money';

export interface RepairInput extends Partial<Repair> { title: string; createTask?: boolean; taskAssigneeId?: ID; taskDueDate?: ISODate }

/** Crea una reparación y, opcionalmente, la tarea que la gestiona (ambas vinculadas entre sí y al ambiente). */
export async function createRepair(repo: Repo, input: RepairInput, by?: ID): Promise<{ repair: Repair; taskId?: ID }> {
  const { createTask: withTask, taskAssigneeId, taskDueDate, ...data } = input;
  return repo.tx(async () => {
    let repair = await repo.create('repairs', { status: 'reportada', reportedAt: today(), ...data }, { by });
    let taskId: ID | undefined;
    if (withTask) {
      const t = await createTask(repo, {
        title: `Reparar: ${repair.title}`, category: 'mantenimiento', assigneeId: taskAssigneeId, dueDate: taskDueDate,
        relatedType: 'repairs', relatedId: repair.id, assetId: repair.assetId, roomId: repair.roomId, description: repair.description,
      }, { by });
      taskId = t.id;
      repair = await repo.update('repairs', repair.id, { taskId }, { by, skipHistory: true });
    }
    return { repair, taskId };
  });
}

/**
 * Vincula la factura de una reparación. El documento de la factura se referencia desde el gasto (receiptDocId)
 * y desde la reparación (invoiceDocId). Si la reparación ya tenía gasto, se actualiza: nunca se crea un segundo gasto.
 */
export async function linkRepairInvoice(repo: Repo, repairId: ID, input: { amount: number; date?: ISODate; docId?: ID; by?: ID; category?: string }):
  Promise<{ repair: Repair; expense: Expense }> {
  return repo.tx(async () => {
    const r = await repo.get('repairs', repairId);
    if (!r) throw new Error('Reparación inexistente');
    const data = {
      amount: input.amount, date: input.date ?? today(), concept: `Reparación: ${r.title}`, category: input.category ?? 'mantenimiento',
      repairId, assetId: r.assetId, receiptDocId: input.docId ?? r.invoiceDocId,
    };
    let expense = r.expenseId ? await repo.get('expenses', r.expenseId) : (await repo.list('expenses')).find((e) => e.repairId === repairId);
    expense = expense ? await repo.update('expenses', expense.id, { ...data, deleted: false }, { by: input.by }) : await createExpense(repo, data, { by: input.by });
    if (input.docId && (await repo.get('documents', input.docId))) {
      await repo.update('documents', input.docId, { relatedType: 'repairs', relatedId: repairId }, { by: input.by, skipHistory: true });
    }
    const repair = await repo.update('repairs', repairId, { cost: input.amount, expenseId: expense.id, invoiceDocId: input.docId ?? r.invoiceDocId }, { by: input.by });
    return { repair, expense };
  });
}

/** Plan de mantenimiento: genera una serie de tareas con la frecuencia que defina la familia (no se imponen frecuencias técnicas). */
export async function createMaintenance(repo: Repo, data: Partial<Maintenance> & { title: string; recurrence: Maintenance['recurrence']; startDate?: ISODate }, by?: ID): Promise<Maintenance> {
  const { startDate, ...m } = data;
  return repo.tx(async () => {
    const plan = await repo.create('maintenance', { category: 'preventivo', active: true, ...m }, { by });
    const occ = await createTask(repo, {
      title: plan.title, category: plan.category === 'pileta' ? 'pileta' : plan.category === 'limpieza' ? 'limpieza' : 'mantenimiento',
      assigneeId: plan.assigneeId, recurrence: plan.recurrence, dueDate: startDate ?? today(), assetId: plan.assetId, roomId: plan.roomId,
      maintenanceId: plan.id, relatedType: 'maintenance', relatedId: plan.id, notes: plan.notes,
    }, { by });
    return repo.update('maintenance', plan.id, { taskSeriesId: occ.seriesId }, { by, skipHistory: true });
  });
}

export async function updateMaintenance(repo: Repo, id: ID, patch: Partial<Maintenance>, by?: ID) {
  return repo.tx(async () => {
    const plan = await repo.update('maintenance', id, patch, { by });
    if (plan.taskSeriesId) {
      if (plan.active === false) await deleteSeries(repo, plan.taskSeriesId, by);
      else await editSeries(repo, plan.taskSeriesId, { title: plan.title, assigneeId: plan.assigneeId, recurrence: plan.recurrence, notes: plan.notes }, by);
    }
    return plan;
  });
}

export function warrantyStatus(until?: ISODate, ref: ISODate = today()): 'vigente' | 'por_vencer' | 'vencida' | null {
  if (!until) return null;
  if (until < ref) return 'vencida';
  const d = new Date(until).getTime() - new Date(ref).getTime();
  return d < 60 * 86400000 ? 'por_vencer' : 'vigente';
}
