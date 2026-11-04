// Avisos al celular (ntfy): si Google no pudo mandarlos (límite 429 por sus direcciones compartidas),
// el backend los devuelve y la app los publica desde el celular, con su propia conexión.
export interface NtfyMessage { topic: string; title?: string; message: string; tags?: string[]; click?: string }

const isOk = (server?: string) => !!server && /^https:\/\/[a-z0-9.-]+$/i.test(server);

async function post(server: string, body: NtfyMessage) {
  const r = await fetch(`${server}/`, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`ntfy no respondió (${r.status}).`);
}

/** Publica cada aviso; reintenta una vez a los pocos segundos. Devuelve cuántos salieron. */
export async function sendNtfy(server: string | undefined, msgs: NtfyMessage[] | undefined, retryMs = 4000): Promise<number> {
  if (!isOk(server) || !msgs?.length) return 0;
  let sent = 0;
  for (const m of msgs) {
    if (!m?.topic || !/^hogar-[0-9a-f]{20}$/.test(m.topic)) continue; // solo tópicos de Hogar
    try { await post(server!, m); sent++; }
    catch {
      await new Promise((r) => setTimeout(r, retryMs));
      try { await post(server!, m); sent++; } catch { /* sin conexión: el aviso se pierde, la compra o tarea quedó guardada igual */ }
    }
  }
  return sent;
}
