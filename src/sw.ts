/// <reference lib="webworker" />
// Service worker: precarga la app (funciona sin conexión), cachea recursos de OCR descargados, recibe contenido
// compartido desde otras apps (Web Share Target) y abre la app al tocar una notificación.
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();

self.addEventListener('message', (e) => { if (e.data?.type === 'SKIP_WAITING') self.skipWaiting(); });

registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/share-target/] }));

// Motor y datos de idioma del OCR (se descargan una vez y quedan disponibles sin conexión).
registerRoute(
  ({ url }) => url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'tessdata.projectnaptha.com' || url.hostname === 'huggingface.co' || url.hostname.endsWith('.hf.co'),
  new CacheFirst({ cacheName: 'procesadores-locales' }),
);

// Web Share Target: guarda lo compartido en IndexedDB (cola temporal) y abre el asistente para revisarlo.
registerRoute(
  ({ url, request }) => request.method === 'POST' && url.pathname.endsWith('/share-target'),
  async ({ request }) => {
    try {
      const form = await request.formData();
      const files = form.getAll('files').filter((f): f is File => f instanceof File);
      const item = {
        id: String(Date.now()),
        title: String(form.get('title') ?? ''), text: String(form.get('text') ?? ''), url: String(form.get('url') ?? ''),
        files: await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, data: await f.arrayBuffer() }))),
        at: new Date().toISOString(),
      };
      await putShared(item);
    } catch { /* se informa en la app si no hay contenido */ }
    return Response.redirect('./#/asistente?compartido=1', 303);
  },
  'POST',
);

function openSharedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('hogar-compartidos', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('items', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function putShared(item: any) {
  const db = await openSharedDB();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction('items', 'readwrite');
    tx.objectStore('items').put(item);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const url = `./#${link}`;
    if (all.length) { await (all[0] as WindowClient).focus(); (all[0] as WindowClient).navigate(url).catch(() => undefined); }
    else await self.clients.openWindow(url);
  })());
});
