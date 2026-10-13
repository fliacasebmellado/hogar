// Modos rápidos del Asistente que se abren desde los botones de Inicio:
// - Foto: muestra la foto recién sacada, deja elegir a dónde va y escribir qué hacer con ella.
// - Voz: abre el micrófono, transcribe en vivo y al terminar manda el texto a interpretar.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Mic, Square, RotateCcw, Send, X } from 'lucide-react';
import type { ProposalKind } from '../../ai/types';
import { speechRecognitionAvailable, startLiveRecognition, type LiveRecognizer } from '../../ai/processors';

export type Destination = ProposalKind | 'auto';
export const PHOTO_DESTINATIONS: { id: Destination; label: string; hint: string }[] = [
  { id: 'auto', label: '✨ Que lo decida el asistente', hint: 'Ej.: factura de la luz, vence el 20' },
  { id: 'compra', label: '🛒 Compras', hint: 'Ej.: comprar este repuesto, 2 unidades' },
  { id: 'reparacion', label: '🔧 Casa (arreglo)', hint: 'Ej.: se rompió la canilla del baño' },
  { id: 'pago', label: '💳 Gasto / factura', hint: 'Ej.: factura de gas, vence el 15' },
  { id: 'documento', label: '📄 Documentos', hint: 'Ej.: DNI de Mamá, frente' },
  { id: 'tarea', label: '✅ Tarea', hint: 'Ej.: llevar esto al correo el lunes' },
  { id: 'evento', label: '📅 Agenda', hint: 'Ej.: cumpleaños el sábado a las 17' },
];

export function PhotoMode({ files, onAddPhotos, onRemove, dest, setDest, text, setText, onSubmit, busy }: {
  files: { blob: Blob; name: string }[]; onAddPhotos: (f: File[]) => void; onRemove: (i: number) => void;
  dest: Destination; setDest: (d: Destination) => void; text: string; setText: (t: string) => void; onSubmit: () => void; busy: boolean;
}) {
  const urls = useMemo(() => files.map((f) => (f.blob.type.startsWith('image/') ? URL.createObjectURL(f.blob) : '')), [files]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  const hint = PHOTO_DESTINATIONS.find((d) => d.id === dest)?.hint;
  return (
    <div className="card card-pad stack quick-mode">
      {files.length === 0 ? (
        <label className="camera-big">
          <Camera size={40} strokeWidth={1.8} />
          <span>Sacar foto</span>
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onAddPhotos(f); }} />
        </label>
      ) : (
        <div className="photo-strip">
          {files.map((f, i) => (
            <div key={i} className="photo-thumb">
              {urls[i] ? <img src={urls[i]} alt={`Foto ${i + 1}`} /> : <span className="small">{f.name}</span>}
              <button type="button" className="icon-btn" aria-label={`Quitar foto ${i + 1}`} onClick={() => onRemove(i)}><X size={16} /></button>
            </div>
          ))}
          <label className="photo-add" aria-label="Sacar otra foto">
            <Camera size={22} />
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onAddPhotos(f); }} />
          </label>
        </div>
      )}
      <div className="field" role="group" aria-label="Dónde va">
        <span className="field-label">¿Dónde va?</span>
        <div className="chips-toggle" style={{ flexWrap: 'wrap' }}>
          {PHOTO_DESTINATIONS.map((d) => <button key={d.id} type="button" aria-pressed={dest === d.id} onClick={() => setDest(d.id)}>{d.label}</button>)}
        </div>
      </div>
      <div className="field">
        <label htmlFor="foto-texto" className="field-label">¿Qué hay que hacer con esta foto? (opcional)</label>
        <textarea id="foto-texto" className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={hint} />
      </div>
      <button type="button" className="btn btn-primary btn-block" onClick={onSubmit} disabled={busy || files.length === 0}><Send size={16} /> Continuar</button>
    </div>
  );
}

/** Dictado: arranca solo al abrir; al terminar (botón "Listo" o silencio largo) entrega el texto. */
export function VoiceMode({ onSubmit, busy, onError }: { onSubmit: (text: string) => void; busy: boolean; onError: (m: string) => void }) {
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState('');
  const [interim, setInterim] = useState('');
  const rec = useRef<LiveRecognizer | null>(null);
  const textRef = useRef('');
  const submitted = useRef(false);
  const available = speechRecognitionAvailable();
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;

  const finish = () => {
    rec.current?.stop(); rec.current = null; setListening(false); setInterim('');
    const t = textRef.current.trim();
    if (t && !submitted.current) { submitted.current = true; submitRef.current(t); }
  };
  const start = () => {
    if (!available) return;
    submitted.current = false; textRef.current = ''; setFinalText(''); setInterim('');
    const r = startLiveRecognition('es-AR');
    if (!r) { onError('No se pudo abrir el micrófono. Revisá el permiso del navegador.'); return; }
    r.onText = (fin, int) => { textRef.current = [fin, int].filter(Boolean).join(' '); setFinalText(fin); setInterim(int); };
    r.onError = (m) => { onError(m); setListening(false); };
    r.onEnd = () => finish(); // el navegador corta solo después de un silencio
    rec.current = r; setListening(true);
  };
  useEffect(() => { start(); return () => rec.current?.stop(); }, []);

  if (!available) {
    return <div className="card card-pad stack"><p>Este navegador no permite dictar por voz. Usá <strong>Escribir</strong> o el micrófono del teclado del celular.</p></div>;
  }
  return (
    <div className="card card-pad stack quick-mode" aria-live="polite">
      <div className={`mic-big${listening ? ' on' : ''}`} aria-hidden="true"><Mic size={42} strokeWidth={1.8} /></div>
      <p className="voice-status">{busy ? 'Interpretando…' : listening ? 'Te escucho… decí qué hay que hacer' : finalText ? 'Listo' : 'Tocá el micrófono para hablar'}</p>
      <div className="voice-text">{finalText || interim ? <>{finalText} <span className="muted">{interim}</span></> : <span className="muted">Ej.: "Mañana a las 5 dentista de Hija y hay que comprar leche"</span>}</div>
      {listening
        ? <button type="button" className="btn btn-primary btn-block" onClick={finish}><Square size={16} /> Listo</button>
        : <button type="button" className="btn btn-block" onClick={start} disabled={busy}><RotateCcw size={16} /> Volver a hablar</button>}
      <p className="muted tiny">El dictado lo hace el reconocimiento de voz del navegador (en Android lo procesa Google). Antes de guardar vas a poder revisar todo.</p>
    </div>
  );
}
