import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useApp } from '../../app/context';
import { globalSearch, type SearchHit } from '../../services/search';
import { Empty } from '../../ui/components';

export default function SearchPage() {
  const { repo, profile, permissions } = useApp();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    const t = setTimeout(async () => setHits(await globalSearch(repo, q, profile, permissions)), 180);
    return () => clearTimeout(t);
  }, [q, profile?.id]);
  return (
    <div>
      <div className="searchbox" style={{ marginBottom: 12 }}>
        <Search size={18} />
        <input className="input" type="search" autoFocus placeholder="Buscar en tareas, agenda, compras, pagos, documentos, casa…" aria-label="Buscar en toda la app" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {q.length >= 2 && hits.length === 0 && <Empty icon={<Search size={32} />} title="Sin resultados." />}
      {hits.length > 0 && (
        <div className="card"><ul className="list" aria-live="polite">
          {hits.map((h) => <li key={`${h.entity}-${h.id}`}><Link className="item" to={h.link}><div className="item-main"><div className="item-title">{h.title}</div><div className="item-sub">{h.subtitle}</div></div></Link></li>)}
        </ul></div>
      )}
      {q.length < 2 && <p className="muted small">Escribí al menos 2 letras. La búsqueda funciona sin conexión y respeta la visibilidad de cada perfil.</p>}
    </div>
  );
}
