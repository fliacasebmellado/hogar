// Datos de DEMOSTRACIÓN para probar la app. Todos llevan demo=true y el prefijo "[Demo]" y se eliminan con un botón.
// No representan información real de la familia.
import type { Repo } from '../db/repo';
import { addDays, today } from '../domain/dates';
import { createTask } from './tasks';
import { createPayment } from './money';
import { DEFAULT_LIST_ID } from './shopping';

export async function loadDemo(repo: Repo, by?: string): Promise<number> {
  const t0 = today();
  let n = 0;
  const demo = { demo: true } as any;
  // Se usan los perfiles reales de la familia (adultos e hijos/as en orden de creación), sin nombres fijos en el código.
  const people = (await repo.list('profiles')).filter((p) => p.active !== false).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const adults = people.filter((p) => p.role === 'adult').map((p) => p.id);
  const kids = people.filter((p) => p.role === 'child').map((p) => p.id);
  const A1 = adults[0] ?? people[0]?.id, A2 = adults[1] ?? A1, K1 = kids[0] ?? A1, K2 = kids[1] ?? K1;
  await repo.tx(async () => {
    await createTask(repo, { ...demo, title: '[Demo] Sacar la basura', category: 'limpieza', assigneeId: K1, dueDate: t0, recurrence: { freq: 'weekly', interval: 1 } }, { by }); n += 2;
    await createTask(repo, { ...demo, title: '[Demo] Ordenar el cuarto', category: 'orden', assigneeId: K2, dueDate: addDays(t0, 1) }, { by }); n++;
    await createTask(repo, { ...demo, title: '[Demo] Renovar seguro del auto', category: 'tramites', assigneeId: A1, dueDate: addDays(t0, -2), priority: 'alta' }, { by }); n++;
    await repo.create('events', { ...demo, title: '[Demo] Reunión de padres', start: `${addDays(t0, 1)}T18:00`, end: `${addDays(t0, 1)}T19:00`, allDay: false, category: 'colegio', participantIds: [A2], ownerId: A2, reminders: [60], rsvp: 'pendiente', syncCalendar: false, attachmentIds: [] }, { by }); n++;
    await repo.create('events', { ...demo, title: '[Demo] Natación', start: `${addDays(t0, 2)}T17:30`, allDay: false, category: 'actividades', participantIds: [K2], ownerId: A1, reminders: [], rsvp: 'confirmado', syncCalendar: false, attachmentIds: [], recurrence: { freq: 'weekly', interval: 1 } }, { by }); n++;
    await repo.create('events', { ...demo, title: '[Demo] Clase de inglés', start: `${t0}T18:00`, end: `${t0}T19:00`, allDay: false, category: 'actividades', participantIds: [K1], ownerId: A2, reminders: [], rsvp: 'confirmado', syncCalendar: false, attachmentIds: [] }, { by }); n++;
    await repo.create('events', { ...demo, title: '[Demo] Turno dentista', start: `${t0}T10:30`, end: `${t0}T11:00`, allDay: false, category: 'salud', location: 'Consultorio', participantIds: [A1], ownerId: A1, reminders: [60], rsvp: 'pendiente', syncCalendar: false, attachmentIds: [] }, { by }); n++;
    await repo.create('events', { ...demo, title: '[Demo] Cumple de la abuela', start: addDays(t0, 3), allDay: true, category: 'cumpleanos', participantIds: [A1, A2, K1, K2], ownerId: A2, reminders: [], rsvp: 'confirmado', syncCalendar: false, attachmentIds: [] }, { by }); n++;
    await createTask(repo, { ...demo, title: '[Demo] Comprar regalo para la abuela', category: 'familia', assigneeId: A2, dueDate: t0, priority: 'alta' }, { by }); n++;
    await repo.create('shoppingItems', { ...demo, listId: DEFAULT_LIST_ID, name: '[Demo] Cartulina verde', category: 'colegio', priority: 'alta', status: 'pendiente', requestedBy: K2, notes: 'Para: el jueves' }, { by }); n++;
    for (const name of ['[Demo] Leche', '[Demo] Pan', '[Demo] Detergente']) { await repo.create('shoppingItems', { ...demo, listId: DEFAULT_LIST_ID, name, category: name.includes('Detergente') ? 'limpieza' : 'supermercado', priority: 'media', status: 'pendiente' }, { by }); n++; }
    await createPayment(repo, { ...demo, concept: '[Demo] Internet', category: 'servicios', amount: 1, currency: 'ARS', dueDate: addDays(t0, 3) }, { by }); n++;
    await repo.create('repairs', { ...demo, title: '[Demo] Canilla del baño gotea', status: 'reportada', reportedAt: t0 }, { by }); n++;
    const inv = await repo.create('investments', { ...demo, name: '[Demo] Depto de ejemplo', kind: 'departamento', status: 'alquilada', address: 'Calle Falsa 123', currency: 'USD' }, { by }); n++;
    await repo.create('investmentContracts', { ...demo, investmentId: inv.id, kind: 'alquiler', counterpart: 'Inquilino de ejemplo', startDate: addDays(t0, -300), endDate: addDays(t0, 45), amount: 1, currency: 'ARS', frequency: 'mensual', adjustment: 'ICL anual', status: 'vigente' }, { by }); n++;
    await repo.create('investmentTaxes', { ...demo, investmentId: inv.id, tax: 'ABL', period: t0.slice(0, 7), dueDate: addDays(t0, 2), amount: 1, currency: 'ARS', status: 'pendiente' }, { by }); n++;
  });
  return n;
}

export async function countDemo(repo: Repo): Promise<number> {
  let n = 0;
  for (const e of ['tasks', 'events', 'shoppingItems', 'payments', 'repairs', 'investments', 'investmentContracts', 'investmentTaxes'] as const) n += (await repo.list(e)).filter((r: any) => r.demo).length;
  return n;
}
