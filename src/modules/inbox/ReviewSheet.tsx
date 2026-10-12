// Pantalla de revisión obligatoria: nada se guarda sin que la persona confirme cada propuesta.
import { useEffect, useState } from 'react';
import { useApp, useLive } from '../../app/context';
import type { Capture } from '../../domain/types';
import type { ExistingIndex, Proposal } from '../../ai/types';
import { Sheet } from '../../ui/Sheet';
import { Banner } from '../../ui/components';
import { useOpenAttachment, iconFor } from '../../ui/records';
import { blockingIssues, finalizeProposal } from '../../ai/finalize';
import { buildExistingIndex, cancelCapture, captureNotes, confirmCapture, saveReview, type SavedRecord } from '../../ai/pipeline';
import { ProposalCard } from './ProposalCard';
import { formatDateTimeHuman } from '../../domain/dates';

export function ReviewSheet({ captureId, onClose, onSaved }: { captureId: string | null; onClose: () => void; onSaved: (s: SavedRecord[]) => void }) {
  const { repo, profile, run, can, toast } = useApp();
  const capture = useLive((r) => (captureId ? r.get('captures', captureId) : undefined), [captureId], undefined as Capture | undefined);
  const atts = useLive(async (r) => (capture ? Promise.all(capture.attachmentIds.map((id) => r.get('attachments', id))) : []), [capture?.id], [] as any[]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [existing, setExisting] = useState<ExistingIndex | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [showIssues, setShowIssues] = useState(false);
  const open = useOpenAttachment();
  const readOnly = capture?.status === 'procesada' || capture?.status === 'cancelada';

  useEffect(() => {
    if (!captureId) return;
    setShowIssues(false);
    (async () => {
      setExisting(await buildExistingIndex(repo));
      setNotes(await captureNotes(repo, captureId));
    })();
  }, [captureId]);
  useEffect(() => { if (capture) setProposals(capture.proposals); }, [capture?.id, capture?.status]);

  const update = (i: number, p: Proposal) => {
    const fin = existing ? finalizeProposal(p, existing) : p;
    // conservar la decisión sobre duplicados si el candidato sigue siendo el mismo
    if (p.duplicateChoice && fin.duplicates.some((d) => d.id === p.duplicateTargetId)) { fin.duplicateChoice = p.duplicateChoice; fin.duplicateTargetId = p.duplicateTargetId; }
    if (!fin.duplicates.length) { fin.duplicateChoice = undefined; }
    setProposals((ps) => ps.map((x, k) => (k === i ? fin : x)));
  };
  const included = proposals.filter((p) => p.include);
  const financeBlock = included.some((p) => (p.kind === 'pago' || p.kind === 'gasto') && !can('finance.edit'));
  const issues = included.flatMap((p) => blockingIssues(p));
  const canConfirm = !readOnly && included.length > 0 && issues.length === 0 && !financeBlock;

  const confirm = async () => {
    if (!capture) return;
    if (!canConfirm) { setShowIssues(true); return; }
    const saved = await run(() => confirmCapture(repo, capture.id, proposals, profile?.id));
    if (saved) { onSaved(saved); onClose(); toast(`${saved.length} registro(s) guardado(s).`, { tone: 'ok' }); }
  };
  const later = async () => { if (capture && !readOnly) await run(() => saveReview(repo, capture.id, proposals), 'Guardado para revisar después'); onClose(); };
  const cancel = async () => { if (capture) await run(() => cancelCapture(repo, capture.id, profile?.id), 'Captura cancelada: no se creó ningún registro'); onClose(); };

  return (
    <Sheet open={!!captureId && !!capture} onClose={readOnly ? onClose : later} title={readOnly ? 'Detalle de la captura' : 'Revisar antes de guardar'} wide
      footer={readOnly ? <button className="btn" onClick={onClose}>Cerrar</button> : <>
        <button className="btn btn-danger" onClick={cancel}>Cancelar captura</button>
        <span className="spacer" />
        <button className="btn" onClick={later}>Revisar después</button>
        <button className="btn btn-primary" onClick={confirm} aria-disabled={!canConfirm}>Confirmar y guardar ({included.length})</button>
      </>}>
      {capture && (
        <div className="stack">
          <section className="card card-pad stack-sm" aria-label="Contenido original">
            <div className="row small muted"><span>Original · {formatDateTimeHuman(capture.createdAt)} · procesado con: {capture.processor ?? '—'}</span></div>
            {capture.text && <div className="source-quote">{capture.text}</div>}
            {atts.filter(Boolean).map((a: any) => { const I = iconFor(a.mimeType); return <button key={a.id} className="link-btn row small" onClick={() => open(a.id)}><I size={16} /> {a.name}</button>; })}
            {capture.extractedText && <details className="more"><summary>Texto leído de los archivos</summary><p className="pre small">{capture.extractedText}</p></details>}
            {notes.map((n, i) => <Banner key={i} tone="warn">{n}</Banner>)}
          </section>
          {readOnly && capture.decisions.length > 0 && (
            <section className="card card-pad"><h3>Decisiones</h3>
              <ul className="small">{capture.decisions.map((d, i) => <li key={i}>{d.action}{d.entity ? ` · ${d.entity}` : ''} · {formatDateTimeHuman(d.at)}</li>)}</ul>
            </section>
          )}
          {proposals.length > 1 && !readOnly && <p className="small">Se detectaron <strong>{proposals.length}</strong> acciones separadas. Revisá cada una y marcá cuáles guardar.</p>}
          {proposals.length === 0 && <Banner tone="info">No se detectaron acciones. Podés cancelar la captura o escribir el contenido de nuevo.</Banner>}
          {proposals.map((p, i) => (
            <fieldset key={p.id} disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
              <ProposalCard p={p} onChange={(np) => update(i, np)} />
            </fieldset>
          ))}
          {showIssues && (issues.length > 0 || financeBlock) && (
            <Banner tone="alert">No se puede confirmar todavía: {[...new Set(issues)].join(' ')}{financeBlock ? ' Tu perfil no puede registrar pagos o gastos.' : ''}</Banner>
          )}
          {!readOnly && <p className="muted tiny">Confirmar guarda en este dispositivo. La sincronización con Google ocurre después y se indica aparte.</p>}
        </div>
      )}
    </Sheet>
  );
}
