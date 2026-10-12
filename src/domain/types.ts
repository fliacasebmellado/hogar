// Modelo de datos del hogar. Fuente de verdad de los campos: shared/schema.json (compartido con Apps Script).
import type { Proposal } from '../ai/types';

export type ID = string;
export type ISODate = string; // YYYY-MM-DD (fecha local)
export type ISODateTime = string; // YYYY-MM-DDTHH:mm (hora local, sin zona)

export type Origin = 'manual' | 'asistente' | 'google_calendar' | 'gmail' | 'forms' | 'import' | 'sistema' | 'restauracion' | 'planilla' | 'drive';
export type SyncState = 'local' | 'pending' | 'synced' | 'conflict' | 'error';

export interface BaseRecord {
  id: ID;
  rev?: number; // revisión global asignada por el servidor (cursor de sincronización)
  version: number; // versión del registro en el servidor (0 = nunca sincronizado)
  createdAt: string;
  updatedAt: string;
  deleted: boolean; // borrado lógico
  updatedBy?: ID;
  deviceId?: string;
  origin?: Origin;
  demo?: boolean; // datos de demostración: identificados y eliminables
  _sync?: SyncState; // solo local
}

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  byWeekday?: number[]; // 0=domingo … 6=sábado
  until?: ISODate;
  count?: number;
}

/** 'family' = perfil compartido "Familia / Todos": muestra lo de todos junto (sin economía por defecto). */
export type Role = 'adult' | 'child' | 'family';
export interface ProfilePrefs {
  homeBlocks?: string[];
  simpleMode?: boolean;
  notifyLeadMinutes?: number;
  notifyCategories?: string[];
  quietFrom?: string; // HH:mm
  quietTo?: string;
}
export interface Profile extends BaseRecord {
  name: string; role: Role; color: string; avatar: string; active: boolean;
  aliases: string[]; prefs: ProfilePrefs; pinHash?: string; birthDate?: ISODate; notes?: string;
}
export interface Household extends BaseRecord { name: string; timezone: string; currency: string; email: string }
export interface ConfigEntry extends BaseRecord { key: string; value: any }

export type TaskStatus = 'pendiente' | 'en_curso' | 'bloqueada' | 'completada';
export type Priority = 'baja' | 'media' | 'alta';
export interface Task extends BaseRecord {
  title: string; description?: string; category: string; assigneeId?: ID; collaboratorIds: ID[];
  dueDate?: ISODate; dueTime?: string; priority: Priority; status: TaskStatus;
  recurrence?: Recurrence | null; isSeries?: boolean; seriesId?: ID; occurrenceDate?: ISODate; detached?: boolean;
  nextRun?: ISODate; completedAt?: string; completedBy?: ID; notes?: string; attachmentIds: ID[];
  relatedType?: EntityName; relatedId?: ID; assetId?: ID; roomId?: ID; maintenanceId?: ID;
}

export type RSVP = 'confirmado' | 'pendiente' | 'rechazado';
export interface CalendarEvent extends BaseRecord {
  title: string; description?: string; start: ISODateTime; end?: ISODateTime; allDay: boolean; location?: string;
  participantIds: ID[]; ownerId?: ID; category: string; reminders: number[]; recurrence?: Recurrence | null;
  notes?: string; attachmentIds: ID[]; rsvp: RSVP; syncCalendar: boolean;
  googleEventId?: string; googleUpdated?: string; calendarSyncedAt?: string; relatedType?: EntityName; relatedId?: ID;
}

export interface ShoppingList extends BaseRecord { name: string; isTemplate: boolean; archived: boolean; notes?: string }
export type ItemStatus = 'pendiente' | 'comprado' | 'descartado';
export interface ShoppingItem extends BaseRecord {
  listId: ID; name: string; quantity?: number; unit?: string; category: string; priority: Priority; buyerId?: ID;
  status: ItemStatus; purchasedAt?: string; purchasedBy?: ID; notes?: string; relatedType?: EntityName; relatedId?: ID;
  expenseId?: ID; mergedInto?: ID; requestedBy?: ID;
}

export type PaymentStatus = 'pendiente' | 'programado' | 'pagado' | 'vencido';
export interface Payment extends BaseRecord {
  concept: string; category: string; provider?: string; amount?: number; currency: string; issueDate?: ISODate;
  dueDate?: ISODate; paidDate?: ISODate; responsibleId?: ID; status: PaymentStatus; method?: string; receiptDocId?: ID;
  recurrence?: Recurrence | null; isSeries?: boolean; seriesId?: ID; occurrenceDate?: ISODate; notes?: string;
  expenseId?: ID; relatedType?: EntityName; relatedId?: ID;
}
export interface Expense extends BaseRecord {
  date: ISODate; amount: number; currency: string; category: string; concept: string; responsibleId?: ID;
  receiptDocId?: ID; paymentId?: ID; repairId?: ID; assetId?: ID; shoppingItemIds: ID[]; extraordinary: boolean;
  method?: string; notes?: string;
}

export interface Room extends BaseRecord { name: string; floor?: string; notes?: string }
export interface Provider extends BaseRecord { name: string; trade?: string; phone?: string; email?: string; address?: string; notes?: string }
export interface Asset extends BaseRecord {
  name: string; category: string; roomId?: ID; brand?: string; model?: string; serial?: string; purchaseDate?: ISODate;
  warrantyUntil?: ISODate; manualDocId?: ID; providerId?: ID; specs?: string; photoIds: ID[]; notes?: string;
}
export interface Maintenance extends BaseRecord {
  title: string; category: string; assetId?: ID; roomId?: ID; recurrence: Recurrence; frequencySource?: string;
  assigneeId?: ID; taskSeriesId?: ID; active: boolean; notes?: string;
}
export type RepairStatus = 'reportada' | 'en_curso' | 'resuelta';
export interface Repair extends BaseRecord {
  title: string; description?: string; assetId?: ID; roomId?: ID; providerId?: ID; reportedAt: ISODate; resolvedAt?: ISODate;
  status: RepairStatus; cost?: number; taskId?: ID; expenseId?: ID; invoiceDocId?: ID; notes?: string;
}

export type Visibility = 'familia' | 'adultos' | 'personal';
export interface DocumentRecord extends BaseRecord {
  name: string; mimeType?: string; category: string; date?: ISODate; personId?: ID; relatedType?: EntityName; relatedId?: ID;
  description?: string; tags: string[]; visibility: Visibility; ownerId?: ID; attachmentId?: ID; extractedText?: string;
  expiresAt?: ISODate; driveUrl?: string;
}
export type UploadStatus = 'local' | 'pending' | 'uploaded' | 'error' | 'remote_only';
export interface Attachment extends BaseRecord {
  name: string; mimeType: string; size: number; hash: string; folder: string; driveFileId?: string; driveUrl?: string;
  uploadStatus: UploadStatus;
}
export interface Note extends BaseRecord { title: string; body?: string; personIds: ID[]; relatedType?: EntityName; relatedId?: ID; pinned?: boolean }

export type CaptureKind = 'texto' | 'imagen' | 'documento' | 'audio' | 'voz' | 'compartido' | 'gmail' | 'forms' | 'calendar';
export type CaptureStatus = 'pendiente' | 'en_revision' | 'procesada' | 'cancelada';
export interface Capture extends BaseRecord {
  kind: CaptureKind; text?: string; attachmentIds: ID[]; extractedText?: string; processor?: string; status: CaptureStatus;
  proposals: Proposal[]; decisions: CaptureDecision[]; sourceRef?: string; createdBy?: ID; processedAt?: string;
}
export interface CaptureDecision {
  proposalId: string; action: 'creado' | 'actualizado' | 'vinculado' | 'descartado'; entity?: EntityName; recordId?: ID; at: string;
}

export interface HistoryEntry extends BaseRecord {
  entity: EntityName; recordId: ID; action: 'crear' | 'editar' | 'eliminar' | 'restaurar' | 'completar' | 'conflicto' | 'sync';
  at: string; by?: ID; changes: Record<string, [any, any]> | null;
}

// ---- Inversiones (propiedades, locales, terrenos…) ----
export interface Investment extends BaseRecord {
  name: string; kind: string; address?: string; owners?: string; status?: string; purchaseDate?: ISODate; purchaseValue?: number;
  currency: string; taxIds?: string; driveFolderId?: string; driveUrl?: string; notes?: string;
}
export interface InvestmentContract extends BaseRecord {
  investmentId: ID; kind: string; counterpart?: string; startDate?: ISODate; endDate?: ISODate; amount?: number; currency: string;
  frequency?: string; adjustment?: string; dueDay?: number; status: string; documentId?: ID; notes?: string;
}
export interface InvestmentTax extends BaseRecord {
  investmentId: ID; tax: string; period?: string; dueDate?: ISODate; amount?: number; currency: string; paidDate?: ISODate;
  status: string; method?: string; receiptDocId?: ID; accountNumber?: string; notes?: string;
}
export interface InvestmentWork extends BaseRecord {
  investmentId: ID; title: string; date?: ISODate; provider?: string; cost?: number; currency: string; status: string;
  paidBy?: string; documentId?: ID; notes?: string;
}

export interface EntityMap {
  household: Household; profiles: Profile; config: ConfigEntry; tasks: Task; events: CalendarEvent;
  shoppingLists: ShoppingList; shoppingItems: ShoppingItem; payments: Payment; expenses: Expense; rooms: Room;
  providers: Provider; assets: Asset; maintenance: Maintenance; repairs: Repair; documents: DocumentRecord;
  attachments: Attachment; notes: Note; captures: Capture; history: HistoryEntry;
  investments: Investment; investmentContracts: InvestmentContract; investmentTaxes: InvestmentTax; investmentWorks: InvestmentWork;
}
export type EntityName = keyof EntityMap;
export const ENTITY_NAMES: EntityName[] = [
  'household', 'profiles', 'config', 'tasks', 'events', 'shoppingLists', 'shoppingItems', 'payments', 'expenses', 'rooms',
  'providers', 'assets', 'maintenance', 'repairs', 'documents', 'attachments', 'notes', 'captures', 'history',
  'investments', 'investmentContracts', 'investmentTaxes', 'investmentWorks',
];

// ---- Tablas solo locales ----
export interface OutboxOp {
  opId: string; entity: EntityName; recordId: ID; type: 'upsert' | 'delete'; payload: any; baseVersion: number;
  force?: boolean; status: 'pending' | 'sending' | 'error' | 'conflict'; attempts: number; lastError?: string;
  createdAt: string; updatedAt: string; nextAttemptAt?: number;
  base?: any; // copia del registro en baseVersion, para fusionar cambios disjuntos ante un conflicto
  seed?: boolean; // creado por la inicialización automática (no por una persona)
}
export interface Conflict {
  id: string; entity: EntityName; recordId: ID; local: any; server: any; fields: string[]; detectedAt: string;
  source: 'sync' | 'calendar'; resolved?: boolean; resolution?: string;
}
export interface SyncLogEntry { id?: number; at: string; level: 'info' | 'warn' | 'error'; message: string; detail?: string }
export interface LocalFile { id: ID; blob: Blob; storedAt: string }
export interface NotificationState { key: string; read: boolean; dismissed: boolean; notifiedAt?: string }
export interface LocalBackup { id: string; createdAt: string; reason: string; size: number; checksum: string; data: string }
