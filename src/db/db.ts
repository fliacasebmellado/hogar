// Base de datos local (IndexedDB vía Dexie). Es la caché de trabajo del dispositivo y la cola de sincronización.
// La fuente de verdad compartida entre dispositivos es Google Sheets (vía Apps Script) cuando está configurado.
import Dexie, { type Table } from 'dexie';
import type {
  Conflict, EntityMap, EntityName, LocalBackup, LocalFile, NotificationState, OutboxOp, SyncLogEntry,
} from '../domain/types';

export interface KV { key: string; value: any }

const BASE = 'id, updatedAt, deleted, _sync';
const STORES: Record<string, string> = {
  household: BASE,
  profiles: BASE,
  config: `${BASE}, key`,
  tasks: `${BASE}, assigneeId, dueDate, status, seriesId, isSeries`,
  events: `${BASE}, start, category`,
  shoppingLists: BASE,
  shoppingItems: `${BASE}, listId, status`,
  payments: `${BASE}, dueDate, status, seriesId`,
  expenses: `${BASE}, date, paymentId, category`,
  rooms: BASE,
  providers: BASE,
  assets: `${BASE}, roomId, category`,
  maintenance: BASE,
  repairs: `${BASE}, assetId, status`,
  documents: `${BASE}, category, attachmentId`,
  attachments: `${BASE}, hash, uploadStatus`,
  notes: BASE,
  captures: `${BASE}, status, createdAt, sourceRef`,
  history: `${BASE}, recordId, at`,
  investments: BASE,
  investmentContracts: `${BASE}, investmentId`,
  investmentTaxes: `${BASE}, investmentId, dueDate`,
  investmentWorks: `${BASE}, investmentId`,
  // solo locales
  outbox: 'opId, [entity+recordId], status, createdAt',
  conflicts: 'id, recordId, resolved',
  syncLog: '++id, at, level',
  files: 'id',
  notifState: 'key',
  localBackups: 'id, createdAt',
  kv: 'key',
};

export class HogarDB extends Dexie {
  outbox!: Table<OutboxOp, string>;
  conflicts!: Table<Conflict, string>;
  syncLog!: Table<SyncLogEntry, number>;
  files!: Table<LocalFile, string>;
  notifState!: Table<NotificationState, string>;
  localBackups!: Table<LocalBackup, string>;
  kv!: Table<KV, string>;

  constructor(name = 'hogar') {
    super(name);
    // v1: versión inicial. v2: inversiones (las tablas nuevas se agregan sin tocar los datos existentes).
    const { investments, investmentContracts, investmentTaxes, investmentWorks, ...v1 } = STORES;
    this.version(1).stores(v1);
    this.version(2).stores({ investments, investmentContracts, investmentTaxes, investmentWorks });
  }

  entity<E extends EntityName>(name: E): Table<EntityMap[E], string> {
    return this.table(name) as Table<EntityMap[E], string>;
  }

  async getKV<T = any>(key: string, fallback?: T): Promise<T> {
    const row = await this.kv.get(key);
    return (row ? row.value : fallback) as T;
  }
  async setKV(key: string, value: any) { await this.kv.put({ key, value }); }
}

export const LOCAL_TABLES = ['outbox', 'conflicts', 'syncLog', 'files', 'notifState', 'localBackups', 'kv'];
