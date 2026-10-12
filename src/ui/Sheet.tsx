// Hoja modal accesible basada en <dialog> nativo: atrapa el foco, se cierra con Escape y devuelve el foco al origen.
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Sheet(props: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; labelId?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) {
      opener.current = document.activeElement;
      if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    } else if (!props.open && d.open) {
      if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
      (opener.current as HTMLElement | null)?.focus?.();
    }
  }, [props.open]);
  useEffect(() => () => { if (ref.current?.open) ref.current.close?.(); }, []);
  const id = props.labelId ?? `sheet-${props.title.replace(/\W+/g, '-')}`;
  return (
    <dialog
      ref={ref}
      className={`sheet${props.wide ? ' wide' : ''}`}
      aria-labelledby={id}
      onCancel={(e) => { e.preventDefault(); props.onClose(); }}
      onClick={(e) => { if (e.target === ref.current) props.onClose(); }}
    >
      {props.open && (
        <>
          <div className="sheet-head">
            <h2 id={id}>{props.title}</h2>
            <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Cerrar"><X size={20} /></button>
          </div>
          <div className="sheet-body">{props.children}</div>
          {props.footer && <div className="sheet-foot">{props.footer}</div>}
        </>
      )}
    </dialog>
  );
}

export function ConfirmSheet(props: { open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Sheet open={props.open} onClose={props.onClose} title={props.title}
      footer={<>
        <button className="btn" onClick={props.onClose}>Cancelar</button>
        <button className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => { props.onConfirm(); props.onClose(); }}>{props.confirmLabel ?? 'Confirmar'}</button>
      </>}>
      <div className="stack">{props.message}</div>
    </Sheet>
  );
}
