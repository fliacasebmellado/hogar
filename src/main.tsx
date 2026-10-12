import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './styles.css';
import App from './App';
import { Loading } from './ui/Boundary';
import { AppProvider, bootstrap } from './app/context';
import type { Repo } from './db/repo';

// El service worker se registra al iniciar (antes de elegir perfil) para que la app quede disponible sin conexión.
let applyUpdate: null | (() => void) = null;
const updateListeners = new Set<() => void>();
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh: () => { applyUpdate = () => updateSW(true); updateListeners.forEach((f) => f()); },
      onRegisteredSW: (_url, reg) => { if (reg) setInterval(() => reg.update().catch(() => undefined), 60 * 60 * 1000); },
    });
  });
}

function UpdateBar() {
  const [update, setUpdate] = useState<null | (() => void)>(applyUpdate);
  useEffect(() => {
    const f = () => setUpdate(() => applyUpdate);
    updateListeners.add(f);
    return () => { updateListeners.delete(f); };
  }, []);
  if (!update) return null;
  return (
    <div className="update-bar" role="status">
      Hay una versión nueva de Hogar. <button className="btn btn-sm" onClick={update}>Actualizar</button>
    </div>
  );
}

function Root() {
  const [repo, setRepo] = useState<Repo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // Pide al navegador que no borre los datos locales por falta de espacio (si lo permite).
    navigator.storage?.persist?.().catch(() => undefined);
    bootstrap().then(setRepo).catch((e) => setError(e?.message ?? String(e)));
  }, []);
  if (error) {
    return (
      <main className="content" style={{ maxWidth: 560 }}>
        <h1>No se pudo abrir la base de datos local</h1>
        <p className="muted" style={{ marginTop: 8 }}>{error}</p>
        <p style={{ marginTop: 8 }}>Probá cerrar otras pestañas de Hogar y recargar. Si usás navegación privada, algunos navegadores no permiten guardar datos.</p>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => location.reload()}>Recargar</button>
      </main>
    );
  }
  if (!repo) return <Loading />;
  return <AppProvider repo={repo}><App updateBar={<UpdateBar />} /></AppProvider>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
