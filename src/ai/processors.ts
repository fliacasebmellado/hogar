// Procesadores opcionales que se ejecutan EN EL DISPOSITIVO (salvo el reconocimiento de voz del navegador).
// Ninguno es obligatorio: si no están disponibles, la app ofrece completar el texto a mano.

export interface ProgressFn { (msg: string): void }

/** OCR local con Tesseract.js (Apache-2.0). La primera vez descarga el motor y el idioma español desde un CDN público. */
export async function ocrImage(blob: Blob, onProgress?: ProgressFn): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  onProgress?.('Preparando lectura de imagen (la primera vez descarga ~5 MB)…');
  const worker = await createWorker('spa', 1, {
    logger: (m: any) => { if (m.status === 'recognizing text') onProgress?.(`Leyendo imagen… ${Math.round(m.progress * 100)}%`); },
  });
  try {
    const { data } = await worker.recognize(blob);
    return (data.text || '').replace(/[ \t]+\n/g, '\n').trim();
  } finally {
    await worker.terminate();
  }
}

/** Reconocimiento de voz del navegador. En Chrome/Android el audio se envía a servidores de Google para transcribir. */
export function speechRecognitionAvailable(): boolean {
  return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export interface LiveRecognizer { stop(): void; onText: (final: string, interim: string) => void; onError: (e: string) => void; onEnd?: () => void }

/**
 * Une los resultados del reconocimiento de voz sin repetir palabras. Chrome en Android manda cada resultado con la frase
 * ACUMULADA ("comprar", "comprar banana", "comprar banana"…): si un texto empieza con lo ya reconocido, lo reemplaza;
 * si ya está incluido, se ignora; si es nuevo, se agrega.
 */
export function mergeSpeechResults(results: { transcript: string; isFinal: boolean }[]): { final: string; interim: string } {
  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const join = (acc: string, t: string) => {
    const a = norm(acc), n = norm(t);
    if (!n) return acc;
    if (!a || n.startsWith(a)) return t.trim();
    if (a.endsWith(n) || a.includes(n)) return acc;
    return `${acc.trim()} ${t.trim()}`;
  };
  let final = '';
  for (const r of results) if (r.isFinal) final = join(final, r.transcript);
  let interim = '';
  for (const r of results) if (!r.isFinal) interim = join(interim, r.transcript);
  // Si el texto provisorio ya contiene lo final (Android), se muestra solo lo que falta.
  const nf = norm(final), ni = norm(interim);
  if (nf && ni.startsWith(nf)) interim = interim.trim().split(/\s+/).slice(final.trim().split(/\s+/).length).join(' ');
  else if (nf && nf.includes(ni)) interim = '';
  return { final: final.trim(), interim: interim.trim() };
}

const isAndroid = () => typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

export function startLiveRecognition(lang = 'es-AR'): LiveRecognizer | null {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = lang;
  // En Android el modo continuo repite frases: se escucha una frase por vez (termina sola después de una pausa).
  rec.continuous = !isAndroid();
  rec.interimResults = true;
  const handle: LiveRecognizer = { stop: () => { try { rec.stop(); } catch { /* ya detenido */ } }, onText: () => {}, onError: () => {} };
  rec.onresult = (ev: any) => {
    const list = Array.from(ev.results as ArrayLike<any>).map((r: any) => ({ transcript: String(r[0]?.transcript ?? ''), isFinal: !!r.isFinal }));
    const { final, interim } = mergeSpeechResults(list);
    handle.onText(final, interim);
  };
  rec.onend = () => handle.onEnd?.();
  rec.onerror = (e: any) => handle.onError(e.error === 'not-allowed' ? 'Permiso de micrófono denegado.' : e.error === 'network' ? 'El reconocimiento de voz necesita conexión.' : e.error === 'no-speech' ? 'No se escuchó nada. Tocá "Volver a hablar".' : `Reconocimiento de voz: ${e.error}`);
  try { rec.start(); } catch (e: any) { return null; }
  return handle;
}

/** Decodifica audio (ogg/opus de WhatsApp, m4a, mp3, webm…) a PCM mono 16 kHz. Depende de los códecs del navegador. */
export async function decodeAudio16k(blob: Blob): Promise<Float32Array> {
  const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000);
    const src = offline.createBufferSource();
    src.buffer = buf;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  } finally {
    ctx.close?.();
  }
}

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
let whisperPipe: any = null;

/**
 * Transcripción local con Whisper (transformers.js, Apache-2.0). Opcional y experimental:
 * descarga el modelo (~80 MB) la primera vez y puede tardar en celulares modestos. El audio no sale del dispositivo.
 */
export async function transcribeWithWhisper(blob: Blob, onProgress?: ProgressFn): Promise<string> {
  onProgress?.('Decodificando audio…');
  const pcm = await decodeAudio16k(blob);
  if (!whisperPipe) {
    onProgress?.('Descargando modelo de transcripción (solo la primera vez)…');
    const mod: any = await import(/* @vite-ignore */ TRANSFORMERS_URL);
    whisperPipe = await mod.pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
      progress_callback: (p: any) => { if (p.status === 'progress' && p.file?.endsWith('.onnx')) onProgress?.(`Descargando modelo… ${Math.round(p.progress)}%`); },
    });
  }
  onProgress?.('Transcribiendo en el dispositivo…');
  const out = await whisperPipe(pcm, { language: 'spanish', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
  return String(out?.text ?? '').trim();
}

/** Graba audio con MediaRecorder. Devuelve un controlador para detener y obtener el archivo original. */
export async function startRecording(): Promise<{ stop: () => Promise<Blob>; stream: MediaStream }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => (window as any).MediaRecorder?.isTypeSupported?.(m)) ?? '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start(1000);
  return {
    stream,
    stop: () => new Promise<Blob>((resolve) => {
      rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); };
      rec.stop();
    }),
  };
}
