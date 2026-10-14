// Listas de compras compartidas, control de duplicados y fusión de productos equivalentes.
import type { Repo } from '../db/repo';
import type { Expense, ID, ShoppingItem, ShoppingList } from '../domain/types';
import { norm } from './tasks';
import { createExpense } from './money';
import { today } from '../domain/dates';

export const DEFAULT_LIST_ID = 'list-principal';

/** Singular aproximado: "leches"→"leche", "panes"→"pan", "limones"→"limon", "yogures"→"yogur". */
function singular(w: string): string {
  let s = w;
  if (s.length > 3 && s.endsWith('s')) s = s.slice(0, -1);
  if (s.length > 3 && /[nlrdj]e$/.test(s)) s = s.slice(0, -1);
  return s;
}

/** Normaliza un nombre de producto para comparar ("Leches" ≈ "leche", "Papel higiénico" ≈ "papel higienico"). */
export function productKey(name: string): string {
  return norm(name)
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .split(' ')
    .filter((w) => w && !['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'x'].includes(w))
    .map(singular)
    .join(' ')
    .trim();
}

export function findDuplicateItem(items: ShoppingItem[], listId: ID, name: string): ShoppingItem | undefined {
  const key = productKey(name);
  return items.find((i) => !i.deleted && i.listId === listId && i.status === 'pendiente' && !i.mergedInto && productKey(i.name) === key);
}

export type ItemInput = Partial<ShoppingItem> & { name: string; listId: ID };

/** Agrega un producto. Si ya hay uno equivalente pendiente en la lista, devuelve `duplicate` sin crear nada. */
/** "Comprar bananas" → "Bananas": se saca el verbo del principio y se pone mayúscula. */
export function cleanItemName(s: string): string {
  const t = s.trim().replace(/^(comprar|compra|comprame|traer|conseguir|hay que comprar|falta|faltan)\s+/i, '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/**
 * Compras usa UNA sola lista agrupada por rubro. Esto deja todo así:
 * - Las listas sueltas que se hayan creado (no las "habituales") se pasan a la lista principal: sus productos se mueven
 *   (si la lista se llamaba como un rubro, p. ej. "Farmacia", los productos quedan en ese rubro) y la lista se marca como
 *   eliminada (queda en el historial y en la planilla; no se pierde nada).
 * - Una sola vez por dispositivo: productos pendientes que quedaron en "Supermercado" pero son de otro rubro
 *   ("Codo 110" → Ferretería) y nombres que empiezan con "Comprar …".
 */
export async function tidyShopping(repo: Repo, guess: (name: string) => string, categories: { id: string; label: string }[], by?: ID) {
  const lists = await repo.list('shoppingLists');
  const extra = lists.filter((l) => !l.isTemplate && l.id !== DEFAULT_LIST_ID);
  const items = await repo.list('shoppingItems');
  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let changed = 0;
  if (extra.length && await repo.get('shoppingLists', DEFAULT_LIST_ID)) {
    await repo.tx(async () => {
      for (const l of extra) {
        const asCat = categories.find((c) => fold(c.label).split(/[\s/]+/).some((w) => w.length > 3 && fold(l.name).includes(w)));
        for (const i of items.filter((x) => x.listId === l.id)) {
          await repo.update('shoppingItems', i.id, { listId: DEFAULT_LIST_ID, ...(asCat && (!i.category || i.category === 'supermercado') ? { category: asCat.id } : {}) }, { by });
          changed++;
        }
        await repo.remove('shoppingLists', l.id, { by });
        changed++;
      }
    });
  }
  if (!(await repo.db.getKV<boolean>('shoppingTidyV1', false)) && items.length) {
    await repo.tx(async () => {
      for (const i of items.filter((x) => x.status === 'pendiente' && !x.mergedInto)) {
        const name = cleanItemName(i.name);
        const g = guess(name);
        const patch: Partial<ShoppingItem> = {};
        if (name && name !== i.name) patch.name = name;
        if ((i.category ?? 'supermercado') === 'supermercado' && g !== 'supermercado' && categories.some((c) => c.id === g)) patch.category = g;
        if (Object.keys(patch).length) { await repo.update('shoppingItems', i.id, patch, { by }); changed++; }
      }
    });
    await repo.db.setKV('shoppingTidyV1', true);
  }
  return changed;
}

export async function addItem(repo: Repo, data: ItemInput, opts: { by?: ID; allowDuplicate?: boolean; origin?: any } = {}):
  Promise<{ item?: ShoppingItem; duplicate?: ShoppingItem }> {
  const all = await repo.list('shoppingItems');
  const dup = findDuplicateItem(all, data.listId, data.name);
  if (dup && !opts.allowDuplicate) return { duplicate: dup };
  const item = await repo.create('shoppingItems', {
    category: 'supermercado', priority: 'media', status: 'pendiente', ...data, name: data.name.trim(),
  }, { by: opts.by, origin: opts.origin });
  return { item };
}

/** Fusiona productos equivalentes en `keepId`. No borra información: notas se concatenan, cantidades se suman si la unidad coincide, y los fusionados quedan con mergedInto. */
export async function mergeItems(repo: Repo, keepId: ID, otherIds: ID[], by?: ID): Promise<ShoppingItem> {
  return repo.tx(async () => {
    const keep = await repo.get('shoppingItems', keepId);
    if (!keep) throw new Error('Producto inexistente');
    let quantity = keep.quantity;
    const notes: string[] = keep.notes ? [keep.notes] : [];
    const warnings: string[] = [];
    for (const id of otherIds) {
      const o = await repo.get('shoppingItems', id);
      if (!o || o.id === keepId) continue;
      if (o.quantity != null) {
        if ((o.unit ?? 'u') === (keep.unit ?? 'u')) quantity = (quantity ?? 1) + o.quantity;
        else warnings.push(`${o.quantity} ${o.unit ?? ''} de "${o.name}"`);
      }
      if (o.notes) notes.push(o.notes);
      await repo.update('shoppingItems', id, { mergedInto: keepId, deleted: true }, { by });
    }
    if (warnings.length) notes.push(`Fusionado (unidades distintas): ${warnings.join('; ')}`);
    return repo.update('shoppingItems', keepId, { quantity, notes: notes.join(' · ') || undefined }, { by });
  });
}

/** Marca productos como comprados. Si se indica importe, registra UN gasto vinculado; si no, no crea gasto. */
export async function markPurchased(repo: Repo, itemIds: ID[], opts: { by?: ID; amount?: number; category?: string; concept?: string; date?: string } = {}):
  Promise<{ items: ShoppingItem[]; expense?: Expense }> {
  return repo.tx(async () => {
    const items: ShoppingItem[] = [];
    for (const id of itemIds) items.push(await repo.update('shoppingItems', id, { status: 'comprado', purchasedAt: new Date().toISOString(), purchasedBy: opts.by }, { by: opts.by }));
    let expense: Expense | undefined;
    if (opts.amount != null && opts.amount > 0) {
      expense = await createExpense(repo, {
        amount: opts.amount, date: opts.date ?? today(), concept: opts.concept ?? (items.length === 1 ? items[0].name : `Compra (${items.length} productos)`),
        category: opts.category ?? (items[0]?.category === 'supermercado' ? 'supermercado' : 'otros'), shoppingItemIds: itemIds, responsibleId: opts.by,
      }, { by: opts.by });
      for (const id of itemIds) await repo.update('shoppingItems', id, { expenseId: expense.id }, { by: opts.by, skipHistory: true });
    }
    return { items, expense };
  });
}

export async function unmarkPurchased(repo: Repo, id: ID, by?: ID) {
  return repo.update('shoppingItems', id, { status: 'pendiente', purchasedAt: undefined, purchasedBy: undefined }, { by });
}

/** Reutiliza una lista habitual (plantilla): copia sus productos a la lista destino evitando duplicados. */
export async function applyTemplate(repo: Repo, templateId: ID, targetListId: ID, by?: ID): Promise<{ added: number; skipped: number }> {
  const items = (await repo.list('shoppingItems')).filter((i) => i.listId === templateId && !i.mergedInto);
  let added = 0, skipped = 0;
  for (const i of items) {
    const r = await addItem(repo, { listId: targetListId, name: i.name, quantity: i.quantity, unit: i.unit, category: i.category, priority: i.priority }, { by });
    if (r.item) added++; else skipped++;
  }
  return { added, skipped };
}

export async function saveAsTemplate(repo: Repo, listId: ID, name: string, by?: ID): Promise<ShoppingList> {
  return repo.tx(async () => {
    const tpl = await repo.create('shoppingLists', { name, isTemplate: true, archived: false }, { by });
    const items = (await repo.list('shoppingItems')).filter((i) => i.listId === listId && !i.mergedInto && i.status !== 'descartado');
    for (const i of items) await repo.create('shoppingItems', { listId: tpl.id, name: i.name, quantity: i.quantity, unit: i.unit, category: i.category, priority: i.priority, status: 'pendiente' }, { by });
    return tpl;
  });
}
