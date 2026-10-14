// @vitest-environment node
// Carpetas de la familia en Drive, planillas en castellano y sincronización en ambos sentidos (app ⇄ Sheets).
import { describe, it, expect, beforeEach } from 'vitest';
import { Repo } from '../src/db/repo';
import { SyncEngine } from '../src/sync/engine';
import { ensureSeed } from '../src/services/seed';
import { createPayment, createExpense } from '../src/services/money';
import { storeFile } from '../src/services/files';
import { uuid } from '../src/domain/ids';
import { createGasServer, GasTransport, type GasServer } from './gas-harness';

const FAMILY_FOLDERS = ['Documentos', 'Gastos Mensuales casa', 'Inversiones', 'Peques', 'Reforma, mantenimiento casa'];

function serverWithFamilyDrive() {
  const s = createGasServer();
  for (const n of FAMILY_FOLDERS) s.drive.root.createFolder(n);
  const inv = s.drive.path('Inversiones')!;
  inv.createFolder('Depto Palermo');
  inv.createFolder('Local Centro').createFolder('Contratos'); // ya tenía una subcarpeta
  s.drive.path('Documentos')!.createFile('DNI viejo.pdf', 'x', 'application/pdf'); // archivo existente: no se toca
  return s;
}
async function device(server: GasServer) {
  const repo = await Repo.open('dv-' + uuid());
  await ensureSeed(repo);
  const t = new GasTransport(server);
  return { repo, t, engine: new SyncEngine(repo, async () => t, () => true) };
}
const sys = 10; // columnas técnicas ocultas al principio
const header = (s: GasServer, entity: string) => s.tab(entity).data[0];
const col = (s: GasServer, entity: string, label: string) => header(s, entity).indexOf(label);

let server: GasServer;
beforeEach(() => {
  server = serverWithFamilyDrive();
  const r = server.call('setup');
  expect(r.ok).toBe(true);
});

describe('carpetas existentes de la familia', () => {
  it('adopta las carpetas sin duplicarlas ni renombrarlas y arma la estructura adentro', () => {
    for (const n of FAMILY_FOLDERS) expect(server.drive.root.folders.filter((f) => f.name === n)).toHaveLength(1);
    expect(server.drive.path('Documentos')!.files.map((f) => f.name)).toContain('DNI viejo.pdf');
    expect(server.drive.path('Hogar App', 'Backups')).toBeTruthy();
    expect(server.drive.path('Gastos Mensuales casa', 'Comprobantes')).toBeTruthy();
    expect(server.drive.path('Reforma, mantenimiento casa', 'Manuales y garantías')).toBeTruthy();
    // planillas dentro de cada carpeta
    const sheetIn = (folder: string, title: string) => server.drive.path(folder)!.files.find((f) => f.name === title && f.getMimeType() === 'application/vnd.google-apps.spreadsheet');
    expect(sheetIn('Gastos Mensuales casa', 'Gastos de la casa')).toBeTruthy();
    expect(sheetIn('Inversiones', 'Inversiones')).toBeTruthy();
    expect(sheetIn('Reforma, mantenimiento casa', 'Casa y mantenimiento')).toBeTruthy();
    expect(sheetIn('Documentos', 'Índice de documentos')).toBeTruthy();
    expect(sheetIn('Hogar App', 'Hogar — datos de la app')).toBeTruthy();
    // pestañas en castellano, columnas técnicas ocultas, sin "Hoja 1" vacía
    expect(server.book('gastos').getSheets().map((s) => s.getName())).toEqual(['Pagos', 'Gastos']);
    expect(header(server, 'payments').slice(sys, sys + 5)).toEqual(['Concepto', 'Categoría', 'Proveedor', 'Importe', 'Moneda']);
    expect(server.tab('payments').hidden).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // una segunda inicialización no duplica nada
    server.call('setup');
    expect(server.drive.root.folders.filter((f) => f.name === 'Inversiones')).toHaveLength(1);
    expect(server.drive.path('Inversiones')!.files.filter((f) => f.name === 'Inversiones')).toHaveLength(1);
    expect(server.triggers.filter((t) => t.fn === 'onSheetEdit')).toHaveLength(5);
  });

  it('lista los archivos de la carpeta de una inversión (p. ej. la planilla del plan de pagos) para abrirlos desde la app', async () => {
    const local = server.drive.path('Inversiones', 'Local Centro')!;
    local.createFile('Plan de pago', '', 'application/vnd.google-apps.spreadsheet');
    local.folders.find((f) => f.name === 'Contratos')!.createFile('contrato.pdf', 'x', 'application/pdf');
    const d = await device(server);
    await d.engine.syncNow();
    const inv = (await d.repo.list('investments')).find((i) => i.name === 'Local Centro')!;
    const r = server.call('investmentFiles', { investmentId: inv.id }).result;
    expect(r.files.map((f: any) => [f.name, f.path])).toEqual(expect.arrayContaining([['Plan de pago', ''], ['contrato.pdf', 'Contratos']]));
    expect(r.files.find((f: any) => f.name === 'Plan de pago').mimeType).toBe('application/vnd.google-apps.spreadsheet');
    expect(server.call('investmentFiles', { investmentId: 'no-existe' }).ok).toBe(false);
  });
  it('cada subcarpeta de Inversiones es una inversión, con sus subcarpetas y una pestaña de resumen', async () => {
    const invs = server.tab('investments').data.slice(1).map((r) => r[sys]);
    expect(invs.sort()).toEqual(['Depto Palermo', 'Local Centro']);
    const local = server.drive.path('Inversiones', 'Local Centro')!;
    expect(local.folders.map((f) => f.name).sort()).toEqual(['Contratos', 'Impuestos', 'Mantenimiento', 'Otros']); // Contratos ya existía: no se duplicó
    const summary = server.book('inversiones').getSheetByName('Resumen - Depto Palermo')!;
    expect(Object.values(summary.formulas).join(' ')).toContain('FILTER(');
    // la app las recibe
    const d = await device(server);
    await d.engine.syncNow();
    expect((await d.repo.list('investments')).map((i) => i.name).sort()).toEqual(['Depto Palermo', 'Local Centro']);
    // una inversión nueva desde la app crea su carpeta y un contrato muestra el nombre de la inversión
    const nueva = await d.repo.create('investments', { name: 'Cochera Belgrano', kind: 'cochera', currency: 'USD' });
    await d.repo.create('investmentContracts', { investmentId: nueva.id, kind: 'alquiler', counterpart: 'Juan P.', amount: 80000, currency: 'ARS', status: 'vigente', startDate: '2026-01-01', endDate: '2027-12-31' });
    await d.engine.syncNow();
    expect(server.drive.path('Inversiones', 'Cochera Belgrano', 'Impuestos')).toBeTruthy();
    const contract = server.tab('investmentContracts').data[1];
    expect(contract[col(server, 'investmentContracts', 'Inversión')]).toBe('Cochera Belgrano');
    expect(server.book('inversiones').getSheetByName('Resumen - Cochera Belgrano')).toBeTruthy();
    await d.engine.syncNow();
    expect((await d.repo.get('investments', nueva.id))!.driveUrl).toContain('drive.google.com');
  });
});

describe('planillas legibles y editables a mano', () => {
  it('lo cargado en la app aparece en "Gastos de la casa" con nombres y Sí/No', async () => {
    const d = await device(server);
    await createPayment(d.repo, { concept: 'Luz', category: 'servicios', amount: 45000, dueDate: '2026-10-20', responsibleId: 'profile-mama' });
    await createExpense(d.repo, { concept: 'Súper', amount: 12500, date: '2026-10-11', category: 'supermercado', extraordinary: true });
    await d.engine.syncNow();
    const pay = server.tab('payments').data[1];
    expect(pay[col(server, 'payments', 'Concepto')]).toBe('Luz');
    expect(pay[col(server, 'payments', 'Responsable')]).toBe('Mamá');
    expect(pay[col(server, 'payments', 'Importe')]).toBe(45000);
    expect(server.tab('expenses').data[1][col(server, 'expenses', 'Extraordinario')]).toBe('Sí');
  });

  it('una fila cargada a mano en Sheets llega a la app (fechas y montos argentinos, persona por nombre)', async () => {
    const d = await device(server);
    await d.engine.syncNow();
    const sh = server.tab('expenses');
    const row = new Array(header(server, 'expenses').length).fill('');
    row[col(server, 'expenses', 'Fecha')] = '15/10/2026';
    row[col(server, 'expenses', 'Importe')] = '45.000';
    row[col(server, 'expenses', 'Concepto')] = 'Plomero';
    row[col(server, 'expenses', 'Responsable')] = 'Papá';
    sh.data.push(row);
    server.edit('expenses', sh.data.length);
    expect(sh.data[1][0]).toMatch(/[0-9a-f-]{36}/); // se le asignó ID
    await d.engine.syncNow();
    const e = (await d.repo.list('expenses'))[0];
    expect(e).toMatchObject({ concept: 'Plomero', amount: 45000, date: '2026-10-15', responsibleId: 'profile-papa', currency: 'ARS', origin: 'planilla' });
    // editar una celda existente actualiza la app
    sh.data[1][col(server, 'expenses', 'Importe')] = '47.500,50';
    server.edit('expenses', 2);
    await d.engine.syncNow();
    expect((await d.repo.get('expenses', e.id))!.amount).toBe(47500.5);
  });

  it('una fila incompleta queda marcada y no llega a la app hasta completarla', async () => {
    const d = await device(server);
    const sh = server.tab('expenses');
    const row = new Array(header(server, 'expenses').length).fill('');
    row[col(server, 'expenses', 'Concepto')] = 'Pintura';
    sh.data.push(row);
    server.edit('expenses', 2);
    expect(Object.values(sh.notes).join(' ')).toContain('Falta completar');
    await d.engine.syncNow();
    expect(await d.repo.list('expenses')).toHaveLength(0);
    sh.data[1][col(server, 'expenses', 'Fecha')] = '20/10/2026';
    sh.data[1][col(server, 'expenses', 'Importe')] = '30000';
    server.edit('expenses', 2);
    await d.engine.syncNow();
    expect((await d.repo.list('expenses')).map((x) => x.concept)).toEqual(['Pintura']);
  });

  it('marcar "Eliminado: Sí" o borrar la fila en la planilla lo quita de la app; un borrado masivo no se aplica', async () => {
    const d = await device(server);
    for (let i = 0; i < 12; i++) await createExpense(d.repo, { concept: `Gasto ${i}`, amount: 100 + i, date: '2026-10-01' });
    await d.engine.syncNow();
    const sh = server.tab('expenses');
    // Eliminado = Sí
    sh.data[1][5] = 'Sí';
    server.edit('expenses', 2);
    // borrar una fila
    sh.data.splice(2, 1);
    server.ctx.onSheetChange({ changeType: 'REMOVE_ROW' });
    await d.engine.syncNow();
    expect((await d.repo.list('expenses')).length).toBe(10);
    // vaciar la pestaña por error: no se borra nada en la app
    sh.data.splice(1);
    server.ctx.onSheetChange({ changeType: 'REMOVE_ROW' });
    const r = await d.engine.syncNow();
    expect(r.errors.join(' ')).toContain('de golpe');
    expect((await d.repo.list('expenses')).length).toBe(10);
  });
});

describe('archivos en la carpeta que corresponde', () => {
  it('documentos personales, de los chicos, comprobantes e inversiones van a su carpeta; reclasificar mueve el archivo', async () => {
    const d = await device(server);
    await d.engine.syncNow();
    const inv = (await d.repo.list('investments')).find((i) => i.name === 'Depto Palermo')!;
    const put = async (name: string, folder: string) => (await storeFile(d.repo, new Blob([new TextEncoder().encode(name)], { type: 'application/pdf' }), name, folder)).attachment;
    await put('dni-mama.pdf', 'documentos/Mamá');
    await put('vacunas-hija.pdf', 'peques/Hija');
    await put('factura-luz.pdf', 'gastos/2026-10');
    await put('contrato.pdf', `inversion/${inv.id}/Contratos`);
    const captured = await put('foto-pasaporte.pdf', 'app/Capturas');
    await d.engine.syncNow();
    expect(server.drive.path('Documentos', 'Mamá')!.files.map((f) => f.name)).toContain('dni-mama.pdf');
    expect(server.drive.path('Peques', 'Hija')!.files.map((f) => f.name)).toContain('vacunas-hija.pdf');
    expect(server.drive.path('Gastos Mensuales casa', 'Comprobantes', '2026-10')!.files.map((f) => f.name)).toContain('factura-luz.pdf');
    expect(server.drive.path('Inversiones', 'Depto Palermo', 'Contratos')!.files.map((f) => f.name)).toContain('contrato.pdf');
    // la captura se confirma como documento de Papá: el archivo se mueve
    await d.repo.update('attachments', captured.id, { folder: 'documentos/Papá' });
    await d.engine.syncNow();
    expect(server.drive.path('Documentos', 'Papá')!.files.map((f) => f.name)).toContain('foto-pasaporte.pdf');
    expect(server.drive.path('Hogar App', 'Capturas')!.files.map((f) => f.name)).not.toContain('foto-pasaporte.pdf');
  });
  it('rechaza carpetas fuera de las permitidas', () => {
    const r = server.call('uploadFile', { id: 'x', name: 'a.pdf', mimeType: 'application/pdf', folder: '../../otra', hash: 'h', base64: 'aA==' });
    expect(r.ok).toBe(false);
  });
});
