// Catálogos iniciales. Son valores por defecto: las categorías se editan en Ajustes y se guardan en la entidad `config`.

export type CategoryModule = 'events' | 'tasks' | 'shopping' | 'payments' | 'expenses' | 'documents' | 'assets' | 'maintenance';

export interface Category { id: string; label: string; color: string }

const c = (id: string, label: string, color: string): Category => ({ id, label, color });

// Paleta suave (fondos de chips). El texto siempre es oscuro para mantener contraste.
export const SOFT = {
  gray: '#e7e5e4', blue: '#dbeafe', sky: '#e0f2fe', green: '#dcfce7', lime: '#ecfccb', amber: '#fef3c7',
  orange: '#ffedd5', rose: '#ffe4e6', pink: '#fce7f3', violet: '#ede9fe', teal: '#ccfbf1', stone: '#f5f5f4',
};

export const DEFAULT_CATEGORIES: Record<CategoryModule, Category[]> = {
  events: [
    c('colegio', 'Colegio', SOFT.blue), c('actividades', 'Actividades', SOFT.green), c('turnos', 'Turnos', SOFT.teal),
    c('salud', 'Salud', SOFT.rose), c('tramites', 'Trámites', SOFT.amber), c('reuniones', 'Reuniones', SOFT.violet),
    c('cumpleanos', 'Cumpleaños', SOFT.pink), c('familia', 'Familia', SOFT.orange), c('otros', 'Otros', SOFT.gray),
  ],
  tasks: [
    c('limpieza', 'Limpieza', SOFT.sky), c('ropa', 'Ropa', SOFT.violet), c('cocina', 'Cocina', SOFT.orange),
    c('orden', 'Orden', SOFT.stone), c('patio', 'Patio', SOFT.lime), c('pileta', 'Pileta', SOFT.blue),
    c('mantenimiento', 'Mantenimiento', SOFT.amber), c('tramites', 'Trámites', SOFT.teal), c('familia', 'Familia', SOFT.pink),
    c('otras', 'Otras', SOFT.gray),
  ],
  shopping: [
    c('supermercado', 'Supermercado', SOFT.green), c('limpieza', 'Limpieza', SOFT.sky), c('higiene', 'Higiene', SOFT.teal),
    c('ferreteria', 'Ferretería', SOFT.amber), c('farmacia', 'Farmacia', SOFT.rose), c('colegio', 'Colegio', SOFT.blue),
    c('ropa', 'Ropa', SOFT.violet), c('otras', 'Otras', SOFT.gray),
  ],
  payments: [
    c('servicios', 'Servicios', SOFT.sky), c('impuestos', 'Impuestos', SOFT.amber), c('vivienda', 'Vivienda', SOFT.stone),
    c('colegio', 'Colegio', SOFT.blue), c('salud', 'Salud', SOFT.rose), c('seguros', 'Seguros', SOFT.teal),
    c('tarjetas', 'Tarjetas', SOFT.violet), c('actividades', 'Actividades', SOFT.green), c('otros', 'Otros', SOFT.gray),
  ],
  expenses: [
    c('supermercado', 'Supermercado', SOFT.green), c('servicios', 'Servicios', SOFT.sky), c('impuestos', 'Impuestos', SOFT.amber),
    c('vivienda', 'Vivienda', SOFT.stone), c('mantenimiento', 'Mantenimiento', SOFT.orange), c('colegio', 'Colegio', SOFT.blue),
    c('salud', 'Salud', SOFT.rose), c('transporte', 'Transporte', SOFT.lime), c('ocio', 'Ocio', SOFT.pink),
    c('ropa', 'Ropa', SOFT.violet), c('otros', 'Otros', SOFT.gray),
  ],
  documents: [
    c('identidad', 'Identidad (DNI, pasaporte)', SOFT.blue), c('salud', 'Salud y obra social', SOFT.rose),
    c('vehiculos', 'Vehículos', SOFT.lime), c('impuestos', 'Impuestos', SOFT.amber),
    c('vivienda', 'Vivienda', SOFT.stone), c('servicios', 'Servicios', SOFT.sky), c('facturas', 'Facturas', SOFT.amber),
    c('comprobantes', 'Comprobantes', SOFT.lime), c('garantias', 'Garantías', SOFT.teal), c('manuales', 'Manuales', SOFT.orange),
    c('colegio', 'Colegio', SOFT.blue), c('actividades', 'Actividades', SOFT.green), c('contratos', 'Contratos', SOFT.violet),
    c('seguros', 'Seguros', SOFT.rose), c('familia', 'Documentación familiar', SOFT.pink), c('otros', 'Otros', SOFT.gray),
  ],
  assets: [
    c('electrodomesticos', 'Electrodomésticos', SOFT.sky), c('instalaciones', 'Instalaciones', SOFT.amber),
    c('equipamiento', 'Equipamiento', SOFT.stone), c('servicios', 'Servicios', SOFT.teal), c('pileta', 'Pileta', SOFT.blue),
    c('jardin', 'Jardín', SOFT.lime), c('vehiculos', 'Vehículos', SOFT.violet), c('otros', 'Otros', SOFT.gray),
  ],
  maintenance: [
    c('limpieza', 'Limpieza', SOFT.sky), c('preventivo', 'Mantenimiento preventivo', SOFT.amber), c('pileta', 'Pileta', SOFT.blue),
    c('electrodomesticos', 'Electrodomésticos', SOFT.teal), c('instalaciones', 'Instalaciones', SOFT.orange),
    c('estacional', 'Trabajos estacionales', SOFT.lime), c('otros', 'Otros', SOFT.gray),
  ],
};

/** Documentos de estas categorías se crean por defecto con visibilidad "solo adultos". */
export const SENSITIVE_DOC_CATEGORIES = ['identidad', 'salud', 'impuestos', 'vehiculos', 'facturas', 'comprobantes', 'contratos', 'seguros', 'familia', 'servicios', 'vivienda'];

export const TASK_STATUS_LABEL: Record<string, string> = { pendiente: 'Pendiente', en_curso: 'En curso', bloqueada: 'Bloqueada', completada: 'Completada' };
export const PRIORITY_LABEL: Record<string, string> = { baja: 'Baja', media: 'Media', alta: 'Alta' };
export const PAYMENT_STATUS_LABEL: Record<string, string> = { pendiente: 'Pendiente', programado: 'Programado', pagado: 'Pagado', vencido: 'Vencido' };
export const REPAIR_STATUS_LABEL: Record<string, string> = { reportada: 'Reportada', en_curso: 'En curso', resuelta: 'Resuelta' };
export const RSVP_LABEL: Record<string, string> = { pendiente: 'Sin confirmar', confirmado: 'Confirmado', rechazado: 'No asiste' };
export const VISIBILITY_LABEL: Record<string, string> = { familia: 'Toda la familia', adultos: 'Solo adultos', personal: 'Personal' };
export const CURRENCIES = ['ARS', 'USD', 'EUR'];
export const UNITS = ['u', 'kg', 'g', 'l', 'ml', 'paq', 'caja', 'docena'];
export const PAYMENT_METHODS = ['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Débito automático', 'Billetera virtual', 'Otro'];

export const PROFILE_COLORS = ['#626b71', '#b1afb6', '#8c8e84', '#c4b9c0', '#c2bbb4', '#9fb1c2', '#c9b79c', '#a7b8a8'];

export const ENTITY_LABEL: Record<string, string> = {
  tasks: 'Tarea', events: 'Evento', shoppingItems: 'Compra', shoppingLists: 'Lista', payments: 'Pago', expenses: 'Gasto',
  documents: 'Documento', repairs: 'Reparación', maintenance: 'Mantenimiento', assets: 'Elemento de la casa', rooms: 'Ambiente',
  providers: 'Proveedor', notes: 'Nota', profiles: 'Perfil', captures: 'Captura', attachments: 'Archivo', config: 'Configuración',
  household: 'Hogar', history: 'Historial', investments: 'Inversión', investmentContracts: 'Contrato', investmentTaxes: 'Impuesto',
  investmentWorks: 'Mantenimiento de inversión',
};
