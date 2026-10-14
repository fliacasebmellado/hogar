// Rubros de Compras propios de la familia: nombre, ícono y palabras para reconocerlos al agregar productos.
// Se guardan en la configuración compartida (planilla) y se ven igual que los rubros de fábrica.
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useApp } from '../../app/context';
import { Sheet } from '../../ui/Sheet';
import { TextField } from '../../ui/fields';
import { setConfig } from '../../services/config';
import { DEFAULT_CATEGORIES, SOFT, type Category } from '../../domain/catalog';
import { categoryIcon } from '../../ui/theme';

export const RUBRO_ICONS = ['🐶', '🐱', '🥩', '🥖', '🥦', '🍎', '🧀', '🐟', '🍷', '🥤', '🍫', '🍰', '👶', '🍼', '🧸', '🎁', '🎉', '🌱', '🪴', '🏊', '🚗', '⚽', '💻', '📱', '🔌', '💡', '🛋️', '🍳', '🛏️', '🧺', '💄', '💇', '🎨', '🎮', '📚', '🧵', '🏥', '🧰', '🏠', '📦'];

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function RubrosSheet({ open, onClose, editing, counts }: { open: boolean; onClose: () => void; editing?: Category | null; counts: Record<string, number> }) {
  const { repo, profile, run, toast, categories } = useApp();
  const [label, setLabel] = useState('');
  const [icon, setIcon] = useState('🐶');
  const [keywords, setKeywords] = useState('');
  useEffect(() => {
    if (!open) return;
    setLabel(editing?.label ?? ''); setIcon(editing?.icon ?? '🐶'); setKeywords((editing?.keywords ?? []).join(', '));
  }, [open, editing?.id]);

  const all = categories('shopping');
  const isDefault = (id: string) => DEFAULT_CATEGORIES.shopping.some((c) => c.id === id);
  const save = async () => {
    const name = label.trim();
    if (!name) { toast('Escribí el nombre del rubro.', { tone: 'error' }); return; }
    const kw = keywords.split(',').map((k) => k.trim()).filter(Boolean);
    let next: Category[];
    if (editing) next = all.map((c) => (c.id === editing.id ? { ...c, label: name, icon, keywords: kw } : c));
    else {
      if (all.some((c) => slug(c.label) === slug(name))) { toast(`Ya existe el rubro "${name}".`, { tone: 'error' }); return; }
      let id = slug(name) || 'rubro'; while (all.some((c) => c.id === id)) id += '-2';
      next = [...all.filter((c) => c.id !== 'otras'), { id, label: name, color: SOFT.stone, icon, keywords: kw, custom: true }, ...all.filter((c) => c.id === 'otras')];
    }
    const ok = await run(() => setConfig(repo, 'categories.shopping', next, profile?.id), editing ? 'Rubro actualizado' : `Rubro "${name}" agregado`);
    if (ok) onClose();
  };
  const remove = async () => {
    if (!editing) return;
    if ((counts[editing.id] ?? 0) > 0) { toast('Primero pasá sus productos a otro rubro (o marcalos como comprados).', { tone: 'error' }); return; }
    const ok = await run(() => setConfig(repo, 'categories.shopping', all.filter((c) => c.id !== editing.id), profile?.id), 'Rubro eliminado');
    if (ok) onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={editing ? `Editar rubro: ${editing.label}` : 'Nuevo rubro'}
      footer={<>{editing && !isDefault(editing.id) && <button className="btn btn-danger" onClick={remove}><Trash2 size={16} /> Eliminar</button>}<span className="spacer" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <div className="form">
        <div className="rubro-preview" aria-hidden="true">
          <span className="rubro-ico">{icon}</span><span className="rubro-name">{label || 'Nombre del rubro'}</span>
        </div>
        <TextField label="Nombre" required value={label} onChange={setLabel} placeholder="Ej.: Mascotas, Verdulería, Bebé" autoFocus />
        <div className="field" role="group" aria-label="Ícono">
          <span className="field-label">Ícono</span>
          <div className="icon-grid">
            {RUBRO_ICONS.map((e) => <button key={e} type="button" aria-pressed={icon === e} aria-label={`Ícono ${e}`} onClick={() => setIcon(e)}>{e}</button>)}
          </div>
          <TextField label="…o escribí otro emoji" value={RUBRO_ICONS.includes(icon) ? '' : icon} onChange={(v) => v.trim() && setIcon([...v.trim()].slice(0, 2).join(''))} placeholder="Tocá el teclado de emojis" />
        </div>
        <TextField label="Palabras para reconocerlo (opcional)" value={keywords} onChange={setKeywords}
          hint="Separadas por coma. Si un producto las contiene, va solo a este rubro. Ej.: alimento, piedras, collar" />
      </div>
    </Sheet>
  );
}

/** Ícono de un rubro: el elegido por la familia o el de fábrica. */
export const rubroIcon = (c: Category) => c.icon ?? categoryIcon('shopping', c.id);
