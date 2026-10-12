import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Camera, ClipboardPaste, FileUp, Mic, Music, Send, Square, X, Inbox, Mail, ClipboardList } from 'lucide-react';
import { useApp, useLive } from '../../app/context';
import type { Capture } from '../../domain/types';
import { Banner, Empty, Segmented, StatusChip } from '../../ui/components';
import { FilePickButton, iconFor } from '../../ui/records';
import { cancelCapture, captureNotes, createCapture, processCapture, type SavedRecord } from '../../ai/pipeline';
import { ocrImage, speechRecognitionAvailable, startLiveRecognition, startRecording, transcribeWithWhisper, type LiveRecognizer } from '../../ai/processors';
import { extractPdfText } from '../../services/documents';
import { humanSize } from '../../services/files';
import { formatDateTimeHuman } from '../../domain/dates';
import { guessMime } from '../../domain/validation';
import { ReviewSheet } from './ReviewSheet';
import { GmailImportSheet } from './GmailImport';
import { HttpTransport } from '../../sync/transport';
import { importFormResponses } from '../../integrations/google';

type Tab = 'capturar' | 'revisar' | 'historial';
const STATUS_LABEL: Record<string, string> = { pendiente: 'Sin interpretar', en_revision: 'Por revisar', procesada: 'Procesada', cancelada: 'Cancelada' };

export default function Assistant() {
  const { repo, profile, ai, run, toast, backend } = useApp();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('capturar');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<{ blob: Blob; name: string }[]>([]);
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedRecord[] | null>(null);
  const [recording, setRecording] = useState<null | { stop: () => Promise<Blob>; rec: LiveRecognizer | null; started: number }>(null);
  const [interim, setInterim] = useState('');
  const [gmailOpen, setGmailOpen] = useState(false);
  const cancelled = useRef(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const captures = useLive((r) => r.db.entity('captures').orderBy('createdAt').reverse().filter((c) => !c.deleted).limit(150).toArray(), [], [] as Capture[]);
  const pending = captures.filter((c) => c.status === 'pendiente' || c.status === 'en_revision');

  // Atajos desde Inicio (?modo=texto|foto|voz) y contenido compartido desde otras apps (?compartido=1).
  useEffect(() => {
    const modo = params.get('modo');
    if (modo === 'texto') setTimeout(() => textRef.current?.focus(), 50);
    if (params.get('compartido')) loadShared();
    if (params.get('nota')) setTab('historial');
  }, []);

  async function loadShared() {
    try {
      const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('hogar-compartidos', 1); r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const items: any[] = await new Promise((res, rej) => { const tx = db.transaction('items', 'readonly'); const q = tx.objectStore('items').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      if (!items.length) { toast('No llegó contenido compartido.', { tone: 'error' }); return; }
      const t = items.map((i) => [i.title, i.text, i.url].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
      setText((x) => [x, t].filter(Boolean).join('\n'));
      setFiles((f) => [...f, ...items.flatMap((i) => i.files.map((fl: any) => ({ blob: new Blob([fl.data], { type: guessMime(fl.name, fl.type) }), name: fl.name })))]);
      await new Promise<void>((res) => { const tx = db.transaction('items', 'readwrite'); tx.objectStore('items').clear(); tx.oncomplete = () => res(); });
      toast('Contenido compartido listo para interpretar.', { tone: 'ok' });
      setParams({}, { replace: true });
    } catch (e: any) { toast(`No se pudo leer lo compartido: ${e.message}`, { tone: 'error' }); }
  }

  const addFiles = (fs: File[]) => setFiles((x) => [...x, ...fs.map((f) => ({ blob: f, name: f.name }))]);

  const startVoice = async () => {
    try {
      const r = await startRecording();
      let rec: LiveRecognizer | null = null;
      if (ai.speech && speechRecognitionAvailable() && ai.mode !== 'manual') {
        rec = startLiveRecognition('es-AR');
        if (rec) {
          rec.onText = (fin, int) => { setTranscript(fin); setInterim(int); };
          rec.onError = (e) => toast(e + ' El audio igual se guarda.', { tone: 'error' });
        }
      }
      setRecording({ stop: r.stop, rec, started: Date.now() });
    } catch (e: any) {
      toast(e?.name === 'NotAllowedError' ? 'Permiso de micrófono denegado. Habilitalo en el navegador.' : `No se pudo grabar: ${e.message}`, { tone: 'error' });
    }
  };
  const stopVoice = async () => {
    if (!recording) return;
    recording.rec?.stop();
    const blob = await recording.stop();
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    setFiles((x) => [...x, { blob, name: `nota-de-voz-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${ext}` }]);
    setRecording(null); setInterim('');
  };

  const interpret = async () => {
    if (!text.trim() && !files.length && !transcript.trim()) { toast('Escribí, pegá o adjuntá algo para interpretar.', { tone: 'error' }); return; }
    cancelled.current = false;
    setBusy('Guardando la captura…');
    const kind = files.some((f) => f.blob.type.startsWith('audio/')) ? (transcript ? 'voz' : 'audio') : files.some((f) => f.blob.type === 'application/pdf') ? 'documento' : files.length ? 'imagen' : 'texto';
    const c = await run(() => createCapture(repo, { kind, text, transcript: transcript || undefined, files, by: profile?.id }));
    if (!c) { setBusy(null); return; }
    setText(''); setFiles([]); setTranscript('');
    const processed = await run(() => processCapture(repo, c.id, {
      settings: ai, currentProfileId: profile?.id,
      extractors: { ocr: (b) => ocrImage(b, (m) => setBusy(m)), pdf: extractPdfText, transcribe: (b) => transcribeWithWhisper(b, (m) => setBusy(m)), onProgress: setBusy },
    }));
    setBusy(null);
    if (cancelled.current) { await cancelCapture(repo, c.id, profile?.id); toast('Captura cancelada. No se guardó ningún registro.'); return; }
    if (processed) setReviewId(c.id);
    else toast('La captura quedó guardada en "Por revisar" para intentarlo de nuevo.', { tone: 'error' });
  };

  const reprocess = async (c: Capture) => {
    setBusy('Interpretando…');
    const ok = await run(() => processCapture(repo, c.id, { settings: ai, currentProfileId: profile?.id, extractors: { ocr: (b) => ocrImage(b, (m) => setBusy(m)), pdf: extractPdfText, transcribe: (b) => transcribeWithWhisper(b, (m) => setBusy(m)) } }));
    setBusy(null);
    if (ok) setReviewId(c.id);
  };

  const transport = backend ? new HttpTransport(backend.url, backend.token) : null;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Segmented label="Asistente" value={tab} onChange={setTab} options={[{ value: 'capturar', label: 'Capturar' }, { value: 'revisar', label: 'Por revisar', badge: pending.length }, { value: 'historial', label: 'Historial' }]} />
      </div>

      {tab === 'capturar' && (
        <div className="stack">
          <div className="card card-pad stack">
            <label htmlFor="captura-texto" className="field-label">Escribí, pegá un mensaje de WhatsApp o un correo, o adjuntá una foto, un documento o un audio</label>
            <textarea id="captura-texto" ref={textRef} className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Ej.: Mañana a las 18 reunión de padres. Hay que comprar leche y pan. El 20 vence la luz $45.000" />
            {(recording || transcript) && (
              <div className="banner banner-info" aria-live="polite">
                {recording && <span className="rec-indicator" aria-hidden="true" />}
                <div>{recording ? 'Grabando… ' : 'Transcripción (editable): '}{recording ? (ai.speech ? (transcript || interim || 'hablá ahora') : 'el audio se guardará; el reconocimiento de voz está desactivado') : null}
                  {!recording && <textarea className="input" rows={2} value={transcript} onChange={(e) => setTranscript(e.target.value)} aria-label="Transcripción" />}
                </div>
              </div>
            )}
            {files.length > 0 && (
              <ul className="list stack-sm" aria-label="Archivos adjuntos">
                {files.map((f, i) => {
                  const I = iconFor(f.blob.type);
                  return <li key={i} className="row small"><I size={18} /><span className="truncate" style={{ flex: 1 }}>{f.name}</span><span className="muted">{humanSize(f.blob.size)}</span>
                    <button className="icon-btn" aria-label={`Quitar ${f.name}`} onClick={() => setFiles((x) => x.filter((_, k) => k !== i))}><X size={16} /></button></li>;
                })}
              </ul>
            )}
            <div className="row-wrap">
              <button className="btn btn-sm" onClick={async () => { try { const t = await navigator.clipboard.readText(); setText((x) => [x, t].filter(Boolean).join('\n')); } catch { toast('El navegador no permitió leer el portapapeles. Usá mantener presionado → Pegar.', { tone: 'error' }); } }}><ClipboardPaste size={16} /> Pegar</button>
              <FilePickButton label="Foto o captura" accept="image/*" onFiles={addFiles} />
              <FilePickButton label="Cámara" accept="image/*" capture="environment" multiple={false} onFiles={addFiles} />
              <FilePickButton label="Documento" accept="application/pdf,image/*,.doc,.docx,.txt" onFiles={addFiles} />
              <FilePickButton label="Audio" accept="audio/*,.ogg,.opus,.m4a,.mp3,.aac,.wav" onFiles={addFiles} />
              {recording ? <button className="btn btn-sm btn-danger" onClick={stopVoice}><Square size={16} /> Detener</button>
                : <button className="btn btn-sm" onClick={startVoice} disabled={!navigator.mediaDevices}><Mic size={16} /> Grabar voz</button>}
            </div>
            <div className="row">
              <span className="muted tiny" style={{ flex: 1 }}>
                {ai.mode === 'manual' ? 'Interpretación automática desactivada: vas a completar los datos a mano.' : 'Se interpreta en este dispositivo con reglas locales. Nada se guarda sin tu confirmación.'}
              </span>
              <button className="btn btn-primary" onClick={interpret} disabled={!!busy || !!recording}><Send size={16} /> Interpretar</button>
            </div>
            {busy && (
              <div className="banner banner-info" role="status">
                <div style={{ flex: 1 }}>{busy}</div>
                <button className="btn btn-sm" onClick={() => { cancelled.current = true; setBusy('Cancelando…'); }}>Cancelar</button>
              </div>
            )}
          </div>
          {files.some((f) => f.blob.type.startsWith('audio/')) && !ai.whisper && !transcript && (
            <Banner tone="warn">El audio se guardará tal cual. Para interpretarlo, escribí lo que dice arriba o activá la transcripción local en Ajustes → Asistente.</Banner>
          )}
          {transport && (
            <div className="card card-pad stack-sm">
              <h3>Importar para revisar</h3>
              <div className="row-wrap">
                <button className="btn btn-sm" onClick={() => setGmailOpen(true)}><Mail size={16} /> Desde Gmail</button>
                <button className="btn btn-sm" onClick={() => run(() => importFormResponses(repo, transport, profile?.id)).then((n) => { if (n !== undefined) { toast(n ? `${n} respuesta(s) de formulario para revisar` : 'No hay respuestas nuevas de formularios.', { tone: 'ok' }); if (n) setTab('revisar'); } })}><ClipboardList size={16} /> Respuestas de formularios</button>
              </div>
              <p className="muted tiny">Solo se importa lo que elijas. Todo pasa por la misma revisión antes de guardarse.</p>
            </div>
          )}
          {saved && (
            <Banner tone="ok">
              Guardado: {saved.map((s) => `${s.title} (${s.action})`).join(', ')}. {backend ? 'Se sincronizará con Google automáticamente; mirá el indicador de arriba para confirmar que llegó.' : 'Quedó guardado solo en este dispositivo (Google no está conectado).'}
            </Banner>
          )}
        </div>
      )}

      {tab === 'revisar' && (
        pending.length === 0 ? <div className="card"><Empty icon={<Inbox size={36} />} title="No hay elementos por revisar." /></div> : (
          <div className="card"><ul className="list">
            {pending.map((c) => <CaptureRow key={c.id} c={c} onOpen={() => (c.status === 'pendiente' ? reprocess(c) : setReviewId(c.id))} />)}
          </ul></div>
        )
      )}

      {tab === 'historial' && <History captures={captures.filter((c) => c.status === 'procesada' || c.status === 'cancelada')} onOpen={(c) => setReviewId(c.id)} />}

      <ReviewSheet captureId={reviewId} onClose={() => setReviewId(null)} onSaved={(s) => { setSaved(s); setTab('capturar'); }} />
      {transport && <GmailImportSheet open={gmailOpen} onClose={() => setGmailOpen(false)} transport={transport} onImported={() => setTab('revisar')} />}
    </div>
  );
}

function CaptureRow({ c, onOpen }: { c: Capture; onOpen: () => void }) {
  const Icon = c.kind === 'imagen' ? Camera : c.kind === 'audio' || c.kind === 'voz' ? Music : c.kind === 'documento' ? FileUp : c.kind === 'gmail' ? Mail : c.kind === 'forms' ? ClipboardList : Inbox;
  return (
    <li>
      <button className="item" onClick={onOpen}>
        <Icon size={20} className="muted" />
        <div className="item-main">
          <div className="item-title truncate">{(c.text || c.extractedText || `${c.attachmentIds.length} archivo(s)`).split('\n')[0].slice(0, 90)}</div>
          <div className="item-sub"><span>{formatDateTimeHuman(c.createdAt)}</span><span>{c.proposals.length} propuesta(s)</span>{c.processor && <span>{c.processor}</span>}</div>
        </div>
        <StatusChip tone={c.status === 'procesada' ? 'ok' : c.status === 'cancelada' ? 'neutral' : 'warn'}>{STATUS_LABEL[c.status]}</StatusChip>
      </button>
    </li>
  );
}

function History({ captures, onOpen }: { captures: Capture[]; onOpen: (c: Capture) => void }) {
  const notes = useLive((r) => r.list('notes'), [], [] as any[]);
  const [filter, setFilter] = useState<'procesada' | 'cancelada' | 'notas'>('procesada');
  const list = useMemo(() => captures.filter((c) => c.status === filter), [captures, filter]);
  return (
    <div className="stack-sm">
      <Segmented label="Historial" value={filter} onChange={setFilter} options={[{ value: 'procesada', label: 'Procesadas' }, { value: 'cancelada', label: 'Canceladas' }, { value: 'notas', label: 'Notas' }]} />
      {filter === 'notas' ? (
        notes.length ? <div className="card"><ul className="list">{notes.map((n: any) => <li key={n.id}><div className="item"><div className="item-main"><div className="item-title">{n.title}</div>{n.body && n.body !== n.title && <div className="item-sub pre">{n.body}</div>}</div></div></li>)}</ul></div>
          : <p className="muted small">No hay notas guardadas.</p>
      ) : list.length ? <div className="card"><ul className="list">{list.map((c) => <CaptureRow key={c.id} c={c} onOpen={() => onOpen(c)} />)}</ul></div>
        : <p className="muted small">Nada por acá todavía.</p>}
      <p className="muted tiny">Se conserva la captura original, lo que se interpretó y lo que decidiste. <Link to="/ajustes/privacidad">Qué se procesa y dónde</Link>.</p>
    </div>
  );
}

export { captureNotes };
