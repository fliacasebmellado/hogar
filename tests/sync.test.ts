// @vitest-environment node
// Pruebas de sincronización: dos dispositivos (IndexedDB simulada) contra el backend Apps Script real ejecutado
// sobre servicios de Google emulados en memoria.
import { describe, it, expect, beforeEach } from 'vitest';
import { Repo } from '../src/db/repo';
import { SyncEngine } from '../src/sync/engine';
import { ensureSeed } from '../src/services/seed';
import { createTask, completeTask } from '../src/services/tasks';
import { storeFile } from '../src/services/files';
import { validateBackup } from '../src/services/backup';
import { api, importFormResponses, importGmailMessages } from '../src/integrations/google';
import { uuid } from '../src/domain/ids';
import { createGasServer, GasTransport, type GasServer } from './gas-harness';

interface Device { repo: Repo; t: GasTransport; engine: SyncEngine }
async function device(server: GasServer, profile = 'profile-mama'): Promise<Device> {
  const repo = await Repo.open('dev-' + uuid());
  await ensureSeed(repo);
  await repo.db.setKV('currentProfileId', profile);
  const t = new GasTransport(server);
  return { repo, t, engine: new SyncEngine(repo, async () => t, () => t.online) };
}
const rows = (server: GasServer, entity: string) => server.tab(entity).data.slice(1);
const rowsById = (server: GasServer, sheet: string, id: string) => rows(server, sheet).filter((r) => r[0] === id);

let server: GasServer;
beforeEach(() => {
  server = createGasServer();
  expect(server.call('setup').ok).toBe(true);
});

describe('backend: inicialización y seguridad', () => {
  it('crea las hojas con encabezados válidos y detecta cambios incompatibles', () => {
    const v = server.call('validateSchema').result;
    expect(v.ok).toBe(true);
    const tasks = server.tab('tasks');
    tasks.data[0][12] = 'columna_renombrada';
    const v2 = server.call('validateSchema').result;
    expect(v2.ok).toBe(false);
    expect(v2.incompatible.join(' ')).toContain('Tareas');
  });
  it('rechaza solicitudes sin el token familiar y no expone datos por GET', () => {
    const r = server.call('pull', { since: 0, token: 'incorrecto' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('auth');
    expect(JSON.parse(server.ctx.doGet().getContent()).result).toEqual({ service: 'hogar', usage: 'POST' });
  });
});

describe('sincronización', () => {
  it('un dispositivo nuevo descarta los perfiles genéricos si la familia ya tiene los suyos en la planilla', async () => {
    const a = await Repo.open('fam-' + uuid());
    await a.create('profiles', { id: 'profile-ana', name: 'Ana', role: 'adult', color: '#111111', avatar: 'A', active: true, aliases: [], prefs: {} });
    await a.create('profiles', { id: 'profile-familia', name: 'Familia', role: 'family', color: '#222222', avatar: 'F', active: true, aliases: [], prefs: {} });
    const ta = new GasTransport(server);
    expect((await new SyncEngine(a, async () => ta, () => true).syncNow()).ok).toBe(true);

    const b = await device(server);
    expect((await b.repo.list('profiles')).map((p) => p.name)).toContain('Papá'); // antes de conectar
    expect((await b.engine.syncNow()).ok).toBe(true);
    expect((await b.repo.list('profiles')).map((p) => p.id).sort()).toEqual(['profile-ana', 'profile-familia']);
    expect(rows(server, 'profiles').map((r) => r[0]).sort()).toEqual(['profile-ana', 'profile-familia']);
  });
  it('en una familia nueva (planilla vacía) los perfiles genéricos se suben y un segundo dispositivo no los duplica', async () => {
    const a = await device(server);
    expect((await a.engine.syncNow()).ok).toBe(true);
    const b = await device(server);
    expect((await b.engine.syncNow()).ok).toBe(true);
    expect((await b.repo.list('profiles')).length).toBe(5);
    expect(rows(server, 'profiles').length).toBe(5);
  });
  it('crea datos sin conexión, los conserva y los envía al recuperar la conexión', async () => {
    const a = await device(server);
    a.t.online = false;
    const task = await createTask(a.repo, { title: 'Comprar regalo', category: 'familia' }, { by: 'profile-mama' });
    const r1 = await a.engine.syncNow();
    expect(r1.status).toBe('offline');
    expect((await a.repo.get('tasks', task.id))!._sync).toBe('pending');
    expect(await a.repo.db.outbox.count()).toBeGreaterThan(0);

    a.t.online = true;
    const r2 = await a.engine.syncNow();
    expect(r2.status).toBe('ok');
    expect(r2.pushed).toBeGreaterThan(0);
    expect(await a.repo.db.outbox.count()).toBe(0);
    expect((await a.repo.get('tasks', task.id))!._sync).toBe('synced');
    expect(rowsById(server, 'tasks', task.id)).toHaveLength(1);

    // un segundo dispositivo recibe el dato
    const b = await device(server, 'profile-papa');
    await b.engine.syncNow();
    expect((await b.repo.get('tasks', task.id))?.title).toBe('Comprar regalo');
  });

  it('la inicialización en dos dispositivos no duplica perfiles ni genera conflictos', async () => {
    const a = await device(server);
    const b = await device(server);
    await a.engine.syncNow();
    const rb = await b.engine.syncNow();
    expect(rb.conflicts).toBe(0);
    expect(rows(server, 'profiles')).toHaveLength(5); // 4 integrantes + Familia
    expect(await b.repo.db.conflicts.count()).toBe(0);
  });

  it('reintenta una operación fallida (falla antes de llegar al servidor)', async () => {
    const a = await device(server);
    await a.engine.syncNow();
    const t = await createTask(a.repo, { title: 'Llamar al plomero', category: 'mantenimiento' });
    a.t.failNext = 'before';
    const r = await a.engine.syncNow();
    expect(r.ok).toBe(false);
    const op = (await a.repo.db.outbox.toArray()).find((o) => o.recordId === t.id)!;
    expect(op.status).toBe('error');
    await a.engine.retryErrors();
    expect(await a.repo.db.outbox.count()).toBe(0);
    expect(rowsById(server, 'tasks', t.id)).toHaveLength(1);
  });

  it('no duplica si se corta la respuesta después de que el servidor guardó (interrupción durante el guardado)', async () => {
    const a = await device(server);
    await a.engine.syncNow();
    const t = await createTask(a.repo, { title: 'Pagar patente', category: 'tramites' });
    a.t.failNext = 'after'; // el servidor aplica el lote pero la respuesta se pierde
    await a.engine.syncNow();
    expect(rowsById(server, 'tasks', t.id)).toHaveLength(1);
    await a.engine.retryErrors();
    const res = (await a.repo.db.getKV<any>('lastSyncResult'));
    expect(res.duplicates).toBeGreaterThan(0); // el reintento fue reconocido como ya aplicado
    expect(rowsById(server, 'tasks', t.id)).toHaveLength(1);
    expect(await a.repo.db.outbox.count()).toBe(0);
    expect(Number(rowsById(server, 'tasks', t.id)[0][2])).toBe(1); // versión 1: se escribió una sola vez
  });

  it('detecta conflictos entre dispositivos sin sobrescribir y permite resolverlos', async () => {
    const a = await device(server, 'profile-mama');
    const b = await device(server, 'profile-papa');
    const t = await createTask(a.repo, { title: 'Turno dentista', category: 'tramites' });
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.repo.update('tasks', t.id, { title: 'Turno dentista (martes)' });
    await b.repo.update('tasks', t.id, { title: 'Turno dentista (jueves)' });
    await a.engine.syncNow();
    const rb = await b.engine.syncNow();
    expect(rb.conflicts).toBe(1);
    expect(rowsById(server, 'tasks', t.id)[0][10]).toBe('Turno dentista (martes)'); // no se pisó
    const conflict = (await b.repo.db.conflicts.toArray())[0];
    expect(conflict.fields).toContain('title');
    expect((await b.repo.get('tasks', t.id))!._sync).toBe('conflict');
    await b.engine.resolveConflict(conflict.id, 'local');
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect((await a.repo.get('tasks', t.id))!.title).toBe('Turno dentista (jueves)');
    const hist = (await b.repo.db.entity('history').where('recordId').equals(t.id).toArray()).map((h) => h.action);
    expect(hist).toContain('conflicto');
  });

  it('fusiona automáticamente cambios en campos distintos', async () => {
    const a = await device(server);
    const b = await device(server);
    const t = await createTask(a.repo, { title: 'Limpiar canaletas', category: 'patio' });
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.repo.update('tasks', t.id, { title: 'Limpiar canaletas del frente' });
    await b.repo.update('tasks', t.id, { priority: 'alta' });
    await a.engine.syncNow();
    const rb = await b.engine.syncNow();
    expect(rb.conflicts).toBe(0);
    expect(rb.autoMerged).toBe(1);
    await a.engine.syncNow();
    const final = await a.repo.get('tasks', t.id);
    expect(final!.title).toBe('Limpiar canaletas del frente');
    expect(final!.priority).toBe('alta');
  });

  it('las ocurrencias recurrentes generadas en dos dispositivos no se duplican', async () => {
    const a = await device(server);
    const b = await device(server);
    const first = await createTask(a.repo, { title: 'Regar plantas', category: 'patio', dueDate: '2026-10-12', recurrence: { freq: 'weekly', interval: 1 } });
    await a.engine.syncNow();
    await b.engine.syncNow();
    const { next: na } = await completeTask(a.repo, first.id, 'profile-mama');
    const { next: nb } = await completeTask(b.repo, first.id, 'profile-papa');
    expect(na!.id).toBe(nb!.id); // id determinista
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(rowsById(server, 'tasks', na!.id)).toHaveLength(1);
  });

  it('una transacción interrumpida no deja datos a medias', async () => {
    const a = await device(server);
    const before = await a.repo.db.outbox.count();
    await expect(a.repo.tx(async () => {
      await createTask(a.repo, { title: 'A medias', category: 'otras' });
      throw new Error('corte de energía simulado');
    })).rejects.toThrow('corte');
    expect((await a.repo.list('tasks')).find((t) => t.title === 'A medias')).toBeUndefined();
    expect(await a.repo.db.outbox.count()).toBe(before);
  });

  it('textos que parecen fórmulas se guardan como texto en Sheets', async () => {
    const a = await device(server);
    const t = await createTask(a.repo, { title: '=HYPERLINK("http://x")', category: 'otras' });
    const r = await a.engine.syncNow();
    expect(r.errors).toEqual([]);
    const b = await device(server);
    await b.engine.syncNow();
    expect((await b.repo.get('tasks', t.id))!.title).toBe('=HYPERLINK("http://x")');
  });

  it('un encabezado incompatible bloquea la escritura de esa hoja sin perder el dato local', async () => {
    const a = await device(server);
    await a.engine.syncNow();
    server.tab('tasks').data[0][12] = 'otra_cosa';
    const t = await createTask(a.repo, { title: 'No debe perderse', category: 'otras' });
    const r = await a.engine.syncNow();
    expect(r.ok).toBe(false);
    expect(await a.repo.get('tasks', t.id)).toBeTruthy();
    expect((await a.repo.db.outbox.toArray()).some((o) => o.recordId === t.id)).toBe(true);
  });
});

describe('límites de Google Sheets', () => {
  it('agranda las hojas cuando faltan filas o columnas (hoja nueva: 1000 x 26)', async () => {
    expect(server.tab('tasks').maxCols).toBeGreaterThanOrEqual(34);
    server.tab('tasks').maxRows = 3; // simula una hoja casi llena
    server.ss().getSheetByName('_ops')!.maxRows = 3;
    const a = await device(server);
    for (let i = 0; i < 12; i++) await createTask(a.repo, { title: `Tarea ${i}`, category: 'otras' });
    const r = await a.engine.syncNow();
    expect(r.errors).toEqual([]);
    expect(rows(server, 'tasks')).toHaveLength(12);
  });
});

describe('archivos en Drive', () => {
  it('sube el archivo original, verifica integridad y evita duplicados por hash', async () => {
    const a = await device(server);
    const b = await device(server);
    const content = new TextEncoder().encode('factura de prueba');
    const { attachment } = await storeFile(a.repo, new Blob([content], { type: 'application/pdf' }), 'factura.pdf', 'Comprobantes');
    await a.engine.syncNow();
    const up = (await a.repo.get('attachments', attachment.id))!;
    expect(up.uploadStatus).toBe('uploaded');
    expect(server.drive.files.get(up.driveFileId!)!.blob.getDataAsString()).toBe('factura de prueba');
    const { attachment: other } = await storeFile(b.repo, new Blob([content], { type: 'application/pdf' }), 'copia.pdf', 'Comprobantes');
    await b.engine.syncNow();
    expect((await b.repo.get('attachments', other.id))!.driveFileId).toBe(up.driveFileId);
    expect([...server.drive.files.values()].filter((f) => f.name.endsWith('.pdf'))).toHaveLength(1);
    // descarga para uso sin conexión
    await b.repo.db.files.delete(other.id);
    const blob = await b.engine.downloadFile((await b.repo.get('attachments', other.id))!);
    expect(await blob.text()).toBe('factura de prueba');
  });
  it('rechaza un archivo dañado en tránsito', () => {
    const r = server.call('uploadFile', { id: 'x', name: 'a.pdf', mimeType: 'application/pdf', folder: 'Documentos', hash: 'mal', base64: Buffer.from('hola').toString('base64') });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('integrity');
  });
});

describe('copias de seguridad en Drive y recuperación', () => {
  it('crea una copia verificada, la restaura y los dispositivos vuelven a descargar', async () => {
    const a = await device(server);
    const kept = await createTask(a.repo, { title: 'Antes de la copia', category: 'otras' });
    await a.engine.syncNow();
    const bk = server.call('runBackup').result;
    expect(bk.valid).toBe(true);
    const list = server.call('listBackups').result;
    expect(list[0].valid).toBe(true);
    const data = server.call('getBackup', { fileId: bk.fileId }).result;
    expect((await validateBackup(data)).ok).toBe(true); // mismo formato y suma de verificación que la app

    const lost = await createTask(a.repo, { title: 'Después de la copia', category: 'otras' });
    await a.engine.syncNow();
    expect(rowsById(server, 'tasks', lost.id)).toHaveLength(1);

    const r = server.call('restoreBackup', { fileId: bk.fileId });
    expect(r.ok).toBe(true);
    expect(rowsById(server, 'tasks', lost.id)).toHaveLength(0);
    expect(server.call('listBackups').result.some((b: any) => b.kind === 'pre-restauracion' && b.valid)).toBe(true);

    await a.engine.syncNow(); // detecta la restauración y resincroniza
    expect(await a.repo.get('tasks', lost.id)).toBeUndefined();
    expect((await a.repo.get('tasks', kept.id))?.title).toBe('Antes de la copia');
  });
  it('no marca como válida una copia incompleta', async () => {
    const data = server.call('getBackup', { fileId: server.call('runBackup').result.fileId }).result;
    data.data.tasks.push({ id: 'agregado' });
    expect((await validateBackup(data)).ok).toBe(false);
  });
});

describe('Google Calendar (bidireccional)', () => {
  it('crea en Google, aplica cambios hechos en Google, informa conflictos y eventos externos', async () => {
    const a = await device(server);
    const ev = await a.repo.create('events', { title: 'Acto escolar', start: '2026-10-20T10:00', end: '2026-10-20T11:00', allDay: false, category: 'colegio', participantIds: [], reminders: [30], rsvp: 'pendiente', syncCalendar: true, attachmentIds: [] });
    await a.engine.syncNow();
    const r1 = server.call('calendarSync').result;
    expect(r1.created).toHaveLength(1);
    const g = server.calendar.events[0];
    expect(g.getTag('hogarId')).toBe(ev.id);
    expect(g.reminders).toEqual([30]);

    // segunda sincronización: sin cambios, sin duplicar
    await a.engine.syncNow();
    const r2 = server.call('calendarSync').result;
    expect(r2.created).toHaveLength(0);
    expect(server.calendar.events.filter((e) => !e.deleted)).toHaveLength(1);

    // cambio en Google → se aplica en la app informando qué cambió
    g.setTitle('Acto escolar (cambió el horario)');
    const r3 = server.call('calendarSync').result;
    expect(r3.updatedFromGoogle[0].changes.title).toEqual(['Acto escolar', 'Acto escolar (cambió el horario)']);
    await a.engine.syncNow();
    expect((await a.repo.get('events', ev.id))!.title).toBe('Acto escolar (cambió el horario)');

    // cambio en ambos → conflicto, no se toca nada
    g.setLocation('Gimnasio');
    await a.repo.update('events', ev.id, { location: 'Patio' });
    await a.engine.syncNow();
    const r4 = server.call('calendarSync').result;
    expect(r4.conflicts).toHaveLength(1);
    expect(g.getLocation()).toBe('Gimnasio');

    // evento creado en Google por fuera de la app → se lista como externo (no se importa solo)
    server.calendar.createEvent('Cumple de la abuela', new Date(Date.now() + 86400000), new Date(Date.now() + 90000000), {});
    const r5 = server.call('calendarSync').result;
    expect(r5.external.map((x: any) => x.title)).toContain('Cumple de la abuela');

    // borrado en Google → se informa, no se borra en la app
    g.deleteEvent();
    const r6 = server.call('calendarSync').result;
    expect(r6.deletedInGoogle).toHaveLength(1);
    await a.engine.syncNow();
    expect((await a.repo.get('events', ev.id))!.deleted).toBe(false);
  });
});

describe('Gmail y Forms (importación con revisión)', () => {
  it('Gmail está desactivado por defecto y, al habilitarlo, importa solo lo elegido sin duplicar', async () => {
    const a = await device(server);
    server.gmailMessages.push({ id: 'm1', threadId: 't1', subject: 'Factura Edenor', from: 'facturas@edenor.com', date: '2026-10-05T10:00:00Z', body: 'Su factura vence el 20/10 por $45.000' });
    expect(server.call('gmailSearch', { query: 'factura' }).code).toBe('disabled');
    server.call('setOption', { key: 'GMAIL_ENABLED', value: 'true' });
    const found = await api.gmailSearch(a.t, 'factura');
    expect(found).toHaveLength(1);
    const ids = await importGmailMessages(a.repo, a.t, ['m1']);
    const again = await importGmailMessages(a.repo, a.t, ['m1']);
    expect(again[0]).toBe(ids[0]);
    const c = await a.repo.get('captures', ids[0]);
    expect(c!.status).toBe('pendiente');
    expect(c!.text).toContain('vence el 20/10');
    expect(await a.repo.list('payments')).toHaveLength(0); // nada se crea sin revisión
  });
  it('Forms: importa respuestas nuevas una sola vez', async () => {
    const a = await device(server);
    const sh = server.ss().insertSheet('Respuestas de formulario 1');
    sh.data.push(['Marca temporal', '¿Qué hay que comprar?', '¿Quién?']);
    sh.data.push(['2026-10-10 10:00', 'Yerba y azúcar', 'Hijo']);
    expect(await importFormResponses(a.repo, a.t)).toBe(1);
    expect(await importFormResponses(a.repo, a.t)).toBe(0);
    const caps = await a.repo.list('captures');
    expect(caps).toHaveLength(1);
    expect(caps[0].text).toContain('Yerba y azúcar');
  });
});
