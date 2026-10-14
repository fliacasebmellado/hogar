import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, ShoppingCart, Merge, Copy, Receipt } from 'lucide-react';
import { useApp, useLive } from '../../app/context';
import type { ShoppingItem, ShoppingList } from '../../domain/types';
import { addItem, applyTemplate, DEFAULT_LIST_ID, markPurchased, mergeItems, productKey, saveAsTemplate, unmarkPurchased } from '../../services/shopping';
import { Avatar, CategoryChip, CheckButton, Empty, StatusChip, SyncMark, Banner } from '../../ui/components';
import { Sheet } from '../../ui/Sheet';
import { CategorySelect, NumberField, PersonSelect, SelectField, TextArea, TextField, DateField } from '../../ui/fields';
import { HistoryList } from '../../ui/records';
import { PRIORITY_LABEL, UNITS } from '../../domain/catalog';
import { today } from '../../domain/dates';
import { norm } from '../../services/tasks';
import { AskSheet } from './AskSheet';
import { guessShopCategory } from '../../ai/rules';
import { cleanItemName, tidyShopping } from '../../services/shopping';
import { RubrosSheet, rubroIcon } from './RubrosSheet';
import { Pencil } from 'lucide-react';
import type { Category } from '../../domain/catalog';
import { ChevronDown } from 'lucide-react';
import { categoryIcon, tones } from '../../ui/theme';

function RequestedBy({ id }: { id: string }) {
  const { profiles } = useApp();
  const p = profiles.find((x) => x.id === id);
  if (!p) return null;
  return <span className="requested" style={{ background: tones(p.color).soft }}><Avatar profile={p} /> Pidió {p.name}</span>;
}

export default function Shopping() {
  const { repo, profile, profiles, categories, run, toast, can, backend } = useApp();
  const [params] = useSearchParams();
  const lists = useLive((r) => r.list('shoppingLists'), [], [] as ShoppingList[]);
  const items = useLive((r) => r.list('shoppingItems'), [], [] as ShoppingItem[]);
  const [listId, setListId] = useState(params.get('lista') ?? DEFAULT_LIST_ID);
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [purchaseFor, setPurchaseFor] = useState<ShoppingItem[] | null>(null);
  const [listSheet, setListSheet] = useState<'new' | 'templates' | 'rename' | null>(null);
  const [showBought, setShowBought] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [rubroSheet, setRubroSheet] = useState<Category | null | undefined>(undefined); // undefined = cerrado, null = nuevo
  const [inlineName, setInlineName] = useState<Record<string, string>>({});
  useEffect(() => { const l = params.get('lista'); if (l) setListId(l); }, [params]);
  // Rubros desplegables: se recuerda cuáles quedaron abiertos en este dispositivo.
  const [open, setOpen] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('compras-abiertos') ?? '[]'); } catch { return []; } });
  const setOpenCat = (id: string, on: boolean) => setOpen((o) => { const n = on ? [...new Set([...o, id])] : o.filter((x) => x !== id); try { localStorage.setItem('compras-abiertos', JSON.stringify(n)); } catch { /* sin almacenamiento */ } return n; });
  useEffect(() => { if (profile?.role === 'adult') tidyShopping(repo, guessShopCategory, categories('shopping'), profile?.id).catch(() => {}); }, [lists.length, items.length > 0]);

  const active = lists.filter((l) => !l.isTemplate && !l.archived);
  const templates = lists.filter((l) => l.isTemplate && !l.archived);
  const list = lists.find((l) => l.id === listId) ?? active[0];
  const inList = items.filter((i) => i.listId === list?.id && !i.mergedInto);
  const pending = inList.filter((i) => i.status === 'pendiente' && (!q || norm(i.name).includes(norm(q))));
  const bought = inList.filter((i) => i.status === 'comprado').sort((a, b) => ((b.purchasedAt ?? '') > (a.purchasedAt ?? '') ? 1 : -1));
  const cats = categories('shopping');
  const grouped = useMemo(() => cats.map((c) => ({ c, items: pending.filter((i) => i.category === c.id) })).concat([{ c: { id: '_', label: 'Otras', color: '' }, items: pending.filter((i) => !cats.some((c) => c.id === i.category)) }]).filter((g) => g.items.length || (g.c.custom && !q)), [pending, cats, q]);
  const counts = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, inList.filter((i) => i.status === 'pendiente' && i.category === c.id).length])), [inList, cats]);
  const dupGroups = useMemo(() => {
    const m: Record<string, ShoppingItem[]> = {};
    for (const i of inList.filter((x) => x.status === 'pendiente')) (m[productKey(i.name)] ??= []).push(i);
    return Object.values(m).filter((g) => g.length > 1);
  }, [inList]);

  const add = async (allowDuplicate = false, forced?: string, inCategory?: string) => {
    const n = cleanItemName(forced ?? name);
    if (!n || !list) return;
    const r = await run(() => addItem(repo, { listId: list.id, name: n, category: inCategory ?? guessCat(n, cats), requestedBy: profile?.role === 'child' ? profile.id : undefined }, { by: profile?.id, allowDuplicate }));
    if (inCategory && r?.item) setInlineName((m) => ({ ...m, [inCategory]: '' }));
    if (r?.duplicate) toast(`"${r.duplicate.name}" ya está en la lista.`, { action: { label: 'Agregar igual', run: () => add(true, n, inCategory) } });
    else if (r?.item) { setName(''); setOpenCat(r.item.category ?? 'supermercado', true); toast(`${r.item.name} → ${cats.find((c) => c.id === r.item!.category)?.label ?? 'Otros'}`, { tone: 'ok' }); }
  };

  const toggle = async (i: ShoppingItem) => {
    if (i.status === 'comprado') { await run(() => unmarkPurchased(repo, i.id, profile?.id)); return; }
    await run(() => markPurchased(repo, [i.id], { by: profile?.id }));
    if (can('finance.edit')) toast(`${i.name}: comprado.`, { action: { label: 'Registrar gasto', run: () => setPurchaseFor([i]) } });
    else toast(`${i.name}: comprado.`, { tone: 'ok' });
  };

  if (!list) return <Empty icon={<ShoppingCart size={36} />} title="No hay listas." action={<button className="btn" onClick={() => setListSheet('new')}>Crear lista</button>} />;
  const noExpense = bought.filter((b) => !b.expenseId && (b.purchasedAt ?? '').slice(0, 10) === today());

  return (
    <div>
      <div className="row" style={{ marginBottom: 10, justifyContent: 'flex-end', gap: 8 }}>
        {profile?.role !== 'child' && <button className="btn btn-sm" onClick={() => setRubroSheet(null)}><Plus size={16} /> Rubro</button>}
        <button className="btn btn-sm" onClick={() => setListSheet('templates')}><Copy size={16} /> Habituales</button>
      </div>
      {profile?.role === 'child' && (
        <button type="button" className="ask-card" style={{ marginTop: 0, marginBottom: 12 }} onClick={() => setAskOpen(true)}>
          <span className="big" aria-hidden="true">🎒</span>
          <span><strong>Pedir algo</strong><span className="sub">Lo que te piden en el colegio o algo que necesites</span></span>
        </button>
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); add(); }} style={{ marginBottom: 10 }}>
        <input className="input" placeholder="Agregar producto (ej.: 2 leches)" aria-label="Agregar producto" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary" aria-label="Agregar"><Plus size={18} /></button>
      </form>
      {inList.length > 6 && <input className="input" style={{ marginBottom: 10 }} placeholder="Buscar en la lista" aria-label="Buscar en la lista" value={q} onChange={(e) => setQ(e.target.value)} />}
      {dupGroups.length > 0 && (
        <Banner tone="warn">
          Posibles repetidos: {dupGroups.map((g) => `${g[0].name} (${g.length})`).join(', ')}.{' '}
          <button className="link-btn" onClick={() => run(async () => { for (const g of dupGroups) await mergeItems(repo, g[0].id, g.slice(1).map((x) => x.id), profile?.id); }, 'Productos fusionados (sin perder notas ni cantidades)')}><Merge size={14} /> Fusionar</button>
        </Banner>
      )}
      {grouped.length === 0 && <div className="card" style={{ marginTop: 10 }}><Empty icon={<ShoppingCart size={36} />} title="No hay productos pendientes." /></div>}
      {grouped.map((g) => (
        <details key={g.c.id} className="rubro" open={open.includes(g.c.id) || !!q} onToggle={(e) => { if (!q) setOpenCat(g.c.id, (e.currentTarget as HTMLDetailsElement).open); }}>
          <summary className="rubro-head">
            <span className="rubro-ico" aria-hidden="true">{g.c.id === '_' ? categoryIcon('shopping', 'otras') : rubroIcon(g.c)}</span>
            <span className="rubro-name">{g.c.label}</span>
            <span className="rubro-count">{g.items.length}</span>
            <ChevronDown className="rubro-chevron" size={20} aria-hidden="true" />
          </summary>
          <div className="card"><ul className="list">
            {g.items.map((i) => (
              <li key={i.id}>
                <div className="item">
                  <CheckButton square on={false} label={`Marcar ${i.name} como comprado`} onClick={() => toggle(i)} />
                  <button type="button" className="item-main item-main-btn" onClick={() => setEditing(i)}>
                    <div className="item-title">{i.name}{i.quantity ? <span className="muted"> · {i.quantity} {i.unit ?? ''}</span> : null}</div>
                    <div className="item-sub">
                      {i.requestedBy && <RequestedBy id={i.requestedBy} />}
                      {i.priority === 'alta' && <StatusChip tone="warn">Urgente</StatusChip>}
                      {i.notes && <span className="truncate">{i.notes}</span>}
                      <SyncMark state={i._sync} configured={!!backend} />
                    </div>
                  </button>
                  {i.buyerId && <Avatar profile={profiles.find((p) => p.id === i.buyerId)} />}
                </div>
              </li>
            ))}
            {g.c.id !== '_' && (
              <li>
                <form className="item rubro-add" onSubmit={(e) => { e.preventDefault(); add(false, inlineName[g.c.id] ?? '', g.c.id); }}>
                  <Plus size={18} className="muted" aria-hidden="true" />
                  <input className="input" value={inlineName[g.c.id] ?? ''} onChange={(e) => setInlineName((m) => ({ ...m, [g.c.id]: e.target.value }))} placeholder={`Agregar en ${g.c.label}`} aria-label={`Agregar en ${g.c.label}`} />
                  {profile?.role !== 'child' && <button type="button" className="icon-btn" onClick={() => setRubroSheet(g.c)} aria-label={`Editar rubro ${g.c.label}`}><Pencil size={16} /></button>}
                </form>
              </li>
            )}
          </ul></div>
        </details>
      ))}
      {bought.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Comprados ({bought.length})</h2>
            <button className="link-btn" onClick={() => setShowBought(!showBought)} aria-expanded={showBought}>{showBought ? 'Ocultar' : 'Mostrar'}</button>
          </div>
          {noExpense.length > 0 && can('finance.edit') && (
            <button className="btn btn-sm" style={{ marginBottom: 8 }} onClick={() => setPurchaseFor(noExpense)}><Receipt size={16} /> Registrar gasto de lo comprado hoy ({noExpense.length})</button>
          )}
          {showBought && (
            <div className="card"><ul className="list">
              {bought.slice(0, 60).map((i) => (
                <li key={i.id}>
                  <div className="item done">
                    <CheckButton square on label={`Volver a poner ${i.name} en la lista`} onClick={() => toggle(i)} />
                    <button type="button" className="item-main item-main-btn" onClick={() => setEditing(i)}><div className="item-title">{i.name}</div><div className="item-sub">{i.expenseId ? 'Gasto registrado' : 'Sin gasto registrado'}</div></button>
                  </div>
                </li>
              ))}
            </ul></div>
          )}
        </section>
      )}
      <AskSheet open={askOpen} onClose={() => setAskOpen(false)} />
      <RubrosSheet open={rubroSheet !== undefined} editing={rubroSheet ?? null} onClose={() => setRubroSheet(undefined)} counts={counts} />
      <ItemSheet item={editing} onClose={() => setEditing(null)} lists={active} siblings={inList} />
      <PurchaseSheet items={purchaseFor} onClose={() => setPurchaseFor(null)} />
      <ListSheet mode={listSheet} onClose={() => setListSheet(null)} list={list} templates={templates} onCreated={(id) => setListId(id)} />
    </div>
  );
}

function guessCat(name: string, cats: Category[]): string {
  const valid = cats.map((c) => c.id);
  // Primero los rubros propios: por sus palabras clave o por su nombre ("alimento para perro" → Mascotas si tiene "perro").
  const f = norm(name);
  const own = cats.find((c) => c.custom && [...(c.keywords ?? []), c.label].some((k) => { const w = norm(k); return w.length > 2 && f.includes(w); }));
  if (own) return own.id;
  const g = guessShopCategory(name);
  if (g !== 'supermercado' && valid.includes(g)) return g;
  const n = norm(name);
  const map: [RegExp, string][] = [[/lavandina|detergente|esponja|trapo|suavizante|jabon en polvo|bolsas/, 'limpieza'], [/shampoo|pasta dental|desodorante|papel higienico|panal|toallita|jabon/, 'higiene'], [/ibuprofeno|paracetamol|curita|remedio|alcohol/, 'farmacia'], [/tornillo|lamparita|pila|cinta|pintura/, 'ferreteria'], [/cuaderno|lapiz|birome|carpeta|plasticola|utiles|cartulina|libro|fibras/, 'libreria'], [/cemento|arena|ladrillo|membrana|ceramico/, 'ferreteria'], [/zapato|bota|sandalia|ojota/, 'ropa'], [/medias|remera|zapatilla|pantalon|buzo/, 'ropa']];
  for (const [re, c] of map) if (re.test(n) && valid.includes(c)) return c;
  return valid.includes('supermercado') ? 'supermercado' : valid[0];
}

function ItemSheet({ item, onClose, lists, siblings }: { item: ShoppingItem | null; onClose: () => void; lists: ShoppingList[]; siblings: ShoppingItem[] }) {
  const { repo, profile, profiles, categories, run } = useApp();
  const [d, setD] = useState<Partial<ShoppingItem>>({});
  useEffect(() => { if (item) setD({ ...item }); }, [item?.id]);
  const set = (p: Partial<ShoppingItem>) => setD((x) => ({ ...x, ...p }));
  if (!item) return <Sheet open={false} onClose={onClose} title="Producto"><span /></Sheet>;
  const equivalents = siblings.filter((s) => s.id !== item.id && s.status === 'pendiente' && productKey(s.name) === productKey(d.name ?? item.name));
  const save = async () => {
    const { id, version, createdAt, updatedAt, rev, _sync, ...data } = d as any;
    if (await run(() => repo.update('shoppingItems', item.id, data, { by: profile?.id }), 'Producto actualizado')) onClose();
  };
  return (
    <Sheet open={!!item} onClose={onClose} title="Producto"
      footer={<>
        <button className="btn btn-danger" onClick={() => run(() => repo.remove('shoppingItems', item.id, { by: profile?.id }), 'Producto eliminado').then(onClose)}>Eliminar</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save}>Guardar</button>
      </>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <TextField label="Producto" required value={d.name} onChange={(v) => set({ name: v })} />
        <div className="form-row">
          <NumberField label="Cantidad" value={d.quantity} onChange={(v) => set({ quantity: v })} />
          <SelectField label="Unidad" value={d.unit ?? ''} onChange={(v) => set({ unit: v || undefined })} options={[{ value: '', label: '—' }, ...UNITS.map((u) => ({ value: u, label: u }))]} />
        </div>
        <div className="form-row">
          <CategorySelect value={d.category} onChange={(v) => set({ category: v })} categories={categories('shopping')} />
          <SelectField label="Prioridad" value={d.priority} onChange={(v) => set({ priority: v as any })} options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value: value as any, label }))} />
        </div>
        <PersonSelect label="Quién lo compra (opcional)" value={d.buyerId} onChange={(v) => set({ buyerId: v })} profiles={profiles} />
        <SelectField label="Lista" value={d.listId} onChange={(v) => set({ listId: v })} options={lists.map((l) => ({ value: l.id, label: l.name }))} />
        <TextArea label="Notas" value={d.notes} onChange={(v) => set({ notes: v })} rows={2} />
        <RelatedPicker value={{ type: d.relatedType, id: d.relatedId }} onChange={(type, id) => set({ relatedType: type as any, relatedId: id })} />
        {equivalents.length > 0 && (
          <Banner tone="warn">
            Hay {equivalents.length} producto(s) equivalente(s) en la lista.{' '}
            <button type="button" className="link-btn" onClick={() => run(() => mergeItems(repo, item.id, equivalents.map((e) => e.id), profile?.id), 'Fusionados').then(onClose)}>Fusionar en este</button>
          </Banner>
        )}
        <details className="more"><summary>Historial</summary><HistoryList entity="shoppingItems" recordId={item.id} /></details>
      </form>
    </Sheet>
  );
}

/** Relación con una tarea, un gasto o un elemento de la casa (sin duplicar registros). */
export function RelatedPicker({ value, onChange }: { value: { type?: string; id?: string }; onChange: (type?: string, id?: string) => void }) {
  const { can } = useApp();
  const opts = useLive(async (r) => {
    const [tasks, expenses, assets] = await Promise.all([r.list('tasks'), can('finance.view') ? r.list('expenses') : Promise.resolve([]), r.list('assets')]);
    return [
      ...tasks.filter((t) => !t.isSeries && t.status !== 'completada').slice(0, 60).map((t) => ({ value: `tasks:${t.id}`, label: `Tarea · ${t.title}` })),
      ...expenses.slice(-40).map((e) => ({ value: `expenses:${e.id}`, label: `Gasto · ${e.concept} (${e.date})` })),
      ...assets.map((a) => ({ value: `assets:${a.id}`, label: `Casa · ${a.name}` })),
    ];
  }, [], [] as { value: string; label: string }[]);
  return (
    <SelectField label="Relacionado con" value={value.type && value.id ? `${value.type}:${value.id}` : ''}
      onChange={(v) => { const [t, id] = v.split(':'); onChange(t || undefined, id || undefined); }}
      options={[{ value: '', label: 'Nada' }, ...opts]} />
  );
}

function PurchaseSheet({ items, onClose }: { items: ShoppingItem[] | null; onClose: () => void }) {
  const { repo, profile, categories, run } = useApp();
  const [amount, setAmount] = useState<number | undefined>();
  const [category, setCategory] = useState('supermercado');
  const [date, setDate] = useState<string | undefined>(today());
  const [concept, setConcept] = useState('');
  useEffect(() => { if (items) { setAmount(undefined); setDate(today()); setConcept(items.length === 1 ? items[0].name : `Compra (${items.length} productos)`); } }, [items]);
  if (!items) return <Sheet open={false} onClose={onClose} title="Registrar gasto"><span /></Sheet>;
  const save = async () => {
    if (!amount) return;
    // Los productos ya están marcados como comprados: solo se registra el gasto y se vinculan.
    const ok = await run(async () => {
      return repo.tx(async () => {
        const exp = await repo.create('expenses', { amount, date: date ?? today(), concept, category, currency: 'ARS', shoppingItemIds: items.map((i) => i.id), extraordinary: false, responsibleId: profile?.id }, { by: profile?.id });
        for (const i of items) await repo.update('shoppingItems', i.id, { expenseId: exp.id }, { by: profile?.id, skipHistory: true });
        return exp;
      });
    }, 'Gasto registrado');
    if (ok) onClose();
  };
  return (
    <Sheet open onClose={onClose} title="Registrar gasto de la compra"
      footer={<><button className="btn" onClick={onClose}>Ahora no</button><button className="btn btn-primary" disabled={!amount} onClick={save}>Registrar gasto</button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <p className="muted small">Productos: {items.map((i) => i.name).join(', ')}. El gasto solo se registra si indicás el importe.</p>
        <NumberField label="Importe total (ARS)" required value={amount} onChange={setAmount} />
        <TextField label="Concepto" value={concept} onChange={setConcept} />
        <div className="form-row">
          <CategorySelect value={category} onChange={setCategory} categories={categories('expenses')} />
          <DateField label="Fecha" value={date} onChange={setDate} />
        </div>
      </form>
    </Sheet>
  );
}

// re-export para pruebas
export { markPurchased };

function ListSheet({ mode, onClose, list, templates, onCreated }: { mode: 'new' | 'templates' | 'rename' | null; onClose: () => void; list: ShoppingList; templates: ShoppingList[]; onCreated: (id: string) => void }) {
  const { repo, profile, run } = useApp();
  const [name, setName] = useState('');
  useEffect(() => setName(''), [mode]);
  return (
    <Sheet open={!!mode} onClose={onClose} title={mode === 'new' ? 'Nueva lista' : 'Listas habituales'}>
      {mode === 'new' && (
        <form className="form" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; const l = await run(() => repo.create('shoppingLists', { name: name.trim(), isTemplate: false, archived: false }, { by: profile?.id }), 'Lista creada'); if (l) { onCreated(l.id); onClose(); } }}>
          <TextField label="Nombre" required value={name} onChange={setName} autoFocus placeholder="Ej.: Farmacia, Ferretería" />
          <button className="btn btn-primary">Crear</button>
        </form>
      )}
      {mode === 'templates' && (
        <div className="stack">
          <p className="muted small">Una lista habitual guarda productos que comprás seguido. Podés cargarlos en la lista actual sin duplicar los que ya están.</p>
          {templates.length === 0 && <p className="muted">Todavía no hay listas habituales.</p>}
          {templates.map((t) => (
            <div key={t.id} className="row">
              <span style={{ flex: 1 }}>{t.name}</span>
              <button className="btn btn-sm" onClick={() => run(async () => { const r = await applyTemplate(repo, t.id, list.id, profile?.id); return r; }).then((r) => { if (r) { onClose(); } })}>Cargar en "{list.name}"</button>
              <button className="btn btn-sm btn-ghost" onClick={() => run(() => repo.update('shoppingLists', t.id, { archived: true }, { by: profile?.id }), 'Lista habitual archivada')}>Archivar</button>
            </div>
          ))}
          <div className="divider" />
          <form className="form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) run(() => saveAsTemplate(repo, list.id, name.trim(), profile?.id), 'Lista habitual guardada').then(onClose); }}>
            <TextField label={`Guardar "${list.name}" como lista habitual`} value={name} onChange={setName} placeholder="Nombre de la lista habitual" />
            <button className="btn">Guardar como habitual</button>
          </form>
          {list.id !== DEFAULT_LIST_ID && <button className="btn btn-ghost" onClick={() => run(() => repo.update('shoppingLists', list.id, { archived: true }, { by: profile?.id }), 'Lista archivada').then(onClose)}>Archivar lista "{list.name}"</button>}
        </div>
      )}
    </Sheet>
  );
}

export { CategoryChip };
