// A qué carpeta de Drive va cada archivo. Las claves las resuelve el backend (apps-script/Drive.gs):
//   documentos/<Persona>  ·  peques/<Nombre>  ·  gastos/<AAAA-MM>  ·  casa/<Subcarpeta>  ·  inversion/<id>/<Subcarpeta>  ·  app/<Capturas|Audios>
import type { DocumentRecord, Profile } from '../domain/types';
import { today } from '../domain/dates';

export type FolderKey = string;

const INVESTMENT_SUB: Record<string, string> = { contratos: 'Contratos', impuestos: 'Impuestos', facturas: 'Impuestos', comprobantes: 'Impuestos' };

export function documentFolder(doc: Pick<DocumentRecord, 'category' | 'personId' | 'relatedType' | 'relatedId' | 'date'>, profiles: Profile[]): FolderKey {
  if (doc.relatedType === 'investments' && doc.relatedId) return `inversion/${doc.relatedId}/${INVESTMENT_SUB[doc.category] ?? 'Otros'}`;
  if (doc.relatedType === 'repairs' || doc.relatedType === 'assets') return doc.category === 'manuales' || doc.category === 'garantias' ? 'casa/Manuales y garantías' : 'casa/Reparaciones';
  const person = profiles.find((p) => p.id === doc.personId && p.role !== 'family');
  if (person?.role === 'child') return `peques/${person.name}`;
  if (['facturas', 'comprobantes', 'servicios'].includes(doc.category)) return `gastos/${(doc.date ?? today()).slice(0, 7)}`;
  if (doc.category === 'manuales' || doc.category === 'garantias') return 'casa/Manuales y garantías';
  if (person) return `documentos/${person.name}`;
  return 'documentos/Familia';
}

export const captureFolder = (mime: string): FolderKey => (mime.startsWith('audio/') ? 'app/Audios' : 'app/Capturas');

/** Texto para mostrar dónde quedó un archivo. */
export function folderLabel(key: string, investmentName?: (id: string) => string | undefined): string {
  const [root, a, b] = key.split('/');
  switch (root) {
    case 'documentos': return `Documentos / ${a ?? 'Familia'}`;
    case 'peques': return `Peques / ${a}`;
    case 'gastos': return `Gastos Mensuales casa / Comprobantes / ${a}`;
    case 'casa': return `Reforma, mantenimiento casa / ${a}`;
    case 'inversion': return `Inversiones / ${investmentName?.(a) ?? 'inversión'} / ${b}`;
    case 'app': return `Hogar App / ${a}`;
    default: return key;
  }
}
