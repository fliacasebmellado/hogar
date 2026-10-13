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

export function startLiveRecognition(lang = 'es-AR'): LiveRecognizer | null {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = '';
  const handle: LiveRecognizer = { stop: () => { try { rec.stop(); } catch { /* ya detenido */ } }, onText: () => {}, onError: () => {} };
  rec.onresult = (ev: any) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalText += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }
    handle.onText(finalText.trim(), interim);
  };
  rec.onend = () => handle.onEnd?.();
  rec.onerror = (e: any) => handle.onError(e.error === 'not-allowed' ? 'Permiso de micrófono denegado.' : e.error === 'network' ? 'El reconocimiento de voz necesita conexión.' : `Reconocimiento de voz: ${e.error}`);
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
