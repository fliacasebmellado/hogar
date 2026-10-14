// @vitest-environment node
// Pruebas funcionales de los módulos sobre la base local real (IndexedDB simulada). Sin datos reales de la familia.
import { describe, it, expect, beforeEach } from 'vitest';
import { Repo } from '../src/db/repo';
import { ensureSeed } from '../src/services/seed';
import { completeTask, createTask, editOccurrence, editSeries, ensureTaskOccurrences, filterTasks, reopenTask } from '../src/services/tasks';
import { expandEvents, filterEvents } from '../src/services/events';
import { addItem, markPurchased, mergeItems, DEFAULT_LIST_ID, applyTemplate, saveAsTemplate } from '../src/services/shopping';
import { confirmPayment, createExpense, createPayment, ensurePaymentOccurrences, undoPayment } from '../src/services/money';
import { addDocument, searchDocuments } from '../src/services/documents';
import { createMaintenance, createRepair, linkRepairInvoice } from '../src/services/house';
import { exportAll, restoreBackup, validateBackup, saveLocalBackup } from '../src/services/backup';
import { globalSearch } from '../src/services/search';
import { buildNotifications } from '../src/services/notifications';
import { DEFAULT_NOTIFICATION_SETTINGS, setConfig, permissionsFrom } from '../src/services/config';
import { can, canOpenModule, hashPin } from '../src/domain/permissions';
import { monthSummary } from '../src/domain/finance';
import { addDays, today } from '../src/domain/dates';
import { uuid } from '../src/domain/ids';
import { ValidationError } from '../src/domain/validation';
import { loadDemo } from '../src/services/demo';

let repo: Repo;
beforeEach(async () => {
  repo = await Repo.open('f-' + uuid());
  await ensureSeed(repo);
});
const MAMA = 'profile-mama', HIJO = 'profile-hijo', PAPA = 'profile-papa';

describe('Tareas', () => {
  it('crea, edita y completa una tarea con historial y autor de finalización', async () => {
    const t = await createTask(repo, { title: 'Doblar la ropa', category: 'ropa', assigneeId: HIJO }, { by: MAMA });
    expect(t.status).toBe('pendiente');
    await repo.update('tasks', t.id, { priority: 'alta', title: 'Doblar y guardar la ropa' }, { by: MAMA });
    const { task } = await completeTask(repo, t.id, HIJO);
    expect(task.status).toBe('completada');
    expect(task.completedBy).toBe(HIJO);
    expect(task.completedAt).toBeTruthy();
    const hist = await repo.db.entity('history').where('recordId').equals(t.id).toArray();
    expect(hist.map((h) => h.action).sort()).toEqual(['completar', 'crear', 'editar']);
    expect(hist.find((h) => h.action === 'editar')!.changes!.title).toEqual(['Doblar la ropa', 'Doblar y guardar la ropa']);
    await reopenTask(repo, t.id, MAMA);
    expect((await repo.get('tasks', t.id))!.status).toBe('pendiente');
  });

  it('rechaza datos inválidos sin guardar nada', async () => {
    const before = await repo.db.outbox.count();
    await expect(createTask(repo, { title: '  ', category: 'otras' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createTask(repo, { title: 'x', category: 'otras', dueDate: '2026-02-31' })).rejects.toThrow('fecha');
    expect(await repo.db.outbox.count()).toBe(before);
  });

  it('tarea recurrente: genera la siguiente ocurrencia, edita una o toda la serie', async () => {
    const first = await createTask(repo, { title: 'Sacar la basura', category: 'limpieza', assigneeId: HIJO, dueDate: '2026-10-12', recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 4] } });
    expect(first.seriesId).toBeTruthy();
    expect(first.occurrenceDate).toBe('2026-10-12');
    const { next } = await completeTask(repo, first.id, HIJO);
    expect(next!.dueDate).toBe('2026-10-15'); // jueves
    expect(await ensureTaskOccurrences(repo)).toBe(0); // idempotente: ya hay una abierta
    const visible = filterTasks(await repo.list('tasks'), {});
    expect(visible.some((t) => t.isSeries)).toBe(false); // la maestra no se muestra
    await editOccurrence(repo, next!.id, { assigneeId: PAPA });
    expect((await repo.get('tasks', next!.id))!.detached).toBe(true);
    await editSeries(repo, first.seriesId!, { title: 'Sacar la basura y reciclables' });
    expect((await repo.get('tasks', next!.id))!.title).toBe('Sacar la basura'); // desacoplada: no se pisa
    expect((await repo.get('tasks', first.seriesId!))!.title).toBe('Sacar la basura y reciclables');
    expect((await repo.get('tasks', first.id))!.status).toBe('completada'); // historial intacto
  });

  it('filtra por integrante, categoría, prioridad, estado y fechas', async () => {
    await createTask(repo, { title: 'A', category: 'cocina', assigneeId: HIJO, priority: 'alta', dueDate: '2026-10-10' });
    await createTask(repo, { title: 'B', category: 'patio', assigneeId: PAPA, dueDate: '2026-10-20' });
    const c = await createTask(repo, { title: 'C', category: 'cocina', assigneeId: PAPA, collaboratorIds: [HIJO] });
    await completeTask(repo, c.id, PAPA);
    const all = await repo.list('tasks');
    expect(filterTasks(all, { assigneeId: HIJO }).map((t) => t.title).sort()).toEqual(['A', 'C']);
    expect(filterTasks(all, { category: 'cocina', status: 'abiertas' }).map((t) => t.title)).toEqual(['A']);
    expect(filterTasks(all, { priority: 'alta' }).map((t) => t.title)).toEqual(['A']);
    expect(filterTasks(all, { from: '2026-10-15', to: '2026-10-31' }).map((t) => t.title)).toEqual(['B']);
    expect(filterTasks(all, { overdue: true }, '2026-10-11').map((t) => t.title)).toEqual(['A']);
    expect(filterTasks(all, { text: 'b' }).map((t) => t.title)).toEqual(['B']);
  });
});

describe('Agenda', () => {
  it('crea y modifica un evento, expande repeticiones y filtra por integrante', async () => {
    const e = await repo.create('events', { title: 'Natación', start: '2026-10-13T17:30', end: '2026-10-13T18:30', allDay: false, category: 'actividades', participantIds: ['profile-hija'], reminders: [30], rsvp: 'pendiente', syncCalendar: false, attachmentIds: [], recurrence: { freq: 'weekly', interval: 1 } });
    await repo.update('events', e.id, { location: 'Club', rsvp: 'confirmado' });
    const got = await repo.get('events', e.id);
    expect(got!.location).toBe('Club');
    const inst = expandEvents([got!], '2026-10-01', '2026-10-31');
    expect(inst.map((i) => i.date)).toEqual(['2026-10-13', '2026-10-20', '2026-10-27']);
    expect(inst[1].end).toBe('2026-10-20T18:30');
    expect(filterEvents([got!], { personId: 'profile-hija' })).toHaveLength(1);
    expect(filterEvents([got!], { personId: HIJO })).toHaveLength(0);
    await expect(repo.update('events', e.id, { end: '2026-10-13T10:00' })).rejects.toThrow('anterior');
  });
});

describe('Compras', () => {
  it('registra una compra, detecta duplicados y fusiona sin perder información', async () => {
    const a = await addItem(repo, { listId: DEFAULT_LIST_ID, name: 'Leche', quantity: 2, unit: 'l', notes: 'descremada' });
    const dup = await addItem(repo, { listId: DEFAULT_LIST_ID, name: 'leches' });
    expect(dup.duplicate?.id).toBe(a.item!.id);
    const b = await addItem(repo, { listId: DEFAULT_LIST_ID, name: 'LECHE', quantity: 1, unit: 'l', notes: 'para el café' }, { allowDuplicate: true });
    const merged = await mergeItems(repo, a.item!.id, [b.item!.id]);
    expect(merged.quantity).toBe(3);
    expect(merged.notes).toContain('descremada');
    expect(merged.notes).toContain('para el café');
    const old = await repo.get('shoppingItems', b.item!.id);
    expect(old!.mergedInto).toBe(a.item!.id); // se conserva como fusionado (borrado lógico)
  });

  it('marcar comprado no crea gasto sin importe; con importe crea uno solo y vinculado', async () => {
    const i1 = (await addItem(repo, { listId: DEFAULT_LIST_ID, name: 'Pan' })).item!;
    const i2 = (await addItem(repo, { listId: DEFAULT_LIST_ID, name: 'Yerba' })).item!;
    const r1 = await markPurchased(repo, [i1.id]);
    expect(r1.expense).toBeUndefined();
    expect(await repo.list('expenses')).toHaveLength(0);
    const r2 = await markPurchased(repo, [i2.id], { amount: 5200 });
    expect(r2.expense!.shoppingItemIds).toEqual([i2.id]);
    expect((await repo.get('shoppingItems', i2.id))!.expenseId).toBe(r2.expense!.id);
    expect(await repo.list('expenses')).toHaveLength(1);
  });

  it('listas habituales: reutiliza productos sin duplicar', async () => {
    await addItem(repo, { listId: DEFAULT_LIST_ID, name: 'Detergente' });
    const tpl = await saveAsTemplate(repo, DEFAULT_LIST_ID, 'Limpieza mensual');
    const list2 = await repo.create('shoppingLists', { name: 'Súper', isTemplate: false, archived: false });
    expect(await applyTemplate(repo, tpl.id, list2.id)).toEqual({ added: 1, skipped: 0 });
    expect(await applyTemplate(repo, tpl.id, list2.id)).toEqual({ added: 0, skipped: 1 });
  });
});

describe('Economía', () => {
  it('registra un gasto', async () => {
    const e = await createExpense(repo, { concept: 'Farmacia', amount: 8300.5, date: '2026-10-09', category: 'salud' });
    expect(e.currency).toBe('ARS');
    await expect(createExpense(repo, { concept: 'x', amount: -1, date: '2026-10-09' })).rejects.toThrow('positivo');
  });

  it('crea y confirma un pago: un solo gasto vinculado, sin duplicar al reintentar', async () => {
    const p = await createPayment(repo, { concept: 'Luz', category: 'servicios', amount: 45000, dueDate: '2026-10-20' });
    expect(p.status).toBe('pendiente');
    await expect(createPayment(repo, { concept: 'x', status: 'pagado', dueDate: '2026-10-01' })).rejects.toThrow();
    await expect(confirmPayment(repo, p.id, { paidDate: '2026-10-18', amount: 0 })).rejects.toThrow('importe');
    const r = await confirmPayment(repo, p.id, { paidDate: '2026-10-18', amount: 45300 });
    expect(r.payment.status).toBe('pagado');
    expect(r.expense.paymentId).toBe(p.id);
    const again = await confirmPayment(repo, p.id, { paidDate: '2026-10-18', amount: 45300 });
    expect(again.expense.id).toBe(r.expense.id);
    expect(await repo.list('expenses')).toHaveLength(1);
    // el resumen suma gastos, no pagos: no hay doble conteo
    const s = monthSummary(await repo.list('expenses'), await repo.list('payments'), '2026-10');
    expect(s.total.ARS).toBe(45300);
    expect(s.pendingObligations.ARS ?? 0).toBe(0);
    await undoPayment(repo, p.id);
    expect((await repo.get('payments', p.id))!.status).toBe('pendiente');
    expect(await repo.list('expenses')).toHaveLength(0);
  });

  it('pagos recurrentes: obligaciones futuras separadas de las pagadas, sin duplicar', async () => {
    const t0 = today();
    const first = await createPayment(repo, { concept: 'Cuota colegio', category: 'colegio', amount: 90000, dueDate: t0, recurrence: { freq: 'monthly', interval: 1 } });
    const occs = (await repo.list('payments')).filter((p) => !p.isSeries);
    expect(occs.length).toBeGreaterThanOrEqual(2); // hoy y el mes siguiente (horizonte 45 días)
    expect(occs.every((p) => p.status === 'pendiente')).toBe(true);
    expect(await ensurePaymentOccurrences(repo)).toBe(0);
    await confirmPayment(repo, first.id, { paidDate: t0, amount: 90000 });
    expect((await repo.list('payments')).filter((p) => p.status === 'pagado')).toHaveLength(1);
  });
});

describe('Documentos', () => {
  it('carga un documento conservando el original, con visibilidad según categoría', async () => {
    const blob = new Blob([new TextEncoder().encode('%PDF-1.4 garantia')], { type: 'application/pdf' });
    const d = await addDocument(repo, { name: 'Garantía heladera', category: 'garantias', file: blob, fileName: 'garantia.pdf', tags: ['heladera'] }, MAMA);
    expect(d.visibility).toBe('familia');
    const stored = await repo.db.files.get(d.attachmentId!);
    expect(new TextDecoder().decode(new Uint8Array(await stored!.blob.arrayBuffer()))).toBe('%PDF-1.4 garantia');
    const f = await addDocument(repo, { name: 'Factura internet', category: 'facturas', file: new Blob([new TextEncoder().encode('fac')], { type: 'application/pdf' }), fileName: 'f.pdf' }, MAMA);
    expect(f.visibility).toBe('adultos');
    const profiles = await repo.list('profiles');
    const hijo = profiles.find((p) => p.id === HIJO)!;
    const mama = profiles.find((p) => p.id === MAMA)!;
    const docs = await repo.list('documents');
    expect(searchDocuments(docs, hijo, {}).map((x) => x.name)).toEqual(['Garantía heladera']);
    expect(searchDocuments(docs, mama, { text: 'heladera' })).toHaveLength(1);
    await expect(addDocument(repo, { name: 'malo', category: 'otros', file: new Blob([new Uint8Array([1])], { type: 'application/x-msdownload' }), fileName: 'virus.exe' })).rejects.toThrow('no admitido');
  });
});

describe('Casa y mantenimiento', () => {
  it('una reparación genera su tarea y su factura se vincula al gasto sin duplicarlo', async () => {
    const room = await repo.create('rooms', { name: 'Lavadero' });
    const asset = await repo.create('assets', { name: 'Lavarropas', category: 'electrodomesticos', roomId: room.id, photoIds: [] });
    const { repair, taskId } = await createRepair(repo, { title: 'Lavarropas pierde agua', assetId: asset.id, roomId: room.id, createTask: true, taskAssigneeId: PAPA }, MAMA);
    const task = await repo.get('tasks', taskId!);
    expect(task!.relatedId).toBe(repair.id);
    expect(task!.roomId).toBe(room.id);
    const doc = await addDocument(repo, { name: 'Factura técnico', category: 'facturas', file: new Blob([new TextEncoder().encode('f')], { type: 'application/pdf' }), fileName: 'f.pdf' }, MAMA);
    const r1 = await linkRepairInvoice(repo, repair.id, { amount: 30000, date: '2026-10-11', docId: doc.id });
    expect(r1.expense.repairId).toBe(repair.id);
    expect(r1.expense.receiptDocId).toBe(doc.id);
    const r2 = await linkRepairInvoice(repo, repair.id, { amount: 32000, docId: doc.id }); // corrección
    expect(r2.expense.id).toBe(r1.expense.id);
    expect(await repo.list('expenses')).toHaveLength(1);
    expect((await repo.get('documents', doc.id))!.relatedId).toBe(repair.id);
  });
  it('un plan de mantenimiento usa la frecuencia definida por la familia', async () => {
    const m = await createMaintenance(repo, { title: 'Limpiar filtro de la pileta', category: 'pileta', recurrence: { freq: 'daily', interval: 15 }, startDate: '2026-10-12' });
    const occ = (await repo.list('tasks')).find((t) => t.maintenanceId === m.id && !t.isSeries)!;
    expect(occ.dueDate).toBe('2026-10-12');
    const { next } = await completeTask(repo, occ.id);
    expect(next!.dueDate).toBe('2026-10-27');
    await expect(repo.create('maintenance', { title: 'Sin frecuencia', category: 'otros', active: true } as any)).rejects.toThrow('frecuencia');
  });
});

describe('Perfiles y permisos', () => {
  it('los perfiles infantiles no ven economía, documentos privados ni configuración', async () => {
    const profiles = await repo.list('profiles');
    expect(profiles.map((p) => p.name).sort()).toEqual(['Familia', 'Hija', 'Hijo', 'Mamá', 'Papá']);
    const t = profiles.find((p) => p.id === HIJO)!;
    const s = profiles.find((p) => p.id === MAMA)!;
    expect(can(t, 'finance.view')).toBe(false);
    expect(canOpenModule(t, 'economia')).toBe(false);
    expect(can(t, 'settings.admin')).toBe(false);
    expect(can(s, 'finance.view')).toBe(true);
    // aunque se edite la matriz, la administración nunca se habilita a chicos
    await setConfig(repo, 'permissions', { adult: {}, child: { 'settings.admin': true, 'finance.view': true } });
    const m = permissionsFrom(await repo.list('config'));
    expect(can(t, 'settings.admin', m)).toBe(false);
    expect(can(t, 'finance.view', m)).toBe(true);
  });
  it('el perfil seleccionado cambia lo que se ve: búsqueda y avisos', async () => {
    await createPayment(repo, { concept: 'Expensas', category: 'vivienda', amount: 1000, dueDate: today() });
    await createTask(repo, { title: 'Ordenar juguetes', category: 'orden', assigneeId: HIJO, dueDate: today() });
    await createTask(repo, { title: 'Pagar expensas', category: 'tramites', assigneeId: MAMA, dueDate: today() });
    const profiles = await repo.list('profiles');
    const t = profiles.find((p) => p.id === HIJO)!, s = profiles.find((p) => p.id === MAMA)!;
    expect((await globalSearch(repo, 'expensas', t)).map((h) => h.entity)).toEqual(['tasks']);
    expect((await globalSearch(repo, 'expensas', s)).map((h) => h.entity).sort()).toEqual(['payments', 'tasks']);
    const base = { events: [], tasks: await repo.list('tasks'), payments: await repo.list('payments'), settings: DEFAULT_NOTIFICATION_SETTINGS, sync: { pending: 0, errors: 0, conflicts: 0, configured: false } };
    const forKid = buildNotifications({ ...base, profile: t, financeVisible: false });
    expect(forKid.map((n) => n.title)).toEqual(['Ordenar juguetes']);
    const forAdult = buildNotifications({ ...base, profile: s, financeVisible: true });
    expect(forAdult.map((n) => n.kind).sort()).toEqual(['pago', 'tarea', 'tarea']);
  });
  it('perfil Familia: ve lo de todos junto, pero no economía ni administración', async () => {
    const fam = (await repo.get('profiles', 'profile-familia'))!;
    expect(fam).toMatchObject({ role: 'family', color: '#c3bdaf' });
    expect(can(fam, 'finance.view')).toBe(false);
    expect(canOpenModule(fam, 'economia')).toBe(false);
    expect(canOpenModule(fam, 'compras')).toBe(true);
    expect(can(fam, 'settings.admin')).toBe(false);
    await createTask(repo, { title: 'Ordenar juguetes', category: 'orden', assigneeId: HIJO, dueDate: today() });
    await createTask(repo, { title: 'Llamar al banco', category: 'tramites', assigneeId: MAMA, dueDate: today() });
    const n = buildNotifications({ events: [], tasks: await repo.list('tasks'), payments: [], settings: DEFAULT_NOTIFICATION_SETTINGS, sync: { pending: 0, errors: 0, conflicts: 0, configured: false }, profile: fam, financeVisible: false });
    expect(n.map((x) => x.title).sort()).toEqual(['Llamar al banco', 'Ordenar juguetes']);
  });
  it('los chicos pueden pedir cosas en Compras y queda quién lo pidió', async () => {
    const t = (await repo.get('profiles', HIJO))!;
    expect(canOpenModule(t, 'compras')).toBe(true);
    const r = await addItem(repo, { listId: DEFAULT_LIST_ID, name: 'Cartulina verde', category: 'colegio', requestedBy: HIJO }, { by: HIJO });
    expect(r.item!.requestedBy).toBe(HIJO);
  });
  it('actualiza dispositivos ya inicializados: agrega Familia sin tocar ni duplicar los perfiles existentes', async () => {
    const old = await Repo.open('old-' + uuid());
    await old.create('profiles', { id: 'profile-ana', name: 'Ana', role: 'adult', color: '#123456', avatar: 'A', active: true, aliases: [], prefs: {} });
    await old.db.setKV('seeded', true);
    await ensureSeed(old);
    expect((await old.get('profiles', 'profile-ana'))!.color).toBe('#123456');
    expect(await old.get('profiles', 'profile-papa')).toBeUndefined();
    expect(await old.get('profiles', 'profile-familia')).toBeTruthy();
  });
  it('PIN opcional: se guarda solo el hash', async () => {
    const h = await hashPin('1234', MAMA);
    expect(h).toHaveLength(64);
    expect(h).not.toContain('1234');
    expect(await hashPin('1234', MAMA)).toBe(h);
    expect(await hashPin('1235', MAMA)).not.toBe(h);
  });
});

describe('Exportación y restauración', () => {
  it('exporta, valida, detecta copias incompletas o alteradas y restaura', async () => {
    const t = await createTask(repo, { title: 'Renovar DNI', category: 'tramites' });
    await addDocument(repo, { name: 'Escaneo', category: 'familia', file: new Blob([new TextEncoder().encode('img')], { type: 'image/png' }), fileName: 'e.png' });
    const backup = await exportAll(repo, { includeFiles: true });
    expect((await validateBackup(backup)).ok).toBe(true);
    const json = JSON.parse(JSON.stringify(backup));

    const incomplete = JSON.parse(JSON.stringify(backup));
    incomplete.data.tasks.pop();
    expect((await validateBackup(incomplete)).errors.join(' ')).toContain('incompleta');
    const tampered = JSON.parse(JSON.stringify(backup));
    tampered.data.tasks[0].title = 'cambiado';
    expect((await validateBackup(tampered)).errors.join(' ')).toContain('suma de verificación');
    await expect(restoreBackup(repo, tampered)).rejects.toThrow('No se restauró nada');

    // pérdida de datos y restauración en otro "dispositivo"
    const other = await Repo.open('restore-' + uuid());
    const res = await restoreBackup(other, json);
    expect(res.restored).toBeGreaterThan(0);
    expect(res.files).toBe(1);
    expect((await other.get('tasks', t.id))!.title).toBe('Renovar DNI');
    expect(await other.db.localBackups.count()).toBe(1); // copia previa de seguridad
    const restoredDoc = (await other.list('documents'))[0];
    expect(await (await other.db.files.get(restoredDoc.attachmentId!))!.blob.text()).toBe('img');
  });
  it('las copias locales automáticas conservan solo las últimas', async () => {
    for (let i = 0; i < 7; i++) await saveLocalBackup(repo, 'prueba', 5);
    expect(await repo.db.localBackups.count()).toBe(5);
  });
});

describe('Datos de demostración', () => {
  it('se identifican y se eliminan por completo', async () => {
    const n = await loadDemo(repo, MAMA);
    expect(n).toBeGreaterThan(5);
    const demoTasks = (await repo.list('tasks')).filter((t) => t.demo);
    expect(demoTasks.every((t) => t.title.startsWith('[Demo]'))).toBe(true);
    await repo.purgeDemo();
    for (const e of ['tasks', 'events', 'shoppingItems', 'payments', 'repairs'] as const) expect((await repo.list(e)).filter((r: any) => r.demo)).toHaveLength(0);
    expect(addDays('2026-10-11', 1)).toBe('2026-10-12');
  });
});

describe('Carpetas de Drive para cada archivo', () => {
  it('elige la carpeta según persona, categoría y relación, y la actualiza si el documento cambia', async () => {
    const { documentFolder } = await import('../src/services/folders');
    const { relocateDocumentFile } = await import('../src/services/documents');
    const profiles = await repo.list('profiles');
    expect(documentFolder({ category: 'identidad', personId: 'profile-mama' }, profiles)).toBe('documentos/Mamá');
    expect(documentFolder({ category: 'salud', personId: 'profile-hija' }, profiles)).toBe('peques/Hija');
    expect(documentFolder({ category: 'facturas', date: '2026-10-05' }, profiles)).toBe('gastos/2026-10');
    expect(documentFolder({ category: 'contratos', relatedType: 'investments', relatedId: 'inv1' }, profiles)).toBe('inversion/inv1/Contratos');
    expect(documentFolder({ category: 'manuales' }, profiles)).toBe('casa/Manuales y garantías');
    expect(documentFolder({ category: 'otros' }, profiles)).toBe('documentos/Familia');
    const d = await addDocument(repo, { name: 'DNI', category: 'identidad', personId: 'profile-papa', file: new Blob([new TextEncoder().encode('dni')], { type: 'image/jpeg' }), fileName: 'dni.jpg' });
    expect(d.visibility).toBe('adultos');
    expect((await repo.get('attachments', d.attachmentId!))!.folder).toBe('documentos/Papá');
    await repo.update('documents', d.id, { personId: 'profile-hijo' });
    await relocateDocumentFile(repo, d.id);
    expect((await repo.get('attachments', d.attachmentId!))!.folder).toBe('peques/Hijo');
  });
});

describe('paleta de perfiles', () => {
  it('cambia a la paleta nueva solo los colores de fábrica, sin tocar los elegidos a mano', async () => {
    const r = await Repo.open('pal-' + uuid());
    await r.create('profiles', { id: 'profile-x', name: 'X', role: 'adult', color: '#b1afb6', avatar: 'X', active: true, aliases: [], prefs: {} });
    await r.create('profiles', { id: 'profile-y', name: 'Y', role: 'child', color: '#123456', avatar: 'Y', active: true, aliases: [], prefs: {} });
    await r.db.setKV('seeded', true); await r.db.setKV('seedVersion', 2);
    await ensureSeed(r);
    expect((await r.get('profiles', 'profile-x'))!.color).toBe('#aa9aad');
    expect((await r.get('profiles', 'profile-y'))!.color).toBe('#123456');
  });
});

describe('compras por rubro', () => {
  it('ubica productos de ferretería y saca "Comprar" del nombre', async () => {
    const { guessShopCategory } = await import('../src/ai/rules');
    const { cleanItemName } = await import('../src/services/shopping');
    for (const n of ['Codo 110', 'Rejilla pluvial . codo 110', 'Caño de PVC los codos de 110', 'Codo de PVC en ferretería']) expect(guessShopCategory(n)).toBe('ferreteria');
    expect(guessShopCategory('liquido para limpiar zapatos')).toBe('limpieza');
    expect(guessShopCategory('Uvas')).toBe('supermercado');
    expect(cleanItemName('Comprar bananas')).toBe('Bananas');
  });
  it('pasa las listas sueltas a la lista principal (sin perder productos) y corrige rubros una vez', async () => {
    const { tidyShopping, DEFAULT_LIST_ID } = await import('../src/services/shopping');
    const { guessShopCategory } = await import('../src/ai/rules');
    const { categoriesFrom } = await import('../src/services/config');
    const far = await repo.create('shoppingLists', { name: 'Farmacia', isTemplate: false, archived: false });
    const hab = await repo.create('shoppingLists', { name: 'Habitual del mes', isTemplate: true, archived: false });
    const a = await repo.create('shoppingItems', { listId: far.id, name: 'Ibuprofeno', category: 'supermercado', priority: 'media', status: 'pendiente' });
    const b = await repo.create('shoppingItems', { listId: DEFAULT_LIST_ID, name: 'Codo 110', category: 'supermercado', priority: 'media', status: 'pendiente' });
    await tidyShopping(repo, guessShopCategory, categoriesFrom([], 'shopping'));
    expect(await repo.get('shoppingItems', a.id)).toMatchObject({ listId: DEFAULT_LIST_ID, category: 'farmacia' });
    expect((await repo.get('shoppingItems', b.id))!.category).toBe('ferreteria');
    expect((await repo.get('shoppingLists', far.id))!.deleted).toBe(true);
    expect((await repo.get('shoppingLists', hab.id))!.deleted).toBeFalsy(); // las habituales no se tocan
  });
});
