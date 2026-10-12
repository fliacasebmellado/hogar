// Copias de seguridad locales y exportación/restauración en formato abierto (JSON).
// Formato: { format, schemaVersion, createdAt, deviceId, counts, checksum, data: {entidad: registros[]}, files? }
// La suma de verificación (SHA-256 de `data` serializado) detecta copias incompletas o alteradas.
import type { Repo } from '../db/repo';
import { ENTITY_NAMES, type EntityName, type LocalBackup } from '../domain/types';
import { sha256Hex, uuid } from '../domain/ids';
import { nowISO, today } from '../domain/dates';
import { base64ToBlob, blobToBase64 } from './files';
import schema from '../../shared/schema.json';

export const BACKUP_FORMAT = 'hogar-backup';
export interface BackupFile {
  format: string; schemaVersion: number; createdAt: string; deviceId: string; counts: Record<string, number>; checksum: string;
  data: Record<string, any[]>; files?: Record<string, { mime: string; base64: string }>; filesChecksum?: string;
}

export async function exportAll(repo: Repo, opts: { includeFiles?: boolean } = {}): Promise<BackupFile> {
  const data: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  for (const name of ENTITY_NAMES) {
    const rows = (await repo.db.table(name).toArray()).map(({ _sync, ...r }: any) => r);
    rows.sort((a: any, b: any) => (a.id < b.id ? -1 : 1));
    data[name] = rows;
    counts[name] = rows.length;
  }
  const backup: BackupFile = {
    format: BACKUP_FORMAT, schemaVersion: schema.schemaVersion, createdAt: nowISO(), deviceId: repo.deviceId, counts,
    checksum: await sha256Hex(JSON.stringify(data)), data,
  };
  if (opts.includeFiles) {
    backup.files = {};
    for (const f of await repo.db.files.toArray()) backup.files[f.id] = { mime: f.blob.type, base64: await blobToBase64(f.blob) };
    backup.filesChecksum = await sha256Hex(JSON.stringify(backup.files));
  }
  return backup;
}

export interface BackupValidation { ok: boolean; errors: string[]; counts: Record<string, number> }

export async function validateBackup(b: any): Promise<BackupValidation> {
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  if (!b || typeof b !== 'object') return { ok: false, errors: ['El archivo no es una copia válida.'], counts };
  if (b.format !== BACKUP_FORMAT) errors.push('Formato desconocido (no es una copia de Hogar).');
  if (typeof b.schemaVersion !== 'number' || b.schemaVersion > schema.schemaVersion) errors.push(`Versión de esquema incompatible (${b.schemaVersion}). Actualizá la app antes de restaurar.`);
  if (!b.data || typeof b.data !== 'object') errors.push('Faltan los datos.');
  else {
    for (const name of ENTITY_NAMES) {
      const rows = b.data[name];
      if (!Array.isArray(rows)) { errors.push(`Falta la colección "${name}" (copia incompleta).`); continue; }
      counts[name] = rows.length;
      if (b.counts?.[name] !== rows.length) errors.push(`"${name}": se esperaban ${b.counts?.[name]} registros y hay ${rows.length} (copia incompleta).`);
      const bad = rows.filter((r: any) => !r || typeof r.id !== 'string');
      if (bad.length) errors.push(`"${name}": ${bad.length} registro(s) sin identificador.`);
    }
    if (!errors.length) {
      const sum = await sha256Hex(JSON.stringify(b.data));
      if (sum !== b.checksum) errors.push('La suma de verificación no coincide: la copia está dañada o fue modificada.');
    }
    if (b.files && b.filesChecksum && (await sha256Hex(JSON.stringify(b.files))) !== b.filesChecksum) errors.push('Los archivos incluidos están dañados.');
  }
  return { ok: errors.length === 0, errors, counts };
}

/** Guarda una copia local de seguridad (antes de restaurar, o una vez por día). Conserva las últimas `keep`. */
export async function saveLocalBackup(repo: Repo, reason: string, keep = 5): Promise<LocalBackup> {
  const b = await exportAll(repo);
  const json = JSON.stringify(b);
  const entry: LocalBackup = { id: uuid(), createdAt: nowISO(), reason, size: json.length, checksum: b.checksum, data: json };
  await repo.db.localBackups.put(entry);
  const all = await repo.db.localBackups.orderBy('createdAt').toArray();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) await repo.db.localBackups.delete(old.id);
  return entry;
}

export async function dailyLocalBackup(repo: Repo): Promise<boolean> {
  const last = await repo.db.getKV<string>('lastLocalBackup');
  if (last === today()) return false;
  await saveLocalBackup(repo, 'Copia automática diaria', 7);
  await repo.db.setKV('lastLocalBackup', today());
  return true;
}

export interface RestoreResult { restored: number; files: number; safetyBackupId: string }

/**
 * Restaura registros desde una copia validada. Antes guarda una copia local de seguridad.
 * Los registros restaurados se encolan con `force` para que, al sincronizar, prevalezcan sobre el servidor
 * (el servidor conserva su propio historial de copias en Drive).
 */
export async function restoreBackup(repo: Repo, b: BackupFile, by?: string): Promise<RestoreResult> {
  const v = await validateBackup(b);
  if (!v.ok) throw new Error('No se restauró nada: ' + v.errors.join(' '));
  const safety = await saveLocalBackup(repo, 'Antes de restaurar');
  let restored = 0;
  await repo.tx(async () => {
    for (const name of ENTITY_NAMES) {
      for (const r of b.data[name]) {
        const current = await repo.get(name as EntityName, r.id);
        const rec = { ...r, version: current?.version ?? r.version ?? 0 };
        await repo.put(name as EntityName, rec, { by, force: true, skipValidation: true, historyAction: 'restaurar', skipHistory: name === 'history' });
        restored++;
      }
    }
  });
  let files = 0;
  if (b.files) {
    for (const [id, f] of Object.entries(b.files)) {
      await repo.db.files.put({ id, blob: base64ToBlob(f.base64, f.mime), storedAt: nowISO() });
      files++;
    }
  }
  return { restored, files, safetyBackupId: safety.id };
}

export function downloadJSON(obj: any, filename: string) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  downloadBlob(blob, filename);
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
