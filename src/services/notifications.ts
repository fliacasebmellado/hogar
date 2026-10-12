// Centro de notificaciones. Los avisos se DERIVAN de los datos (no se duplican registros); solo se guarda
// localmente el estado leído/descartado por clave estable.
import type { CalendarEvent, DocumentRecord, Investment, InvestmentContract, InvestmentTax, Payment, Profile, Task } from '../domain/types';
import type { NotificationSettings } from './config';
import { addDays, diffDays, formatDate, parseISODate, today } from '../domain/dates';
import { expandEvents } from './events';
import { formatMoney } from '../domain/finance';

export type Severity = 'info' | 'warn' | 'alert';
export interface AppNotification {
  key: string; kind: 'evento' | 'pago' | 'tarea' | 'mantenimiento' | 'sincronizacion' | 'inversion' | 'documento'; title: string; detail: string;
  date: string; severity: Severity; link: string;
}

export interface NotificationInput {
  events: CalendarEvent[]; tasks: Task[]; payments: Payment[]; profile?: Profile; settings: NotificationSettings;
  sync: { pending: number; errors: number; conflicts: number; configured: boolean }; financeVisible: boolean; now?: Date;
  investments?: Investment[]; investmentTaxes?: InvestmentTax[]; investmentContracts?: InvestmentContract[]; documents?: DocumentRecord[];
}

export function buildNotifications(i: NotificationInput): AppNotification[] {
  const now = i.now ?? new Date();
  const ref = today(now);
  const s = i.settings;
  const out: AppNotification[] = [];
  if (!s.enabled) return out;
  const mine = (ids: (string | undefined)[]) => !i.profile || i.profile.role !== 'child' || ids.includes(i.profile.id);

  if (s.categories.eventos) {
    for (const inst of expandEvents(i.events, ref, addDays(ref, 2))) {
      const e = inst.event;
      if (!mine([e.ownerId, ...(e.participantIds ?? [])])) continue;
      const start = parseISODate(inst.start.length > 10 ? inst.start : inst.start + 'T00:00');
      const minutes = (start.getTime() - now.getTime()) / 60000;
      const lead = Math.max(s.eventLeadMinutes, ...(e.reminders ?? []));
      if (e.allDay ? inst.date === ref : minutes >= -30 && minutes <= lead) {
        out.push({
          key: `evento:${e.id}:${inst.date}`, kind: 'evento', title: e.title,
          detail: e.allDay ? 'Hoy (todo el día)' : minutes < 0 ? `Empezó a las ${inst.start.slice(11, 16)}` : `Hoy a las ${inst.start.slice(11, 16)}${e.location ? ' · ' + e.location : ''}`,
          date: inst.start, severity: minutes <= 15 ? 'warn' : 'info', link: `/agenda?id=${e.id}`,
        });
      }
    }
  }
  if (s.categories.pagos && i.financeVisible) {
    for (const p of i.payments) {
      if (p.deleted || p.isSeries || p.status === 'pagado' || !p.dueDate) continue;
      const d = diffDays(p.dueDate, ref);
      if (d > s.paymentLeadDays) continue;
      out.push({
        key: `pago:${p.id}:${p.dueDate}`, kind: 'pago', title: p.concept,
        detail: `${d < 0 ? `Venció hace ${-d} día${d === -1 ? '' : 's'}` : d === 0 ? 'Vence hoy' : `Vence el ${formatDate(p.dueDate)}`} · ${formatMoney(p.amount, p.currency)}`,
        date: p.dueDate, severity: d < 0 ? 'alert' : 'warn', link: `/economia?pago=${p.id}`,
      });
    }
  }
  for (const t of i.tasks) {
    if (t.deleted || t.isSeries || t.status === 'completada' || !t.dueDate) continue;
    const isMaint = !!t.maintenanceId;
    if (isMaint ? !s.categories.mantenimiento : !s.categories.tareas) continue;
    if (!mine([t.assigneeId, ...(t.collaboratorIds ?? [])])) continue;
    const d = diffDays(t.dueDate, ref);
    if (d > (isMaint ? s.maintenanceLeadDays : s.taskLeadDays)) continue;
    out.push({
      key: `tarea:${t.id}:${t.dueDate}`, kind: isMaint ? 'mantenimiento' : 'tarea', title: t.title,
      detail: d < 0 ? `Atrasada (${formatDate(t.dueDate)})` : d === 0 ? 'Para hoy' : `Para el ${formatDate(t.dueDate)}`,
      date: t.dueDate, severity: d < 0 ? 'alert' : t.priority === 'alta' ? 'warn' : 'info', link: `/tareas?id=${t.id}`,
    });
  }
  if (s.categories.pagos && i.financeVisible) {
    const invName = (id: string) => i.investments?.find((x) => x.id === id)?.name ?? 'Inversión';
    for (const t of i.investmentTaxes ?? []) {
      if (t.deleted || t.status === 'pagado' || !t.dueDate) continue;
      const d = diffDays(t.dueDate, ref);
      if (d > s.paymentLeadDays) continue;
      out.push({ key: `imp:${t.id}:${t.dueDate}`, kind: 'inversion', title: `${t.tax} · ${invName(t.investmentId)}`, detail: `${d < 0 ? `Venció hace ${-d} día(s)` : d === 0 ? 'Vence hoy' : `Vence el ${formatDate(t.dueDate)}`} · ${formatMoney(t.amount, t.currency)}`, date: t.dueDate, severity: d < 0 ? 'alert' : 'warn', link: `/inversiones?id=${t.investmentId}` });
    }
    for (const c of i.investmentContracts ?? []) {
      if (c.deleted || c.status === 'rescindido' || !c.endDate) continue;
      const d = diffDays(c.endDate, ref);
      if (d < -30 || d > 60) continue;
      out.push({ key: `contrato:${c.id}:${c.endDate}`, kind: 'inversion', title: `Contrato de ${c.kind} · ${invName(c.investmentId)}`, detail: d < 0 ? `Venció el ${formatDate(c.endDate)}` : `Vence el ${formatDate(c.endDate)} (en ${d} días)`, date: c.endDate, severity: d < 15 ? 'alert' : 'warn', link: `/inversiones?id=${c.investmentId}` });
    }
  }
  for (const doc of i.documents ?? []) {
    if (doc.deleted || !doc.expiresAt) continue;
    if (i.profile?.role === 'child' && doc.visibility !== 'familia' && doc.personId !== i.profile.id) continue;
    const d = diffDays(doc.expiresAt, ref);
    if (d > 60 || d < -60) continue;
    out.push({ key: `doc:${doc.id}:${doc.expiresAt}`, kind: 'documento', title: `${doc.name} vence`, detail: d < 0 ? `Venció el ${formatDate(doc.expiresAt)}` : `El ${formatDate(doc.expiresAt)} (en ${d} días): conviene renovarlo`, date: doc.expiresAt, severity: d < 15 ? 'alert' : 'warn', link: `/documentos?id=${doc.id}` });
  }
  if (s.categories.sincronizacion && i.sync.configured) {
    if (i.sync.conflicts > 0) out.push({ key: `sync:conflictos:${i.sync.conflicts}`, kind: 'sincronizacion', title: 'Conflictos de sincronización', detail: `${i.sync.conflicts} registro(s) cambiaron en otro dispositivo. Revisalos.`, date: ref, severity: 'alert', link: '/ajustes/sincronizacion' });
    if (i.sync.errors > 0) out.push({ key: `sync:errores:${i.sync.errors}`, kind: 'sincronizacion', title: 'Errores de sincronización', detail: `${i.sync.errors} operación(es) no llegaron a Google. Podés reintentar.`, date: ref, severity: 'warn', link: '/ajustes/sincronizacion' });
  }
  const order = { alert: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity] || (a.date < b.date ? -1 : 1));
}

export function inQuietHours(s: NotificationSettings, now = new Date()): boolean {
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return s.quietFrom > s.quietTo ? hm >= s.quietFrom || hm < s.quietTo : hm >= s.quietFrom && hm < s.quietTo;
}
