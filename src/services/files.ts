// Archivos: el binario original se guarda en IndexedDB (tabla local `files`) y sus metadatos en `attachments`
// (entidad sincronizada). La subida a Drive la hace el motor de sincronización. Nunca se modifica el original.
import type { Repo } from '../db/repo';
import type { Attachment, ID } from '../domain/types';
import { sha256Hex } from '../domain/ids';
import { checkFile, guessMime } from '../domain/validation';
import { nowISO } from '../domain/dates';

/** Clave de carpeta de Drive (ver services/folders.ts). */
export type DriveFolder = string;

export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof (blob as any).arrayBuffer === 'function') return (blob as any).arrayBuffer();
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as ArrayBuffer);
    fr.onerror = () => rej(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

/** Guarda un archivo. Si ya existe uno idéntico (mismo hash), reutiliza el adjunto existente (sin duplicar). */
export async function storeFile(repo: Repo, blob: Blob, name: string, folder: DriveFolder, by?: ID): Promise<{ attachment: Attachment; reused: boolean }> {
  const mimeType = guessMime(name, blob.type);
  const err = checkFile(name, mimeType, blob.size);
  if (err) throw new Error(err);
  const buf = await blobToArrayBuffer(blob);
  const hash = await sha256Hex(buf);
  const existing = (await repo.db.entity('attachments').where('hash').equals(hash).toArray()).find((a) => !a.deleted);
  if (existing) {
    if (!(await repo.db.files.get(existing.id))) await repo.db.files.put({ id: existing.id, blob, storedAt: nowISO() });
    return { attachment: existing, reused: true };
  }
  return repo.tx(async () => {
    const attachment = await repo.create('attachments', { name, mimeType, size: blob.size, hash, folder, uploadStatus: 'pending' }, { by });
    await repo.db.files.put({ id: attachment.id, blob: new Blob([buf], { type: mimeType }), storedAt: nowISO() });
    return { attachment, reused: false };
  });
}

export async function getLocalFile(repo: Repo, attachmentId: ID): Promise<Blob | undefined> {
  return (await repo.db.files.get(attachmentId))?.blob;
}

export function humanSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blobToArrayBuffer(blob));
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) s += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(s);
}
export function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
