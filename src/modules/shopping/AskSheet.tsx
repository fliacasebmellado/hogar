// Pedido a la lista de compras pensado para los chicos: "me piden en el colegio" o "necesito…".
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../ui/Sheet';
import { Checkbox, TextField } from '../../ui/fields';
import { addItem, DEFAULT_LIST_ID } from '../../services/shopping';

const KINDS = [
  { id: 'colegio', label: '✏️ Para el colegio' },
  { id: 'ropa', label: '👟 Ropa' },
  { id: 'farmacia', label: '💊 Farmacia' },
  { id: 'supermercado', label: '🛒 Comida' },
  { id: 'otras', label: '📦 Otra cosa' },
];

export function AskSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone?: () => void }) {
  const { repo, profile, run, toast } = useApp();
  const [name, setName] = useState('');
  const [cat, setCat] = useState('colegio');
  const [when, setWhen] = useState('');
  const [urgent, setUrgent] = useState(false);
  useEffect(() => { if (open) { setName(''); setCat('colegio'); setWhen(''); setUrgent(false); } }, [open]);
  const save = async () => {
    if (!name.trim()) { toast('Escribí qué necesitás.', { tone: 'error' }); return; }
    const notes = when ? `Para: ${when}` : undefined; // quién lo pidió queda en requestedBy (se muestra como etiqueta)
    const r = await run(() => addItem(repo, { listId: DEFAULT_LIST_ID, name: name.trim(), category: cat, priority: urgent ? 'alta' : 'media', notes, requestedBy: profile?.id }, { by: profile?.id }));
    if (r?.duplicate) { toast(`"${r.duplicate.name}" ya está en la lista.`); onClose(); return; }
    if (r?.item) { toast('¡Listo! Ya está en la lista de compras.', { tone: 'ok' }); onClose(); onDone?.(); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="¿Qué necesitás?"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Agregar a la lista</button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <TextField label="Qué hay que comprar" required value={name} onChange={setName} autoFocus placeholder="Ej.: cartulina verde, zapatillas" />
        <div className="field" role="group" aria-label="Para qué es">
          <span className="field-label">¿Para qué es?</span>
          <div className="chips-toggle" style={{ flexWrap: 'wrap' }}>
            {KINDS.map((k) => <button key={k.id} type="button" aria-pressed={cat === k.id} onClick={() => setCat(k.id)}>{k.label}</button>)}
          </div>
        </div>
        <TextField label="¿Para cuándo? (opcional)" value={when} onChange={setWhen} placeholder="Ej.: el jueves, para educación física" />
        <Checkbox label="Es urgente" checked={urgent} onChange={setUrgent} />
      </form>
    </Sheet>
  );
}
