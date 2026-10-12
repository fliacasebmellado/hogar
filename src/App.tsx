import { lazy as reactLazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary, Loading } from './ui/Boundary';
import { Layout } from './app/Layout';
import { useApp } from './app/context';
import { canOpenModule, type ModuleKey } from './domain/permissions';
import Home from './modules/home/Home';

// Si después de una actualización falta un fragmento de la versión anterior, se recarga una sola vez.
function lazy<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return reactLazy(() => load().catch((e) => {
    const key = 'hogar-chunk-reload';
    if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, '1'); location.reload(); return new Promise<never>(() => {}); }
    throw e;
  }).then((m) => { sessionStorage.removeItem('hogar-chunk-reload'); return m; }));
}

const Agenda = lazy(() => import('./modules/agenda/Agenda'));
const Tasks = lazy(() => import('./modules/tasks/Tasks'));
const Shopping = lazy(() => import('./modules/shopping/Shopping'));
const Finance = lazy(() => import('./modules/finance/Finance'));
const Investments = lazy(() => import('./modules/investments/Investments'));
const House = lazy(() => import('./modules/house/House'));
const Family = lazy(() => import('./modules/family/Family'));
const Documents = lazy(() => import('./modules/documents/Documents'));
const Assistant = lazy(() => import('./modules/inbox/Assistant'));
const Settings = lazy(() => import('./modules/settings/Settings'));
const SearchPage = lazy(() => import('./modules/search/SearchPage'));
const Notifications = lazy(() => import('./modules/notifications/Notifications'));

function Guard({ mod, children }: { mod: ModuleKey; children: ReactNode }) {
  const { profile, permissions } = useApp();
  if (!canOpenModule(profile, mod, permissions)) {
    return <div className="empty"><p>Esta sección no está disponible para el perfil {profile?.name}.</p></div>;
  }
  return <>{children}</>;
}


export default function App({ updateBar }: { updateBar?: ReactNode }) {
  return (
    <HashRouter>
      <ErrorBoundary>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<Layout updateBar={updateBar} />}>
            <Route index element={<Home />} />
            <Route path="agenda" element={<Agenda />} />
            <Route path="tareas" element={<Tasks />} />
            <Route path="compras" element={<Shopping />} />
            <Route path="economia" element={<Guard mod="economia"><Finance /></Guard>} />
            <Route path="inversiones" element={<Guard mod="inversiones"><Investments /></Guard>} />
            <Route path="casa" element={<Guard mod="casa"><House /></Guard>} />
            <Route path="familia" element={<Family />} />
            <Route path="documentos" element={<Documents />} />
            <Route path="asistente" element={<Assistant />} />
            <Route path="ajustes/*" element={<Settings />} />
            <Route path="buscar" element={<SearchPage />} />
            <Route path="notificaciones" element={<Notifications />} />
            <Route path="share-target" element={<Navigate to="/asistente?compartido=1" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
      </ErrorBoundary>
    </HashRouter>
  );
}
