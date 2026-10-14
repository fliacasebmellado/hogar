// Pedido a la lista de compras pensado para los chicos: "me piden en el colegio" o "necesito…".
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../ui/Sheet';
import { Checkbox, TextField } from '../../ui/fields';
import { addItem, DEFAULT_LIST_ID } from '../../services/shopping';
import { ValidationError } from '../../domain/validation';

const KINDS = [
  { id: 'colegio', label: '✏️ Para el colegio' },
  { id: 'libreria', label: '📚 Librería' },
  { id: 'ropa', label: '👟 Ropa / calzado' },
  { id: 'farmacia', label: '💊 Farmacia' },
  { id: 'supermercado', label: '🛒 Comida' },
  { id: 'otras', label: '📦 Otra cosa' },
];

export function AskSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone?: () => void }) {
  const { repo, profile, toast } = useApp();
  const [name, setName] = useState('');
  const [cat, setCat] = useState('colegio');
  const [when, setWhen] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setName(''); setCat('colegio'); setWhen(''); setUrgent(false); setError(''); } }, [open]);
  const save = async () => {
    if (saving) return;
    if (!name.trim()) { setError('Escribí qué necesitás.'); return; }
    setError(''); setSaving(true);
    const notes = when ? `Para: ${when}` : undefined; // quién lo pidió queda en requestedBy (se muestra como etiqueta)
    let r: Awaited<ReturnType<typeof addItem>> | undefined;
    try {
      r = await addItem(repo, { listId: DEFAULT_LIST_ID, name: name.trim(), category: cat, priority: urgent ? 'alta' : 'media', notes, requestedBy: profile?.id }, { by: profile?.id });
    } catch (e: any) {
      // El error se muestra dentro de la hoja (los avisos generales podían quedar ocultos detrás de ella).
      setError(e instanceof ValidationError ? e.errors.join(' ') : e?.message ?? 'No se pudo agregar. Probá de nuevo.');
      return;
    } finally { setSaving(false); }
    if (r?.duplicate) { toast(`"${r.duplicate.name}" ya está en la lista.`); onClose(); return; }
    if (r?.item) { toast('¡Listo! Ya está en la lista de compras.', { tone: 'ok' }); onClose(); onDone?.(); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="¿Qué necesitás?">
      {/* El botón va pegado al campo (no al pie): con el teclado del celular abierto queda a la vista y responde al primer
          toque. La tecla "Ir/Enviar" del teclado también agrega el pedido. */}
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <TextField label="Qué hay que comprar" required value={name} onChange={setName} autoFocus placeholder="Ej.: cartulina verde, zapatillas" />
        {error && <p className="error-inline" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={saving}>{saving ? 'Agregando…' : 'Agregar a la lista'}</button>
        <div className="field" role="group" aria-label="Para qué es">
          <span className="field-label">¿Para qué es?</span>
          <div className="chips-toggle" style={{ flexWrap: 'wrap' }}>
            {KINDS.map((k) => <button key={k.id} type="button" aria-pressed={cat === k.id} onClick={() => setCat(k.id)}>{k.label}</button>)}
          </div>
        </div>
        <TextField label="¿Para cuándo? (opcional)" value={when} onChange={setWhen} placeholder="Ej.: el jueves, para educación física" />
        <Checkbox label="Es urgente" checked={urgent} onChange={setUrgent} />
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      </form>
    </Sheet>
  );
}
