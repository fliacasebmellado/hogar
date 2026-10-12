// Archivo central de documentos. Conserva siempre el archivo original; la extracción de texto es opcional y local.
import type { Repo } from '../db/repo';
import type { DocumentRecord, ID, Profile } from '../domain/types';
import { SENSITIVE_DOC_CATEGORIES } from '../domain/catalog';
import { canSeeDocument, type PermissionMatrix } from '../domain/permissions';
import { storeFile } from './files';
import { norm } from './tasks';
import { today } from '../domain/dates';
import { documentFolder } from './folders';

/** Si cambian la categoría, la persona o la relación de un documento, su archivo se mueve a la carpeta que corresponde. */
export async function relocateDocumentFile(repo: Repo, docId: ID, by?: ID) {
  const doc = await repo.get('documents', docId);
  if (!doc?.attachmentId) return;
  const att = await repo.get('attachments', doc.attachmentId);
  if (!att) return;
  const folder = documentFolder(doc, await repo.list('profiles'));
  if (att.folder !== folder) await repo.update('attachments', att.id, { folder }, { by, skipHistory: true });
}

export interface AddDocumentInput extends Partial<DocumentRecord> { name: string; category: string; file?: Blob; fileName?: string }

export async function addDocument(repo: Repo, input: AddDocumentInput, by?: ID): Promise<DocumentRecord> {
  const { file, fileName, ...meta } = input;
  let attachmentId = meta.attachmentId;
  let mimeType = meta.mimeType;
  if (file) {
    const folder = documentFolder({ date: today(), ...meta }, await repo.list('profiles'));
    const { attachment } = await storeFile(repo, file, fileName ?? meta.name, folder, by);
    attachmentId = attachment.id;
    mimeType = attachment.mimeType;
  }
  return repo.create('documents', {
    date: today(), tags: [], ownerId: by,
    visibility: meta.visibility ?? (SENSITIVE_DOC_CATEGORIES.includes(meta.category) ? 'adultos' : 'familia'),
    ...meta, attachmentId, mimeType,
  }, { by });
}

export function searchDocuments(docs: DocumentRecord[], profile: Profile | undefined, q: { text?: string; category?: string; personId?: string }, matrix?: PermissionMatrix) {
  const text = q.text ? norm(q.text) : '';
  return docs
    .filter((d) => !d.deleted && canSeeDocument(profile, d, matrix))
    .filter((d) => !q.category || d.category === q.category)
    .filter((d) => !q.personId || d.personId === q.personId)
    .filter((d) => !text || norm([d.name, d.description, (d.tags ?? []).join(' '), d.extractedText ?? ''].join(' ')).includes(text))
    .sort((a, b) => ((b.date ?? '') > (a.date ?? '') ? 1 : -1));
}

/** Extrae texto de un PDF (si tiene capa de texto) usando pdf.js localmente en el navegador. */
export async function extractPdfText(blob: Blob, maxPages = 15): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((it: any) => ('str' in it ? it.str : '')).join(' '));
  }
  return parts.join('\n').replace(/[ \t]+/g, ' ').trim();
}
