// Tipos del asistente: captura → interpretación → revisión → confirmación → guardado → sincronización.

export type ProposalKind = 'evento' | 'tarea' | 'compra' | 'pago' | 'gasto' | 'documento' | 'reparacion' | 'mantenimiento' | 'nota' | 'consulta' | 'otro';
export type Intent = 'crear' | 'recordatorio' | 'idea' | 'consulta' | 'informacion';

export interface Ambiguity {
  field: string;
  message: string;
  options?: { label: string; value: any }[];
  resolved?: boolean;
}

export interface DuplicateCandidate { entity: string; id: string; title: string; detail?: string; score: number }

export type DuplicateChoice = 'nuevo' | 'actualizar' | 'vincular';

export interface ShoppingProposalItem {
  name: string; quantity?: number; unit?: string; category?: string; include: boolean;
  duplicateOf?: string; confirmedDuplicate?: boolean;
}

export interface AISettings {
  /** 'reglas' = clasificación local por reglas; 'manual' = sin interpretación automática (formulario de revisión manual). */
  mode: 'reglas' | 'manual';
  ocr: boolean; // Tesseract.js en el dispositivo (descarga el motor y el idioma la primera vez)
  pdfText: boolean; // pdf.js en el dispositivo
  speech: boolean; // Web Speech API del navegador (en Chrome el audio lo procesa Google)
  whisper: boolean; // Whisper local con transformers.js (descarga ~80 MB la primera vez)
  llm: { enabled: boolean; endpoint: string; model: string }; // modelo local compatible con OpenAI (p. ej. Ollama)
}
export const DEFAULT_AI_SETTINGS: AISettings = {
  mode: 'reglas', ocr: true, pdfText: true, speech: false, whisper: false,
  llm: { enabled: false, endpoint: 'http://localhost:11434/v1/chat/completions', model: 'llama3.2' },
};

export interface Proposal {
  id: string;
  kind: ProposalKind;
  intent: Intent;
  sourceText: string;
  fields: Record<string, any>;
  missing: string[];
  ambiguities: Ambiguity[];
  warnings: string[];
  duplicates: DuplicateCandidate[];
  duplicateChoice?: DuplicateChoice;
  duplicateTargetId?: string;
  relations: { entity: string; id: string; label: string; kind: 'relacionado' | 'marcar_pagado' }[];
  /** Coincidencia heurística de reglas (0..1). NO es una probabilidad estadística. */
  ruleScore: number | null;
  include: boolean;
  processor: string;
  groupId?: string; // propuestas nacidas del mismo fragmento
}

export interface InterpretContext {
  now: Date;
  currentProfileId?: string;
  profiles: { id: string; name: string; role: 'adult' | 'child' | 'family'; aliases: string[]; active: boolean }[];
  existing: ExistingIndex;
  attachmentKinds?: ('imagen' | 'documento' | 'audio')[];
  fileNames?: string[];
}

export interface ExistingIndex {
  tasks: { id: string; title: string; dueDate?: string; status: string }[];
  events: { id: string; title: string; start: string }[];
  shoppingItems: { id: string; name: string; status: string; listId: string }[];
  payments: { id: string; concept: string; dueDate?: string; status: string; amount?: number; provider?: string }[];
  expenses: { id: string; concept: string; date: string; amount: number }[];
  documents: { id: string; name: string; date?: string }[];
  repairs: { id: string; title: string; status: string }[];
  assets: { id: string; name: string }[];
}

export const KIND_LABEL: Record<ProposalKind, string> = {
  evento: 'Evento', tarea: 'Tarea', compra: 'Compras', pago: 'Pago a vencer', gasto: 'Gasto realizado', documento: 'Documento',
  reparacion: 'Reparación', mantenimiento: 'Mantenimiento', nota: 'Nota', consulta: 'Consulta', otro: 'Sin acción detectada',
};
export const KIND_MODULE: Record<ProposalKind, string> = {
  evento: 'Agenda', tarea: 'Tareas', compra: 'Compras', pago: 'Economía', gasto: 'Economía', documento: 'Documentos',
  reparacion: 'Casa', mantenimiento: 'Casa', nota: 'Notas', consulta: '—', otro: '—',
};
