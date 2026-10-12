// Inversiones: propiedades y otras inversiones con sus contratos, impuestos y mantenimiento.
// Cada inversión tiene su carpeta en Drive (Inversiones/<nombre>/Contratos|Impuestos|Mantenimiento|Otros) y su
// fila en la planilla "Inversiones". Los impuestos de inversiones NO se mezclan con los gastos de la casa.
import type { Repo } from '../db/repo';
import type { ID, ISODate, Investment, InvestmentContract, InvestmentTax, InvestmentWork } from '../domain/types';
import { addMonths, diffDays, today } from '../domain/dates';

export const INVESTMENT_KINDS: { id: string; label: string; icon: string }[] = [
  { id: 'departamento', label: 'Departamento', icon: '🏢' }, { id: 'casa', label: 'Casa', icon: '🏠' }, { id: 'local', label: 'Local', icon: '🏬' },
  { id: 'oficina', label: 'Oficina', icon: '💼' }, { id: 'cochera', label: 'Cochera', icon: '🚗' }, { id: 'terreno', label: 'Terreno', icon: '🌳' },
  { id: 'campo', label: 'Campo', icon: '🌾' }, { id: 'financiera', label: 'Inversión financiera', icon: '📈' }, { id: 'otro', label: 'Otra', icon: '📁' },
];
export const INVESTMENT_STATUS = ['alquilada', 'disponible', 'uso propio', 'en obra', 'en venta', 'vendida'];
export const CONTRACT_KINDS = ['alquiler', 'administración', 'seguro', 'compraventa', 'servicio', 'otro'];
export const CONTRACT_FREQ = ['mensual', 'bimestral', 'trimestral', 'semestral', 'anual', 'única vez'];
export const TAX_PRESETS = ['ABL', 'Inmobiliario (ARBA)', 'Expensas', 'Tasa municipal', 'Bienes personales', 'Agua', 'Luz', 'Gas', 'Seguro', 'Otro'];
export const kindIcon = (k?: string) => INVESTMENT_KINDS.find((x) => x.id === k)?.icon ?? '📁';
export const kindLabel = (k?: string) => INVESTMENT_KINDS.find((x) => x.id === k)?.label ?? 'Otra';

/** Estado efectivo de un contrato según su fecha de fin. */
export function contractStatus(c: InvestmentContract, ref: ISODate = today()): string {
  if (c.status === 'rescindido') return 'rescindido';
  if (c.endDate && c.endDate < ref) return 'vencido';
  if (c.endDate && diffDays(c.endDate, ref) <= 60) return 'por vencer';
  return 'vigente';
}
export function taxStatus(t: InvestmentTax, ref: ISODate = today()): string {
  if (t.status === 'pagado') return 'pagado';
  if (t.dueDate && t.dueDate < ref) return 'vencido';
  return 'pendiente';
}

export interface InvestmentSummary {
  inv: Investment; contracts: InvestmentContract[]; taxes: InvestmentTax[]; works: InvestmentWork[];
  rent?: InvestmentContract; nextTax?: InvestmentTax; overdueTaxes: InvestmentTax[]; endingContracts: InvestmentContract[]; openWorks: InvestmentWork[];
}

export function summarize(inv: Investment, contracts: InvestmentContract[], taxes: InvestmentTax[], works: InvestmentWork[], ref: ISODate = today()): InvestmentSummary {
  const c = contracts.filter((x) => !x.deleted && x.investmentId === inv.id);
  const t = taxes.filter((x) => !x.deleted && x.investmentId === inv.id);
  const w = works.filter((x) => !x.deleted && x.investmentId === inv.id);
  const pending = t.filter((x) => x.status !== 'pagado').sort((a, b) => ((a.dueDate ?? '9') < (b.dueDate ?? '9') ? -1 : 1));
  return {
    inv, contracts: c, taxes: t, works: w,
    rent: c.find((x) => x.kind === 'alquiler' && ['vigente', 'por vencer'].includes(contractStatus(x, ref))),
    nextTax: pending[0],
    overdueTaxes: pending.filter((x) => taxStatus(x, ref) === 'vencido'),
    endingContracts: c.filter((x) => contractStatus(x, ref) === 'por vencer'),
    openWorks: w.filter((x) => x.status !== 'terminado'),
  };
}

/** Ingreso mensual estimado de alquileres vigentes, por moneda. */
export function monthlyRent(summaries: InvestmentSummary[]): Record<string, number> {
  const out: Record<string, number> = {};
  const factor: Record<string, number> = { mensual: 1, bimestral: 1 / 2, trimestral: 1 / 3, semestral: 1 / 6, anual: 1 / 12 };
  for (const s of summaries) {
    if (!s.rent?.amount) continue;
    out[s.rent.currency] = (out[s.rent.currency] ?? 0) + s.rent.amount * (factor[s.rent.frequency ?? 'mensual'] ?? 1);
  }
  return out;
}

export async function markTaxPaid(repo: Repo, id: ID, input: { paidDate?: ISODate; amount?: number; by?: ID }) {
  const t = await repo.get('investmentTaxes', id);
  if (!t) throw new Error('Impuesto inexistente');
  return repo.update('investmentTaxes', id, { status: 'pagado', paidDate: input.paidDate ?? today(), amount: input.amount ?? t.amount }, { by: input.by, historyAction: 'completar' });
}

/** Próximo vencimiento del mismo impuesto (para cargar el período siguiente rápido). */
export function nextPeriodDraft(t: InvestmentTax): Partial<InvestmentTax> {
  return { investmentId: t.investmentId, tax: t.tax, currency: t.currency, accountNumber: t.accountNumber, amount: t.amount, status: 'pendiente', dueDate: t.dueDate ? addMonths(t.dueDate, 1) : undefined };
}
