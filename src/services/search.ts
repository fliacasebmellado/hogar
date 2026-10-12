// Búsqueda global sobre todas las entidades visibles para el perfil actual.
import type { Repo } from '../db/repo';
import type { Profile } from '../domain/types';
import { can, canSeeDocument, type PermissionMatrix } from '../domain/permissions';
import { norm } from './tasks';
import { ENTITY_LABEL } from '../domain/catalog';

export interface SearchHit { entity: string; id: string; title: string; subtitle?: string; link: string }

const LINK: Record<string, (r: any) => string> = {
  tasks: (r) => `/tareas?id=${r.id}`, events: (r) => `/agenda?id=${r.id}`, shoppingItems: (r) => `/compras?lista=${r.listId}`,
  payments: (r) => `/economia?pago=${r.id}`, expenses: (r) => `/economia?gasto=${r.id}`, documents: (r) => `/documentos?id=${r.id}`,
  repairs: (r) => `/casa?reparacion=${r.id}`, assets: (r) => `/casa?elemento=${r.id}`, rooms: (r) => `/casa?ambiente=${r.id}`,
  providers: () => `/casa?tab=proveedores`, investments: (r) => `/inversiones?id=${r.id}`, investmentTaxes: (r) => `/inversiones?id=${r.investmentId}`, investmentContracts: (r) => `/inversiones?id=${r.investmentId}`, notes: (r) => `/asistente?nota=${r.id}`, maintenance: () => `/casa?tab=mantenimiento`,
};
const TITLE: Record<string, (r: any) => string> = {
  tasks: (r) => r.title, events: (r) => r.title, shoppingItems: (r) => r.name, payments: (r) => r.concept, expenses: (r) => r.concept,
  documents: (r) => r.name, repairs: (r) => r.title, assets: (r) => r.name, rooms: (r) => r.name, providers: (r) => r.name,
  notes: (r) => r.title, maintenance: (r) => r.title, investments: (r) => r.name, investmentTaxes: (r) => r.tax, investmentContracts: (r) => `Contrato de ${r.kind}${r.counterpart ? ` · ${r.counterpart}` : ''}`,
};
const TEXT: Record<string, (r: any) => string> = {
  tasks: (r) => `${r.title} ${r.description ?? ''} ${r.notes ?? ''}`, events: (r) => `${r.title} ${r.description ?? ''} ${r.location ?? ''}`,
  shoppingItems: (r) => `${r.name} ${r.notes ?? ''}`, payments: (r) => `${r.concept} ${r.provider ?? ''} ${r.notes ?? ''}`,
  expenses: (r) => `${r.concept} ${r.notes ?? ''}`, documents: (r) => `${r.name} ${r.description ?? ''} ${(r.tags ?? []).join(' ')} ${r.extractedText ?? ''}`,
  repairs: (r) => `${r.title} ${r.description ?? ''}`, assets: (r) => `${r.name} ${r.brand ?? ''} ${r.model ?? ''}`, rooms: (r) => r.name,
  providers: (r) => `${r.name} ${r.trade ?? ''}`, notes: (r) => `${r.title} ${r.body ?? ''}`, maintenance: (r) => r.title,
  investments: (r) => `${r.name} ${r.address ?? ''} ${r.notes ?? ''}`, investmentTaxes: (r) => `${r.tax} ${r.period ?? ''} ${r.accountNumber ?? ''}`, investmentContracts: (r) => `${r.kind} ${r.counterpart ?? ''}`,
};

export async function globalSearch(repo: Repo, query: string, profile: Profile | undefined, matrix?: PermissionMatrix, limit = 40): Promise<SearchHit[]> {
  const q = norm(query);
  if (q.length < 2) return [];
  const terms = q.split(' ');
  const hits: SearchHit[] = [];
  for (const entity of Object.keys(TITLE)) {
    if ((entity === 'payments' || entity === 'expenses' || entity.startsWith('investment')) && !can(profile, 'finance.view', matrix)) continue;
    const rows = await repo.list(entity as any);
    for (const r of rows as any[]) {
      if (r.isSeries) continue;
      if (entity === 'documents' && !canSeeDocument(profile, r, matrix)) continue;
      const text = norm(TEXT[entity](r));
      if (terms.every((t) => text.includes(t))) {
        hits.push({ entity, id: r.id, title: TITLE[entity](r), subtitle: ENTITY_LABEL[entity], link: LINK[entity](r) });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}
