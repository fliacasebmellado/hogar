import { Component, useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export function Loading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 10_000); return () => clearTimeout(t); }, []);
  return (
    <div className="loading" role="status">
      <Loader2 className="spin" size={20} /> Cargando…
      {slow && <button className="btn btn-sm" onClick={() => location.reload()}>Está tardando: recargar</button>}
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty" role="alert">
        <p>Algo falló al mostrar esta pantalla. Tus datos siguen guardados.</p>
        <p className="small muted">{this.state.error.message}</p>
        <button className="btn" onClick={() => location.reload()}>Recargar</button>
      </div>
    );
  }
}

