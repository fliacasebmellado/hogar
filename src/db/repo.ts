// Repositorio: única puerta de escritura. Cada escritura valida, asigna metadatos, registra historial
// y encola la operación de sincronización en la misma transacción de IndexedDB (no hay pérdida silenciosa:
// si algo falla, la transacción entera se revierte y se informa el error).
import Dexie from 'dexie';
import { HogarDB } from './db';
import type { BaseRecord, EntityMap, EntityName, HistoryEntry, ID, Origin, OutboxOp } from '../domain/types';
import { ENTITY_NAMES } from '../domain/types';
import { uuid } from '../domain/ids';
import { nowISO } from '../domain/dates';
import { validateRecord, ValidationError } from '../domain/validation';

export interface WriteOpts { by?: ID; origin?: Origin; skipHistory?: boolean; historyAction?: HistoryEntry['action']; seed?: boolean; skipValidation?: boolean; force?: boolean }

const SYSTEM_KEYS = new Set(['id', 'rev', 'version', 'createdAt', 'updatedAt', 'deleted', 'updatedBy', 'deviceId', 'origin', 'demo', '_sync']);
// Entidades cuyo contenido no se copia al historial (texto potencialmente sensible).
const NO_DIFF_VALUES = new Set<EntityName>(['captures', 'documents', 'attachments']);

export function businessDiff(a: any, b: any): Record<string, [any, any]> {
  const out: Record<string, [any, any]> = {};
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) {
    if (SYSTEM_KEYS.has(k)) continue;
    const va = a?.[k], vb = b?.[k];
    if (normalize(va) !== normalize(vb)) out[k] = [va, vb];
  }
  return out;
}
const normalize = (v: any) => (v === undefined || v === null || v === '' ? '' : JSON.stringify(v));
export function stripLocal<T extends BaseRecord>(r: T): T {
  const { _sync, ...rest } = r as any;
  return rest as T;
}

export class Repo {
  constructor(public db: HogarDB, public deviceId: string) {}

  static async open(name = 'hogar'): Promise<Repo> {
    const db = new HogarDB(name);
    await db.open();
    let deviceId = await db.getKV<string>('deviceId');
    if (!deviceId) { deviceId = uuid(); await db.setKV('deviceId', deviceId); }
    return new Repo(db, deviceId);
  }

  private allTables() {
    return [...ENTITY_NAMES.map((n) => this.db.table(n)), this.db.outbox, this.db.files];
  }

  /** Ejecuta varias escrituras de forma atómica. */
  tx<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.transaction('rw', this.allTables(), fn);
  }

  get<E extends EntityName>(entity: E, id: ID): Promise<EntityMap[E] | undefined> {
    return this.db.entity(entity).get(id);
  }

  async list<E extends EntityName>(entity: E, includeDeleted = false): Promise<EntityMap[E][]> {
    const all = await this.db.entity(entity).toArray();
    return includeDeleted ? all : all.filter((r) => !r.deleted);
  }

  async create<E extends EntityName>(entity: E, data: Partial<EntityMap[E]>, opts: WriteOpts = {}): Promise<EntityMap[E]> {
    const now = nowISO();
    const record = {
      ...data,
      id: data.id ?? uuid(),
      version: 0,
      createdAt: data.createdAt ?? now,
      updatedAt: now,
      deleted: false,
      updatedBy: opts.by,
      deviceId: this.deviceId,
      origin: opts.origin ?? (data as any).origin ?? 'manual',
    } as EntityMap[E];
    return this.write(entity, record, null, { ...opts, historyAction: opts.historyAction ?? 'crear' });
  }

  async update<E extends EntityName>(entity: E, id: ID, patch: Partial<EntityMap[E]>, opts: WriteOpts = {}): Promise<EntityMap[E]> {
    return this.tx(async () => {
      const prev = await this.get(entity, id);
      if (!prev) throw new Error(`No existe ${entity}/${id}`);
      const next = { ...prev, ...patch, id, updatedAt: nowISO(), updatedBy: opts.by ?? prev.updatedBy, deviceId: this.deviceId } as EntityMap[E];
      return this.write(entity, next, prev, { ...opts, historyAction: opts.historyAction ?? 'editar' });
    });
  }

  /** Inserta o reemplaza un registro completo (usado por restauración y resolución de conflictos). */
  async put<E extends EntityName>(entity: E, record: EntityMap[E], opts: WriteOpts = {}): Promise<EntityMap[E]> {
    return this.tx(async () => {
      const prev = await this.get(entity, record.id);
      const next = { ...record, updatedAt: nowISO(), deviceId: this.deviceId } as EntityMap[E];
      return this.write(entity, next, prev ?? null, opts);
    });
  }

  /** Borrado lógico: el registro se conserva con deleted=true para poder sincronizar la eliminación. */
  async remove<E extends EntityName>(entity: E, id: ID, opts: WriteOpts = {}): Promise<void> {
    await this.tx(async () => {
      const prev = await this.get(entity, id);
      if (!prev || prev.deleted) return;
      const next = { ...prev, deleted: true, updatedAt: nowISO(), updatedBy: opts.by ?? prev.updatedBy, deviceId: this.deviceId } as EntityMap[E];
      await this.write(entity, next, prev, { ...opts, historyAction: 'eliminar', skipValidation: true });
    });
  }

  async restoreDeleted<E extends EntityName>(entity: E, id: ID, opts: WriteOpts = {}) {
    return this.update(entity, id, { deleted: false } as any, { ...opts, historyAction: 'restaurar' });
  }

  private async write<E extends EntityName>(entity: E, record: EntityMap[E], prev: EntityMap[E] | null, opts: WriteOpts): Promise<EntityMap[E]> {
    if (!opts.skipValidation && !record.deleted) {
      const errors = validateRecord(entity, record);
      if (errors.length) throw new ValidationError(errors);
    }
    return this.tx(async () => {
      const stored = { ...record, _sync: 'pending' } as EntityMap[E];
      await this.db.entity(entity).put(stored);
      await this.enqueue(entity, stripLocal(stored), prev ? stripLocal(prev) : null, !!opts.seed, !!opts.force);
      if (!opts.skipHistory && entity !== 'history') {
        const changes = prev ? businessDiff(prev, record) : null;
        if (prev && changes && Object.keys(changes).length === 0 && prev.deleted === record.deleted) return stored;
        const redacted = changes && NO_DIFF_VALUES.has(entity)
          ? Object.fromEntries(Object.keys(changes).map((k) => [k, ['…', '…'] as [any, any]]))
          : changes;
        const h: HistoryEntry = {
          id: uuid(), version: 0, createdAt: nowISO(), updatedAt: nowISO(), deleted: false, deviceId: this.deviceId, origin: 'sistema',
          entity, recordId: record.id, action: opts.historyAction ?? (prev ? 'editar' : 'crear'), at: nowISO(), by: opts.by, changes: redacted,
          _sync: 'pending',
        };
        await this.db.entity('history').put(h);
        await this.enqueue('history', stripLocal(h), null, false);
      }
      return stored;
    });
  }

  /** Encola (o fusiona con una operación aún no intentada) la escritura para sincronizar. */
  private async enqueue(entity: EntityName, payload: any, prev: any | null, seed: boolean, force = false) {
    const existing = await this.db.outbox.where('[entity+recordId]').equals([entity, payload.id]).toArray();
    const mergeable = existing.find((o) => o.status === 'pending' && o.attempts === 0);
    const now = nowISO();
    if (mergeable) {
      await this.db.outbox.put({ ...mergeable, payload, updatedAt: now, seed: seed && mergeable.seed, force: force || mergeable.force });
      return;
    }
    const pendingBefore = existing.length > 0;
    const op: OutboxOp = {
      opId: uuid(), entity, recordId: payload.id, type: 'upsert', payload,
      baseVersion: payload.version ?? 0, status: 'pending', attempts: 0, createdAt: now, updatedAt: now,
      base: pendingBefore ? undefined : prev, seed, force,
    };
    await this.db.outbox.put(op);
  }

  async pendingCount(): Promise<number> { return this.db.outbox.count(); }

  /** Elimina definitivamente los datos de demostración (no se sincronizan como borrado lógico porque nunca debieron ser reales). */
  async purgeDemo(): Promise<number> {
    let n = 0;
    await this.tx(async () => {
      for (const name of ENTITY_NAMES) {
        const rows = await this.db.table(name).filter((r: any) => r.demo === true && !r.deleted).toArray();
        for (const r of rows) {
          await this.write(name, { ...r, deleted: true, updatedAt: nowISO() }, r, { skipValidation: true, historyAction: 'eliminar' });
          n++;
        }
      }
    });
    return n;
  }
}

export { Dexie };
