// Lectura con IA (Gemini vía backend) y filtro de ruido de la lectura local.
import { describe, it, expect } from 'vitest';
import { proposalsFromVision } from '../src/ai/vision';
import { resolveAmbiguity } from '../src/ai/pipeline';
import { looksLikeNoise, tidyNoise, base } from '../src/ai/rules';
import { createGasServer } from './gas-harness';

const ctx: any = {
  now: new Date(2026, 9, 30, 12), currentProfileId: 'profile-mama',
  profiles: [
    { id: 'profile-mama', name: 'Mamá', role: 'adult', aliases: [], active: true },
    { id: 'profile-hijo', name: 'Hijo', role: 'child', aliases: [], active: true, school: 'Form VI, 6.° A' },
    { id: 'profile-hija', name: 'Hija', role: 'child', aliases: [], active: true, school: 'Form II, 2.° B' },
    { id: 'profile-familia', name: 'Familia', role: 'family', aliases: [], active: true },
  ],
  existing: { tasks: [], events: [], shoppingItems: [], payments: [], expenses: [], documents: [], repairs: [], assets: [] },
};

describe('respuesta de la IA → propuestas para revisar', () => {
  it('exámenes del colegio: uno por chico y fecha, con aviso y sin ruido', () => {
    const ps = proposalsFromVision({ model: 'gemini-x', items: [
      { type: 'evento', title: 'Examen escrito de Inglés: Writing Skills', date: '2026-11-10', personIds: ['profile-hija'], personSure: true, category: 'colegio' },
      { type: 'evento', title: 'Examen de Matemática', date: '2026-11-16', personIds: ['profile-hijo'], personSure: true, category: 'colegio' },
      { type: 'evento', title: 'Examen oral de Inglés', date: '2026-11-03', personIds: ['profile-hijo'], personSure: true, category: 'colegio', doubt: 'Puede ser el 3 o el 4: confirmá cuál le toca.' },
    ] }, ctx, '');
    expect(ps).toHaveLength(3);
    expect(ps[0].fields).toMatchObject({ start: '2026-11-10', allDay: true, participantIds: ['profile-hija'], category: 'colegio', reminders: [1440, 60] });
    expect(ps[0].ambiguities).toHaveLength(0);
    expect(ps[2].warnings).toContain('Puede ser el 3 o el 4: confirmá cuál le toca.');
    expect(ps[0].processor).toBe('IA (gemini-x)');
  });
  it('turno de otro integrante: pregunta de quién es, y se resuelve con un toque', () => {
    const [p] = proposalsFromVision({ items: [{ type: 'evento', title: 'Turno Traumatología con Juan Romero', date: '2026-10-27', time: '17:00', personIds: ['profile-hijo'], personSure: true, category: 'turnos', location: 'Centro Médico Ejemplo' }] }, ctx, '');
    expect(p.fields).toMatchObject({ start: '2026-10-27T17:00', location: 'Centro Médico Ejemplo' });
    expect(p.ambiguities[0]).toMatchObject({ field: 'participants', message: '¿De quién es este turno?' });
    const r = resolveAmbiguity(p, 0, 'profile-hijo');
    expect(r.fields).toMatchObject({ participantIds: ['profile-hijo'], ownerId: 'profile-hijo' });
  });
  it('cumpleaños sin saber para quién: pregunta; IDs inventados se descartan', () => {
    const [p] = proposalsFromVision({ items: [{ type: 'evento', title: 'Cumpleaños de Sofi', date: '2026-11-14', time: '16:30', location: 'Salón Pelotero', personIds: ['inventado'], personSure: false, category: 'cumpleanos' }] }, ctx, '');
    expect(p.fields.participantIds).toEqual([]);
    expect(p.ambiguities[0].field).toBe('participants');
  });
});

describe('menos ruido en la lectura local', () => {
  it('descarta basura del OCR y junta el resto sin acción en una sola nota', () => {
    expect(looksLikeNoise('—_— —Uu Y.')).toBe(true);
    expect(looksLikeNoise('7 o y x MUNDO * No : Ne')).toBe(true);
    expect(looksLikeNoise('Reunión de padres en el salón')).toBe(false);
    const otro = (t: string) => ({ ...base('otro', 'informacion', t, { title: t }, null), include: false });
    const ev = base('evento', 'crear', 'Acto', { title: 'Acto' }, 0.8);
    const out = tidyNoise([otro('—_— —Uu Y.'), otro('Paciente: Fulano de Tal'), otro('Centro médico del barrio'), ev]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ kind: 'nota', include: false });
    expect(out[1].fields.body).toContain('Centro médico del barrio');
  });
});

describe('backend: Gemini', () => {
  it('sin clave avisa; con clave manda imagen + contexto y devuelve los ítems; la clave nunca vuelve a la app', () => {
    const s = createGasServer();
    expect(s.call('setup').ok).toBe(true);
    const sinClave = s.call('visionInterpret', { images: [{ mime: 'image/jpeg', base64: 'AAAA' }], context: { today: '2026-10-30', profiles: [] } });
    expect(sinClave.ok).toBe(false);
    const st = s.call('setGeminiKey', { key: 'AIzaSyEJEMPLO-de-clave-123456' }).result;
    expect(st).toEqual({ configured: true, model: 'gemini-2.5-flash' });
    expect(JSON.stringify(s.call('status').result)).not.toContain('AIzaSyEJEMPLO');
    s.ctx.__gemini = { code: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [{ type: 'evento', title: 'Examen de Lengua', date: '2026-11-19', personIds: ['profile-hijo'], personSure: true, category: 'colegio' }] }) }] } }] } };
    const r = s.call('visionInterpret', { images: [{ mime: 'image/jpeg', base64: 'AAAA' }], text: '', context: { today: '2026-10-30', profiles: [{ id: 'profile-hijo', name: 'Hijo', role: 'child', school: 'Form VI, 6.° A' }] } });
    expect(r.ok).toBe(true);
    expect(r.result.items[0].title).toBe('Examen de Lengua');
    const sent = JSON.parse(s.ctx.__geminiReq.opts.payload);
    expect(sent.contents[0].parts[0].text).toContain('Form VI, 6.° A');
    expect(sent.contents[0].parts.some((p: any) => p.inline_data?.data === 'AAAA')).toBe(true);
    expect(s.ctx.__geminiReq.opts.headers['x-goog-api-key']).toBe('AIzaSyEJEMPLO-de-clave-123456');
    s.ctx.__gemini = { code: 429, body: {} };
    expect(s.call('visionInterpret', { images: [], context: {} }).error).toMatch(/límite gratuito/);
  });
});
