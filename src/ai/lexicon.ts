// Vocabulario para la clasificación por reglas (texto ya normalizado: minúsculas y sin tildes).
import type { ProposalKind } from './types';

export const KIND_KEYWORDS: Partial<Record<ProposalKind, string[]>> = {
  evento: [
    'reunion', 'turno', 'cita', 'cumple', 'cumpleanos', 'acto', 'fiesta', 'partido', 'torneo', 'entrenamiento', 'clase de', 'ensayo',
    'muestra', 'excursion', 'salida', 'viaje', 'vacuna', 'dentista', 'pediatra', 'medico', 'oculista', 'consulta medica', 'cena',
    'almuerzo', 'asado', 'casamiento', 'bautismo', 'recital', 'cine', 'kermesse', 'jornada', 'entrevista', 'visita', 'vienen',
    'evento', 'agenda', 'agendar', 'agendá', 'campamento', 'colonia', 'graduacion', 'egreso', 'misa',
  ],
  tarea: [
    'hay que', 'tenemos que', 'tengo que', 'tiene que', 'tienen que', 'acordarse', 'acordate', 'recordar', 'recordame', 'no olvidar',
    'no te olvides', 'no se olviden', 'limpiar', 'lavar', 'planchar', 'ordenar', 'barrer', 'aspirar', 'cortar el pasto', 'regar',
    'sacar la basura', 'llevar', 'pasar a buscar', 'buscar a', 'llamar', 'preparar', 'armar', 'renovar', 'tramitar', 'sacar turno',
    'pedir', 'mandar', 'enviar', 'imprimir', 'firmar', 'completar', 'tarea', 'colgar la ropa', 'doblar', 'cocinar', 'hacer',
    'devolver', 'reservar', 'inscribir', 'anotar a', 'cambiar',
  ],
  compra: [
    'comprar', 'compras', 'falta', 'faltan', 'se acabo', 'se termino', 'no hay mas', 'no queda', 'quedan pocos', 'traer', 'lista del super',
    'lista de compras', 'supermercado', 'super', 'anota en la lista', 'agrega a la lista', 'reponer', 'chino', 'verduleria', 'carniceria',
  ],
  pago: [
    'pagar', 'vence', 'vencimiento', 'vto', 'factura', 'boleta', 'cuota', 'abono', 'expensas', 'impuesto', 'abl', 'patente', 'monotributo',
    'resumen de la tarjeta', 'tarjeta', 'alquiler', 'prepaga', 'obra social', 'matricula', 'seguro', 'debito automatico', 'deuda', 'a pagar',
  ],
  gasto: [
    'gaste', 'gastamos', 'gasto', 'pague', 'pagamos', 'pago la', 'compre', 'compramos', 'me salio', 'salio', 'costo', 'me cobraron',
    'nos cobraron', 'abonamos', 'aboné', 'transferi', 'le di', 'le pague',
  ],
  reparacion: [
    'se rompio', 'roto', 'rota', 'no anda', 'no funciona', 'dejo de funcionar', 'pierde agua', 'pierde', 'gotea', 'perdida de', 'arreglar',
    'reparar', 'reparacion', 'tecnico', 'plomero', 'electricista', 'gasista', 'cerrajero', 'se quemo', 'hace ruido', 'se tapo', 'tapado',
    'humedad', 'filtracion', 'averia',
  ],
  mantenimiento: [
    'mantenimiento', 'service', 'cambiar filtro', 'cambiar el filtro', 'limpiar filtro', 'limpiar el filtro', 'revisar', 'revision',
    'purgar', 'desinfectar', 'fumigar', 'poda', 'podar', 'limpiar la pileta', 'clorar', 'cloro', 'limpiar canaletas', 'matafuego',
  ],
  nota: ['estaria bueno', 'podriamos', 'quizas', 'tal vez', 'a lo mejor', 'habria que ver', 'pensar en', 'idea', 'nota', 'anotar que', 'dato'],
};

export const PAST_PAY = /\b(pague|pagamos|gaste|gastamos|compre|compramos|abonamos|abone|transferi|me cobraron|nos cobraron|me salio|nos salio|costo)\b/;
export const DUE_WORDS = /\b(vence|vencimiento|vto|a pagar|hay que pagar|tenemos que pagar|pagar)\b/;
export const QUESTION_START = /^\s*(¿|cuando|cuándo|donde|dónde|cuanto|cuánto|quien|quién|que dia|qué día|a que hora|a qué hora|como|cómo|por que|por qué|sabes|saben|alguien sabe)\b/i;

export const EVENT_CATEGORY: [RegExp, string][] = [
  [/\b(cumple|cumpleanos)\b/, 'cumpleanos'],
  [/\b(colegio|escuela|jardin|maestra|seno|profe|acto|reunion de padres|boletin|aula|grado|kermesse|egreso)\b/, 'colegio'],
  [/\b(medico|pediatra|dentista|odontologo|vacuna|analisis|oculista|guardia|kinesiologo|psicologo|salud|control)\b/, 'salud'],
  [/\b(turno)\b/, 'turnos'],
  [/\b(futbol|natacion|danza|baile|clase|entrenamiento|partido|torneo|ingles|musica|guitarra|piano|hockey|rugby|tenis|club|gimnasia|patin)\b/, 'actividades'],
  [/\b(tramite|registro|banco|escribania|afip|arca|renaper|dni|pasaporte|municipalidad)\b/, 'tramites'],
  [/\b(reunion|junta|zoom|meet)\b/, 'reuniones'],
  [/\b(abuela|abuelo|tio|tia|primos|primo|prima|familia|asado|almuerzo|cena|visita)\b/, 'familia'],
];
export const TASK_CATEGORY: [RegExp, string][] = [
  [/\b(pileta|piscina|cloro)\b/, 'pileta'],
  [/\b(ropa|planchar|colgar|doblar|lavarropas|secarropas)\b/, 'ropa'],
  [/\b(cocinar|cocina|platos|vianda|comida|cena|almuerzo|heladera)\b/, 'cocina'],
  [/\b(limpiar|barrer|trapear|aspirar|bano|vidrios|polvo|basura|residuos)\b/, 'limpieza'],
  [/\b(ordenar|guardar|acomodar|placard|juguetes)\b/, 'orden'],
  [/\b(pasto|patio|regar|jardin|plantas|hojas|canaletas|parrilla)\b/, 'patio'],
  [/\b(arreglar|reparar|lamparita|pintar|filtro|service|mantenimiento|canilla)\b/, 'mantenimiento'],
  [/\b(tramite|renovar|turno|banco|firmar|imprimir|inscribir|formulario|dni|registro)\b/, 'tramites'],
  [/\b(abuela|abuelo|familia|cumple|regalo|llevar a|buscar a)\b/, 'familia'],
];
export const PAYMENT_CATEGORY: [RegExp, string][] = [
  [/\b(luz|gas|agua|internet|telefono|celular|cable|edenor|edesur|edelap|metrogas|naturgy|camuzzi|aysa|absa|telecentro|fibertel|movistar|personal|claro|flow|directv)\b/, 'servicios'],
  [/\b(impuesto|abl|patente|arba|agip|monotributo|ganancias|inmobiliario|tasa municipal|arca|afip)\b/, 'impuestos'],
  [/\b(alquiler|expensas|hipoteca|credito hipotecario)\b/, 'vivienda'],
  [/\b(colegio|escuela|matricula|cuota escolar|comedor)\b/, 'colegio'],
  [/\b(prepaga|obra social|osde|swiss|galeno|medife|omint|farmacia)\b/, 'salud'],
  [/\b(seguro|poliza)\b/, 'seguros'],
  [/\b(tarjeta|visa|mastercard|amex|resumen)\b/, 'tarjetas'],
  [/\b(club|futbol|natacion|gimnasio|danza|ingles|actividad)\b/, 'actividades'],
];
export const EXPENSE_CATEGORY: [RegExp, string][] = [
  [/\b(super|supermercado|verduleria|carniceria|almacen|chino|mercado|comida)\b/, 'supermercado'],
  ...PAYMENT_CATEGORY.filter(([, c]) => ['servicios', 'impuestos', 'vivienda', 'colegio', 'salud'].includes(c)),
  [/\b(nafta|combustible|colectivo|sube|uber|taxi|peaje|estacionamiento|auto)\b/, 'transporte'],
  [/\b(plomero|electricista|gasista|arreglo|reparacion|ferreteria|pintura|tecnico)\b/, 'mantenimiento'],
  [/\b(cine|salida|restaurante|delivery|helado|regalo|juguete)\b/, 'ocio'],
  [/\b(ropa|zapatillas|remera|pantalon|buzo|guardapolvo)\b/, 'ropa'],
];
export const DOC_CATEGORY: [RegExp, string][] = [
  [/\b(dni|documento nacional|pasaporte|cuil|cuit|licencia de conducir|registro de conducir)\b/, 'identidad'],
  [/\b(obra social|prepaga|osde|swiss|galeno|medife|omint|credencial|estudios|analisis|receta|historia clinica|vacunas|certificado medico)\b/, 'salud'],
  [/\b(cedula verde|cedula azul|titulo del auto|vtv|seguro del auto)\b/, 'vehiculos'],
  [/\b(arba|agip|abl|monotributo|ganancias|bienes personales|afip|arca|ddjj|declaracion jurada)\b/, 'impuestos'],
  [/\b(garantia)\b/, 'garantias'],
  [/\b(manual|instructivo)\b/, 'manuales'],
  [/\b(factura|boleta|liquidacion)\b/, 'facturas'],
  [/\b(recibo|comprobante|transferencia|ticket|constancia de pago)\b/, 'comprobantes'],
  [/\b(contrato|locacion)\b/, 'contratos'],
  [/\b(poliza|seguro)\b/, 'seguros'],
  [/\b(partida|certificado|acta|libreta de familia|carnet)\b/, 'familia'],
  [/\b(boletin|colegio|escuela|autorizacion|libreta|inscripcion)\b/, 'colegio'],
  [/\b(club|actividad|federacion|apto fisico)\b/, 'actividades'],
  [/\b(escritura|plano|vivienda|inmueble)\b/, 'vivienda'],
  [/\b(luz|gas|agua|internet|telefono|servicio)\b/, 'servicios'],
];
export const MAINT_CATEGORY: [RegExp, string][] = [
  [/\b(pileta|piscina|cloro)\b/, 'pileta'],
  [/\b(heladera|lavarropas|aire|split|horno|microondas|lavavajillas|calefon|termotanque)\b/, 'electrodomesticos'],
  [/\b(caldera|canerias|electricidad|tablero|gas|tanque|bomba|instalacion)\b/, 'instalaciones'],
  [/\b(invierno|verano|otono|primavera|canaletas|poda|podar|estacion)\b/, 'estacional'],
  [/\b(limpiar|limpieza)\b/, 'limpieza'],
];

export const SHOP_CATEGORY: [RegExp, string][] = [
  [/\b(lavandina|detergente|jabon en polvo|jabon liquido para ropa|suavizante|esponja|trapo|rejilla|bolsas de residuo|bolsas de basura|desengrasante|limpiador|cif|mr musculo|virulana|escoba|secador|lustramuebles|insecticida)\b/, 'limpieza'],
  [/\b(shampoo|champu|acondicionador|pasta dental|dentifrico|cepillo de dientes|desodorante|papel higienico|toallitas|panales|algodon|jabon|crema|maquinita|toallas femeninas|hilo dental)\b/, 'higiene'],
  [/\b(tornillo|tornillos|clavos|lamparita|lamparitas|cinta|pintura|pegamento|pilas|pila|enchufe|zapatilla electrica|cable|cuerito|tarugos|lija|silicona|cemento|arena|ladrillos?|membrana|ceramicos?|pastina|griferia|durlock)\b/, 'ferreteria'],
  [/\b(ibuprofeno|paracetamol|curitas|alcohol|remedio|remedios|aspirina|termometro|gasas|antitermico|jarabe|vitaminas|repelente|protector solar)\b/, 'farmacia'],
  [/\b(cuaderno|cuadernos|lapiz|lapices|birome|biromes|carpeta|plasticola|goma|regla|mochila|cartuchera|fotocopias|hojas|tijera|marcadores|crayones|repuesto|utiles|resaltador|cartulina|libro|libros|sobres|papel glase|fibras)\b/, 'libreria'],
  [/\b(medias|remera|zapatillas|pantalon|buzo|guardapolvo|campera|calzoncillos|bombacha|jogging|ojotas|zapatos|botas|botines|sandalias|pantuflas|calzado)\b/, 'ropa'],
];

export const STOP_FILLERS = /\b(hay que|tenemos que|tengo que|tiene que|tienen que|acordate de|acordarse de|acordate|recordar|recordame|recorda|no olvidar|no te olvides de|no te olvides|no se olviden de|por favor|porfa|che|ojo que|ojo|tambien|ademas|despues|luego)\b/g;
