// Avisos al celular (ntfy): solo compras y tareas nuevas, nunca a quien las cargó, uno por lote.
import { describe, it, expect } from 'vitest';
import { createGasServer } from './gas-harness';

const now = '2026-11-03T10:00:00.000Z';
const prof = (id: string, name: string, role: string) => ({ id, name, role, active: true, createdAt: now, updatedAt: now });
let n = 0;
const op = (entity: string, record: any) => ({ opId: `op-${++n}`, entity, recordId: record.id, baseVersion: 0, record: { createdAt: now, updatedAt: now, ...record } });

describe('avisos con ntfy', () => {
  it('avisa a los adultos suscriptos con un solo mensaje por lote', () => {
    const s = createGasServer();
    expect(s.call('setup').ok).toBe(true);
    s.call('push', { ops: [op('profiles', prof('profile-papa', 'Papá', 'adult')), op('profiles', prof('profile-mama', 'Mamá', 'adult')), op('profiles', prof('profile-hija', 'Hija', 'child'))] });
    expect(s.call('pushStatus', { profileId: 'profile-hija' }).error).toMatch(/solo para adultos/);
    const st = s.call('pushStatus', { profileId: 'profile-mama', appUrl: 'https://ejemplo.github.io/hogar/' }).result;
    expect(st.topic).toMatch(/^hogar-[0-9a-f]{20}$/);
    expect(st.enabled).toBe(false);
    expect(JSON.stringify(s.call('status').result)).not.toContain(st.topic);
    s.call('pushSet', { profileId: 'profile-mama', enabled: true });
    s.call('pushStatus', { profileId: 'profile-papa' });
    s.call('pushSet', { profileId: 'profile-papa', enabled: true });

    s.ctx.__fetches = [];
    s.call('push', { ops: [
      op('shoppingItems', { id: 'i1', name: 'Cartulina verde', status: 'pendiente', requestedBy: 'profile-hija', updatedBy: 'profile-hija' }),
      op('shoppingItems', { id: 'i2', name: 'Plasticola', status: 'pendiente', requestedBy: 'profile-hija', updatedBy: 'profile-hija' }),
      op('payments', { id: 'p1', concept: 'Luz', updatedBy: 'profile-hija' }),
    ] });
    const sent = s.ctx.__fetches.filter((f: any) => f.url.includes('ntfy')).map((f: any) => JSON.parse(f.opts.payload));
    expect(sent).toHaveLength(2);
    expect(sent[0].message).toBe('🛒 Hija pidió: Cartulina verde, Plasticola');
    expect(sent[0].click).toBe('https://ejemplo.github.io/hogar/#/compras');
    expect(sent.map((x: any) => x.topic)).toContain(st.topic);

    // La tarea que carga Mamá para Papá: solo le avisa a Papá. Editar una tarea no avisa.
    s.ctx.__fetches = [];
    s.call('push', { ops: [op('tasks', { id: 't1', title: 'Llevar el auto al service', assigneeId: 'profile-papa', dueDate: '2026-11-06', status: 'pendiente', updatedBy: 'profile-mama' })] });
    let ntfy = s.ctx.__fetches.filter((f: any) => f.url.includes('ntfy')).map((f: any) => JSON.parse(f.opts.payload));
    expect(ntfy).toHaveLength(1);
    expect(ntfy[0].message).toBe('✅ Nueva tarea para vos: Llevar el auto al service (06/11) · cargó Mamá');
    expect(ntfy[0].topic).not.toBe(st.topic);
    s.ctx.__fetches = [];
    s.call('push', { ops: [{ ...op('tasks', { id: 't1', title: 'Llevar el auto', assigneeId: 'profile-papa', status: 'pendiente', updatedBy: 'profile-mama' }), baseVersion: 1 }] });
    expect(s.ctx.__fetches.filter((f: any) => f.url.includes('ntfy'))).toHaveLength(0);

    // Si ntfy rechaza a Google (429), el aviso vuelve a la app para que lo mande el celular.
    s.ctx.__ntfyCode = 429;
    const r = s.call('push', { ops: [op('shoppingItems', { id: 'i9', name: 'Yerba', status: 'pendiente', updatedBy: 'profile-papa' })] }).result;
    expect(r.notify).toHaveLength(1);
    expect(r.notify[0]).toMatchObject({ topic: st.topic, message: '🛒 Papá agregó: Yerba' });
    expect(r.notifyServer).toBe('https://ntfy.sh');
    expect(s.call('pushTest', { profileId: 'profile-mama' }).result).toMatchObject({ sent: false, notifyServer: 'https://ntfy.sh' });
    s.ctx.__ntfyCode = 200;
    expect(s.call('pushTest', { profileId: 'profile-mama' }).result.sent).toBe(true);

    // Apagado: no manda nada.
    s.call('pushSet', { profileId: 'profile-papa', enabled: false });
    s.call('pushSet', { profileId: 'profile-mama', enabled: false });
    s.ctx.__fetches = [];
    s.call('push', { ops: [op('shoppingItems', { id: 'i3', name: 'Leche', status: 'pendiente', updatedBy: 'profile-hija' })] });
    expect(s.ctx.__fetches.filter((f: any) => f.url.includes('ntfy'))).toHaveLength(0);
  });
});
