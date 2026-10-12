// Motor de sincronización dispositivo ⇄ Google (Sheets/Drive vía Apps Script).
//
// Orden de cada ciclo: 1) subir archivos pendientes a Drive  2) traer cambios (pull)  3) enviar operaciones (push).
// Garantías:
// - Idempotencia: cada operación tiene opId; el servidor registra las aplicadas y responde "duplicate" si se reintenta.
//   Así, un corte de red después de que el servidor guardó no crea duplicados.
// - Concurrencia optimista: cada operación lleva baseVersion. Si el servidor tiene otra versión → conflicto.
//   Si los cambios locales y remotos tocan campos distintos se fusionan automáticamente; si no, se pide decisión.
// - Nunca se sobrescribe en silencio un cambio de otro dispositivo.
import type { Repo } from '../db/repo';
import { businessDiff, stripLocal } from '../db/repo';
import type { Attachment, Conflict, EntityName, OutboxOp } from '../domain/types';
import { uuid } from '../domain/ids';
import { nowISO } from '../domain/dates';
import { BackendError, isRetryable, type Transport } from './transport';
import { blobToBase64, base64ToBlob } from '../services/files';
import schema from '../../shared/schema.json';
import { normalizeRecord } from '../domain/normalize';

const ORDER: string[] = schema.syncOrder;
const BATCH_SIZE = 40;
const MAX_BATCH_BYTES = 900_000;
const MAX_UPLOAD_BYTES_PER_RUN = 40 * 1024 * 1024;

export interface SyncReport {
  ok: boolean; status: 'ok' | 'offline' | 'not_configured' | 'error' | 'partial';
  pulled: number; pushed: number; duplicates: number; conflicts: number; autoMerged: number; errors: string[]; uploaded: number;
  startedAt: string; finishedAt: string;
}

export interface SyncStatus {
  configured: boolean; online: boolean; running: boolean; pending: number; errors: number; conflicts: number;
  lastSyncAt?: string; lastResult?: SyncReport; lastRev: number;
}

export class SyncEngine {
  private running: Promise<SyncReport> | null = null;
  private listeners = new Set<() => void>();

  constructor(
    public repo: Repo,
    private getTransport: () => Promise<Transport | null>,
    private isOnline: () => boolean = () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  ) {}

  onChange(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.listeners.forEach((f) => f()); }
  get isRunning() { return !!this.running; }

  async status(): Promise<SyncStatus> {
    const db = this.repo.db;
    const ops = await db.outbox.toArray();
    return {
      configured: !!(await this.getTransport()), online: this.isOnline(), running: this.isRunning, pending: ops.length,
      errors: ops.filter((o) => o.status === 'error').length,
      conflicts: await db.conflicts.filter((c) => !c.resolved).count(),
      lastSyncAt: await db.getKV('lastSyncAt'), lastResult: await db.getKV('lastSyncResult'), lastRev: await db.getKV('lastRev', 0),
    };
  }

  syncNow(): Promise<SyncReport> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => { this.running = null; this.emit(); });
    this.emit();
    return this.running;
  }

  private async run(): Promise<SyncReport> {
    const report: SyncReport = { ok: false, status: 'ok', pulled: 0, pushed: 0, duplicates: 0, conflicts: 0, autoMerged: 0, errors: [], uploaded: 0, startedAt: nowISO(), finishedAt: '' };
    const t = await this.getTransport();
    if (!t) { report.status = 'not_configured'; return this.finish(report, false); }
    if (!this.isOnline()) { report.status = 'offline'; return this.finish(report, false); }
    try {
      await this.uploadFiles(t, report);
      await this.pull(t, report);
      await this.push(t, report);
      if (report.pushed > 0) await this.pull(t, report); // recoge revisiones nuevas de otros dispositivos
      report.ok = report.errors.length === 0;
      report.status = report.ok ? 'ok' : 'partial';
    } catch (e: any) {
      report.status = e instanceof BackendError && e.code === 'network' ? 'offline' : 'error';
      report.errors.push(e?.message ?? String(e));
    }
    return this.finish(report, true);
  }

  private async finish(report: SyncReport, persist: boolean) {
    report.finishedAt = nowISO();
    if (persist) {
      await this.repo.db.setKV('lastSyncResult', report);
      if (report.status === 'ok' || report.status === 'partial') await this.repo.db.setKV('lastSyncAt', report.finishedAt);
      await this.log(report.ok ? 'info' : 'warn',
        `Sincronización ${report.status}: ↓${report.pulled} ↑${report.pushed}${report.conflicts ? ` · ${report.conflicts} conflicto(s)` : ''}${report.uploaded ? ` · ${report.uploaded} archivo(s)` : ''}`,
        report.errors.join(' | ') || undefined);
    }
    return report;
  }

  async log(level: 'info' | 'warn' | 'error', message: string, detail?: string) {
    await this.repo.db.syncLog.add({ at: nowISO(), level, message, detail });
    const count = await this.repo.db.syncLog.count();
    if (count > 300) {
      const old = await this.repo.db.syncLog.orderBy('id').limit(count - 300).primaryKeys();
      await this.repo.db.syncLog.bulkDelete(old);
    }
  }

  // ---------- Archivos ----------
  private async uploadFiles(t: Transport, report: SyncReport) {
    const atts = (await this.repo.db.entity('attachments').toArray()).filter((a) => !a.deleted && (a.uploadStatus === 'pending' || a.uploadStatus === 'error'));
    let bytes = 0;
    for (const a of atts) {
      const file = await this.repo.db.files.get(a.id);
      if (!file) continue;
      if (bytes + a.size > MAX_UPLOAD_BYTES_PER_RUN) break;
      try {
        const res = await t.call<{ driveFileId: string; driveUrl: string; deduped: boolean }>('uploadFile', {
          id: a.id, name: a.name, mimeType: a.mimeType, folder: a.folder, hash: a.hash, base64: await blobToBase64(file.blob),
        });
        await this.repo.update('attachments', a.id, { uploadStatus: 'uploaded', driveFileId: res.driveFileId, driveUrl: res.driveUrl }, { skipHistory: true });
        // el índice de documentos de Drive muestra el enlace al archivo
        for (const d of await this.repo.db.entity('documents').where('attachmentId').equals(a.id).toArray()) {
          if (!d.deleted && d.driveUrl !== res.driveUrl) await this.repo.update('documents', d.id, { driveUrl: res.driveUrl }, { skipHistory: true });
        }
        bytes += a.size;
        report.uploaded++;
      } catch (e: any) {
        if (e instanceof BackendError && e.code === 'network') throw e;
        await this.repo.update('attachments', a.id, { uploadStatus: 'error' }, { skipHistory: true });
        report.errors.push(`No se pudo subir "${a.name}": ${e.message}`);
      }
    }
  }

  /** Descarga un archivo de Drive para tenerlo disponible sin conexión. */
  async downloadFile(attachment: Attachment): Promise<Blob> {
    const t = await this.getTransport();
    if (!t) throw new Error('Google no está conectado.');
    if (!attachment.driveFileId) throw new Error('El archivo todavía no está en Drive.');
    const res = await t.call<{ base64: string; mimeType: string }>('getFile', { driveFileId: attachment.driveFileId });
    const blob = base64ToBlob(res.base64, res.mimeType || attachment.mimeType);
    await this.repo.db.files.put({ id: attachment.id, blob, storedAt: nowISO() });
    return blob;
  }

  // ---------- Pull ----------
  private async pull(t: Transport, report: SyncReport) {
    let since = await this.repo.db.getKV<number>('lastRev', 0);
    for (let page = 0; page < 50; page++) {
      const res = await t.call<{ rows: Record<string, any[]>; maxRev: number; hasMore: boolean; restoreEpoch?: string; idsEpoch?: string }>('pull', { since, limit: 500 });
      // Si el servidor fue restaurado desde una copia, se descarta la caché local sincronizada y se vuelve a descargar todo.
      const knownEpoch = await this.repo.db.getKV<string | undefined>('restoreEpoch', undefined);
      if (res.restoreEpoch !== undefined && knownEpoch !== res.restoreEpoch) {
        await this.repo.db.setKV('restoreEpoch', res.restoreEpoch ?? '');
        if (knownEpoch !== undefined && since > 0) {
          await this.clearSynced();
          await this.log('warn', 'El servidor fue restaurado desde una copia: se volvieron a descargar los datos.');
          since = 0;
          continue;
        }
      }
      await this.repo.db.transaction('rw', [...ORDER.map((n) => this.repo.db.table(n)), this.repo.db.outbox, this.repo.db.conflicts], async () => {
        for (const entity of ORDER) for (const row of res.rows[entity] ?? []) { if (await this.mergeServerRow(entity as EntityName, row)) report.pulled++; }
        if (since === 0 && page === 0) await this.dropSeedPlaceholders(res.rows.profiles ?? []);
      });
      since = Math.max(since, res.maxRev ?? since);
      await this.repo.db.setKV('lastRev', since);
      if (!res.hasMore) {
        if (res.idsEpoch !== undefined) await this.reconcileDeletions(t, res.idsEpoch, report);
        break;
      }
    }
  }

  /**
   * Si en una planilla se borraron filas a mano, el servidor cambia idsEpoch: se comparan IDs y se quitan de este
   * dispositivo los registros ya sincronizados que no existen más. Límite de seguridad: si desaparece demasiado de golpe
   * (por ejemplo, se vació una pestaña por error), NO se aplica y se avisa para restaurar desde una copia.
   */
  private async reconcileDeletions(t: Transport, epoch: string, report: SyncReport) {
    const known = await this.repo.db.getKV<string | undefined>('idsEpoch', undefined);
    if (known === epoch) return;
    if (known === undefined || !epoch) { await this.repo.db.setKV('idsEpoch', epoch); return; }
    const res = await t.call<{ ids: Record<string, string[]>; idsEpoch: string }>('ids');
    const db = this.repo.db;
    const pending = new Set((await db.outbox.toArray()).map((o) => `${o.entity}/${o.recordId}`));
    for (const entity of ORDER) {
      const serverIds = new Set(res.ids[entity] ?? []);
      const local = (await db.table(entity).toArray()).filter((r: any) => r.version > 0 && !r.deleted && !pending.has(`${entity}/${r.id}`));
      const gone = local.filter((r: any) => !serverIds.has(r.id));
      if (!gone.length) continue;
      if (gone.length > 5 && gone.length > local.length * 0.2) {
        report.errors.push(`En la planilla desaparecieron ${gone.length} registros de "${entity}" de golpe. No se borraron en la app: revisá la planilla o restaurá una copia.`);
        await this.log('warn', `Borrado masivo en la planilla no aplicado (${entity}: ${gone.length})`);
        continue;
      }
      for (const r of gone) await db.table(entity).put({ ...r, deleted: true, _sync: 'synced' });
      report.pulled += gone.length;
      await this.log('info', `Se quitaron ${gone.length} registro(s) de ${entity} borrados en la planilla.`);
    }
    await db.setKV('idsEpoch', res.idsEpoch);
  }

  /**
   * Primera descarga de un dispositivo nuevo: si la familia ya tiene perfiles en la planilla, se descartan los perfiles
   * genéricos de la inicialización (Papá, Mamá…) que nunca se enviaron, para no duplicar personas.
   */
  private async dropSeedPlaceholders(serverProfiles: any[]) {
    if (!serverProfiles.some((p) => p.role === 'adult' && !p.deleted)) return;
    const serverIds = new Set(serverProfiles.map((p) => p.id));
    const { db } = this.repo;
    for (const local of await db.table('profiles').toArray()) {
      if (serverIds.has(local.id)) continue;
      const ops = await db.outbox.where('[entity+recordId]').equals(['profiles', local.id]).toArray();
      if (!ops.length || !ops.every((o) => o.seed && o.attempts === 0)) continue;
      await db.outbox.bulkDelete(ops.map((o) => o.opId));
      await db.table('profiles').delete(local.id);
    }
  }

  private async mergeServerRow(entity: EntityName, rawRow: any): Promise<boolean> {
    const row = normalizeRecord(entity, rawRow);
    const table = this.repo.db.table(entity);
    const local = await table.get(row.id);
    const ops = await this.repo.db.outbox.where('[entity+recordId]').equals([entity, row.id]).toArray();
    if (ops.length === 0) {
      if (local && (local.version ?? 0) > (row.version ?? 0)) return false;
      await table.put({ ...row, _sync: 'synced' });
      return true;
    }
    if (ops.every((o) => o.seed && o.attempts === 0)) { // inicialización duplicada en dos dispositivos: gana el servidor
      await this.repo.db.outbox.bulkDelete(ops.map((o) => o.opId));
      await table.put({ ...row, _sync: 'synced' });
      return true;
    }
    return false; // hay cambios locales pendientes: el push detectará y resolverá el conflicto
  }

  // ---------- Push ----------
  private async push(t: Transport, report: SyncReport) {
    for (let round = 0; round < 100; round++) {
      const now = Date.now();
      const ops = (await this.repo.db.outbox.toArray())
        .filter((o) => (o.status === 'pending' || o.status === 'error' || o.status === 'sending') && (!o.nextAttemptAt || o.nextAttemptAt <= now))
        .sort((a, b) => ORDER.indexOf(a.entity) - ORDER.indexOf(b.entity) || (a.createdAt < b.createdAt ? -1 : 1));
      if (!ops.length) return;
      const batch: OutboxOp[] = [];
      const seen = new Set<string>();
      let bytes = 0;
      for (const o of ops) {
        const key = `${o.entity}/${o.recordId}`;
        if (seen.has(key)) continue; // una sola operación por registro en cada lote (encadenamiento de versiones)
        const size = JSON.stringify(o.payload).length;
        if (batch.length && (batch.length >= BATCH_SIZE || bytes + size > MAX_BATCH_BYTES)) break;
        seen.add(key); batch.push(o); bytes += size;
      }
      for (const o of batch) await this.repo.db.outbox.update(o.opId, { status: 'sending', attempts: o.attempts + 1, updatedAt: nowISO() });

      let results: any[];
      try {
        const res = await t.call<{ results: any[] }>('push', {
          deviceId: this.repo.deviceId,
          ops: batch.map((o) => ({ opId: o.opId, entity: o.entity, recordId: o.recordId, baseVersion: o.baseVersion, force: !!o.force, record: o.payload })),
        });
        results = res.results;
      } catch (e: any) {
        // El servidor pudo haber aplicado el lote antes del corte: al reintentar con los mismos opId no se duplica.
        for (const o of batch) {
          await this.repo.db.outbox.update(o.opId, { status: 'error', lastError: e.message, nextAttemptAt: Date.now() + backoff(o.attempts + 1) });
        }
        if (!isRetryable(e) || (e instanceof BackendError && e.code === 'network')) throw e;
        report.errors.push(e.message);
        return;
      }
      let progressed = false;
      for (const r of results) {
        const op = batch.find((o) => o.opId === r.opId);
        if (!op) continue;
        if (r.status === 'applied' || r.status === 'duplicate') {
          await this.applyAck(op, r.record);
          if (r.status === 'duplicate') report.duplicates++; else report.pushed++;
          progressed = true;
        } else if (r.status === 'conflict') {
          const outcome = await this.handleConflict(op, r.record);
          if (outcome === 'merged' || outcome === 'accepted') { report.autoMerged++; progressed = true; } else report.conflicts++;
        } else {
          await this.repo.db.outbox.update(op.opId, { status: 'error', lastError: r.error ?? 'Error', nextAttemptAt: Date.now() + backoff(op.attempts + 1) });
          report.errors.push(`${op.entity}: ${r.error}`);
        }
      }
      if (!progressed) return;
    }
  }

  private async applyAck(op: OutboxOp, server: any) {
    const db = this.repo.db;
    await db.transaction('rw', [db.table(op.entity), db.outbox], async () => {
      await db.outbox.delete(op.opId);
      const rest = await db.outbox.where('[entity+recordId]').equals([op.entity, op.recordId]).toArray();
      for (const o of rest) await db.outbox.update(o.opId, { baseVersion: server.version, base: server });
      const table = db.table(op.entity);
      if (rest.length === 0) await table.put({ ...server, _sync: 'synced' });
      else {
        const local = await table.get(op.recordId);
        if (local) await table.put({ ...local, version: server.version, rev: server.rev });
      }
    });
  }

  private async handleConflict(op: OutboxOp, server: any): Promise<'merged' | 'accepted' | 'conflict'> {
    const db = this.repo.db;
    const local = op.payload;
    const diff = diffWithDeleted(server, local);
    if (Object.keys(diff).length === 0 || op.seed) { // mismo contenido (p. ej. ocurrencia generada en dos dispositivos)
      await this.applyAck(op, server);
      return 'accepted';
    }
    if (op.base) {
      const localChanged = Object.keys(diffWithDeleted(op.base, local));
      const remoteChanged = new Set(Object.keys(diffWithDeleted(op.base, server)));
      if (localChanged.every((k) => !remoteChanged.has(k))) {
        const merged: any = { ...server };
        for (const k of localChanged) merged[k] = local[k];
        merged.updatedAt = nowISO();
        await db.transaction('rw', [db.table(op.entity), db.outbox], async () => {
          await db.outbox.update(op.opId, { payload: stripLocal(merged), baseVersion: server.version, base: server, status: 'pending', nextAttemptAt: 0 });
          await db.table(op.entity).put({ ...merged, _sync: 'pending' });
        });
        await this.log('info', `Fusión automática en ${op.entity}`, `Campos locales: ${localChanged.join(', ')} · remotos: ${[...remoteChanged].join(', ')}`);
        return 'merged';
      }
    }
    const conflict: Conflict = {
      id: uuid(), entity: op.entity, recordId: op.recordId, local, server, fields: Object.keys(diff), detectedAt: nowISO(), source: 'sync',
    };
    await db.transaction('rw', [db.table(op.entity), db.outbox, db.conflicts], async () => {
      const old = await db.conflicts.where('recordId').equals(op.recordId).filter((c) => !c.resolved).toArray();
      for (const c of old) await db.conflicts.update(c.id, { resolved: true, resolution: 'reemplazado' });
      await db.conflicts.put(conflict);
      await db.outbox.update(op.opId, { status: 'conflict', lastError: 'Conflicto: el registro cambió en otro dispositivo' });
      const row = await db.table(op.entity).get(op.recordId);
      if (row) await db.table(op.entity).put({ ...row, _sync: 'conflict' });
    });
    return 'conflict';
  }

  /** Resolución elegida por la persona: conservar lo local, aceptar lo del servidor o una fusión campo a campo. */
  async resolveConflict(conflictId: string, choice: 'local' | 'server' | { merged: any }, by?: string) {
    const db = this.repo.db;
    const c = await db.conflicts.get(conflictId);
    if (!c || c.resolved) return;
    const op = (await db.outbox.where('[entity+recordId]').equals([c.entity, c.recordId]).toArray()).find((o) => o.status === 'conflict');
    await db.transaction('rw', [db.table(c.entity), db.outbox, db.conflicts, db.table('history')], async () => {
      if (choice === 'server') {
        if (op) await db.outbox.delete(op.opId);
        await db.table(c.entity).put({ ...c.server, _sync: 'synced' });
      } else {
        const rec = choice === 'local' ? c.local : { ...c.server, ...choice.merged };
        const payload = { ...stripLocal(rec), updatedAt: nowISO(), version: c.server.version };
        if (op) await db.outbox.update(op.opId, { payload, baseVersion: c.server.version, base: c.server, status: 'pending', nextAttemptAt: 0 });
        else await db.outbox.put({ opId: uuid(), entity: c.entity, recordId: c.recordId, type: 'upsert', payload, baseVersion: c.server.version, base: c.server, status: 'pending', attempts: 0, createdAt: nowISO(), updatedAt: nowISO() });
        await db.table(c.entity).put({ ...payload, _sync: 'pending' });
      }
      const resolution = choice === 'server' ? 'se aceptó la versión de Google' : choice === 'local' ? 'se mantuvo la versión de este dispositivo' : 'fusión manual';
      await db.conflicts.update(conflictId, { resolved: true, resolution });
      await db.table('history').put({
        id: uuid(), version: 0, createdAt: nowISO(), updatedAt: nowISO(), deleted: false, origin: 'sistema', entity: c.entity, recordId: c.recordId,
        action: 'conflicto', at: nowISO(), by, changes: { resolucion: ['', resolution] }, _sync: 'local',
      });
    });
    this.emit();
  }

  /** Borra de la caché local los registros ya sincronizados (conserva los cambios pendientes) y reinicia el cursor. */
  private async clearSynced() {
    const db = this.repo.db;
    await db.transaction('rw', [...ORDER.map((n) => db.table(n)), db.outbox], async () => {
      const pendingIds = new Set((await db.outbox.toArray()).map((o) => `${o.entity}/${o.recordId}`));
      for (const entity of ORDER) {
        const keys = (await db.table(entity).toArray()).filter((r: any) => !pendingIds.has(`${entity}/${r.id}`)).map((r: any) => r.id);
        await db.table(entity).bulkDelete(keys);
      }
    });
    await db.setKV('lastRev', 0);
  }

  /** Resincronización completa: vuelve a descargar todo desde Google sin perder cambios pendientes. */
  async fullResync(): Promise<SyncReport> {
    await this.clearSynced();
    return this.syncNow();
  }

  /** Vuelve a intentar las operaciones con error (botón "Reintentar"). */
  async retryErrors() {
    const ops = await this.repo.db.outbox.filter((o) => o.status === 'error' || o.status === 'sending').toArray();
    for (const o of ops) await this.repo.db.outbox.update(o.opId, { status: 'pending', nextAttemptAt: 0 });
    const atts = (await this.repo.db.entity('attachments').toArray()).filter((a) => a.uploadStatus === 'error');
    for (const a of atts) await this.repo.db.entity('attachments').update(a.id, { uploadStatus: 'pending' });
    return this.syncNow();
  }

  /** Descarta una operación pendiente (por ejemplo, un registro inválido que el servidor rechaza). */
  async discardOp(opId: string) {
    await this.repo.db.outbox.delete(opId);
    this.emit();
  }
}

function diffWithDeleted(a: any, b: any) {
  const d = businessDiff(a, b);
  if (!!a?.deleted !== !!b?.deleted) d.deleted = [!!a?.deleted, !!b?.deleted];
  return d;
}

function backoff(attempt: number) { return Math.min(10 * 60_000, 5_000 * 2 ** Math.min(attempt, 7)); }
