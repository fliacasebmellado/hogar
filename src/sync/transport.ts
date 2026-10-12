// Transporte hacia el backend de Google Apps Script (Web App).
// Se usa Content-Type text/plain para que el navegador no envíe una solicitud previa CORS (preflight),
// que Apps Script no responde. El token familiar viaja en el cuerpo (nunca en la URL).
export interface Transport { call<T = any>(action: string, payload?: Record<string, any>): Promise<T> }

export class BackendError extends Error {
  constructor(message: string, public code: string = 'backend', public retryable = true) { super(message); }
}

export class HttpTransport implements Transport {
  constructor(private url: string, private token: string, private timeoutMs = 60000) {}

  async call<T = any>(action: string, payload: Record<string, any> = {}): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: 'POST', redirect: 'follow', signal: ctrl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, action, token: this.token }),
      });
    } catch (e: any) {
      throw new BackendError(e?.name === 'AbortError' ? 'Tiempo de espera agotado al contactar a Google.' : 'Sin conexión con el servidor de Google.', 'network', true);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new BackendError(`El servidor respondió ${res.status}.`, 'http', res.status >= 500 || res.status === 429);
    let json: any;
    const text = await res.text();
    try { json = JSON.parse(text); } catch {
      // Apps Script devuelve HTML cuando la implementación no es pública o la URL es incorrecta.
      throw new BackendError('La respuesta no es válida. Revisá que la URL sea la de la implementación "/exec" y que el acceso sea "Cualquier persona".', 'format', false);
    }
    if (!json.ok) throw new BackendError(json.error || 'Error del servidor', json.code || 'backend', json.code !== 'auth' && json.code !== 'schema');
    return json.result as T;
  }
}

export function isRetryable(e: any) { return !(e instanceof BackendError) || e.retryable; }
