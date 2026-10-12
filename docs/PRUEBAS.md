# Pruebas: qué se ejecutó y con qué resultado

Fecha de la ejecución final: 11/10/2026, Windows 11, Node 24.19, Chromium (Playwright 1.49).

| Conjunto | Herramienta | Resultado |
| --- | --- | --- |
| Unitarias, funcionales, asistente, sincronización, Drive y planillas | Vitest (`npm test`) | **86 aprobadas, 0 fallidas** (+1 de OCR real que se ejecuta con `REAL_OCR=1` y pasó) |
| Interfaz en navegador real (celular Pixel 7 y computadora 1280×820) | Playwright (`npm run e2e`) | **23 aprobadas, 0 fallidas, 1 omitida a propósito** (teclado físico solo en computadora) |
| Verificación de tipos | `tsc -b` | Sin errores |
| Compilación PWA | `npm run build` | Correcta (63 recursos precargados, ~2,7 MB) |

Las pruebas no usan datos reales de la familia. El backend se probó ejecutando el **código real de `apps-script/`**
dentro de Node sobre una emulación en memoria de Sheets, Drive, Calendar, Gmail, propiedades y bloqueos
(`tests/gas-harness.ts`). La emulación es estricta en lo que importa (rangos fuera de las dimensiones de la hoja,
fórmulas, ida y vuelta por JSON, fallas de red antes y después de que el servidor guarde).

## Cobertura de lo pedido

### Funcionales
| Requisito | Prueba |
| --- | --- |
| Crear, editar y completar una tarea | functional › Tareas (historial y autor) · e2e › crear una tarea y conservarla al recargar |
| Tarea recurrente | functional › tarea recurrente (siguiente ocurrencia, editar una o la serie) · sync › ocurrencias en dos dispositivos sin duplicar |
| Crear y modificar un evento | functional › Agenda · e2e › asistente (evento visible en la vista mensual) |
| Registrar una compra | functional › Compras (duplicados y fusión, listas habituales) |
| Registrar un gasto | functional › Economía › registra un gasto |
| Crear y confirmar un pago | functional › un solo gasto vinculado, sin duplicar al reintentar; pagos recurrentes |
| Cargar un documento | functional › Documentos · e2e › documentos privados ocultos para chicos |
| Reparación y factura vinculada | functional › reparación genera tarea y la factura se vincula al gasto sin duplicar |
| Perfil Familia | functional › ve lo de todos sin economía · e2e › Inicio y Agenda con lo de todos |
| Pedidos de los chicos | functional › quedan con quién lo pidió · e2e › Hija pide algo para el colegio |
| Carpetas existentes de Drive | drive-sheets › adopta Documentos, Gastos Mensuales casa, Inversiones, Peques y Reforma sin duplicar ni renombrar; una segunda inicialización no duplica |
| Planillas editables a mano | drive-sheets › fila cargada en Sheets llega a la app (fechas y montos argentinos, persona por nombre); fila incompleta no se publica; borrar/Eliminado; borrado masivo bloqueado |
| Archivos en su carpeta | drive-sheets › Documentos/<persona>, Peques/<nombre>, Comprobantes/<mes>, Inversiones/<propiedad>/Contratos; reclasificar mueve el archivo |
| Inversiones | drive-sheets › subcarpetas → inversiones, carpeta nueva desde la app, resumen por propiedad · e2e › impuesto pagado; oculto para chicos |
| Cambiar de perfil | e2e › perfil infantil (cambio a adulto) · functional › el perfil cambia búsqueda y avisos |
| Filtros y búsquedas | functional › filtra tareas; búsqueda global por perfil |
| Exportar y restaurar | functional › exporta, detecta copias alteradas/incompletas y restaura con archivos · e2e › exportar y restaurar desde la interfaz |

### Asistente
| Requisito | Prueba |
| --- | --- |
| Interpretar una nota de texto | ai › interpreta una nota de texto |
| Procesar una captura | ai › captura con OCR propone productos · **OCR real con Tesseract.js sobre una imagen** |
| Procesar un audio compatible | ai › audio con transcripción local (transcriptor simulado) y audio sin transcripción |
| Varias acciones en una entrada | ai › separa varias acciones · e2e › 4 propuestas en una captura |
| Campos faltantes | ai › detecta campos faltantes |
| Ambigüedades | ai › presenta ambigüedades · e2e › confirmación bloqueada hasta elegir 17:00 |
| Editar una propuesta | ai › cambiar el tipo conserva los datos y recalcula faltantes |
| Cancelar sin guardar | ai › cancelar no guarda nada · e2e › cancelar no guarda nada |
| Confirmar antes de guardar | ai › interpretar no guarda; confirmar sí, con historial de decisiones |
| Posibles duplicados | ai › exige decidir vincular/actualizar/crear · gasto ↔ pago pendiente |
| IA deshabilitada | ai › modo manual · el modelo local caído vuelve a reglas |

### Sincronización
| Requisito | Prueba |
| --- | --- |
| Crear datos sin conexión | sync › crea sin conexión y envía al volver · e2e › PWA sin conexión (crear tarea offline) |
| Recuperar la conexión | sync › mismo caso, y el segundo dispositivo recibe el dato |
| Reintentar una operación fallida | sync › falla antes de llegar al servidor → error → reintento |
| Evitar duplicados | sync › respuesta perdida tras guardar → reintento reconocido como duplicado (1 fila, versión 1); inicialización en dos dispositivos; ocurrencias deterministas; archivos por hash |
| Detectar conflictos | sync › conflicto sin sobrescribir + resolución; fusión automática de campos distintos; Calendar con cambios en ambos lados |
| Interrupción durante el guardado | sync › transacción interrumpida no deja datos a medias; respuesta perdida |
| Recuperación desde copia | sync › copia en Drive verificada, restauración en el servidor y resincronización de dispositivos; copia incompleta rechazada |

### Interfaz
| Requisito | Prueba |
| --- | --- |
| Uso en celular | e2e [celular] › navegación inferior de 5 opciones + "Más", sin desbordes en 12 pantallas |
| Uso en computadora | e2e [computadora] › menú lateral, sin desbordes |
| Instalación como PWA | e2e › manifiesto (nombre, íconos 192/512/maskable, standalone, share_target) y service worker controlando la página |
| Navegación por teclado | e2e › enlace "Saltar al contenido", abrir/cerrar hoja con teclado y retorno del foco, botones solo-ícono con nombre accesible |
| Estados vacíos y errores | e2e › "Todavía no hay tareas", validación visible ("Falta el título"), confirmaciones ("Tarea creada") |
| Formularios y confirmaciones | e2e › formularios de tarea, documento, restauración con confirmación |
| Cambios de perfil | e2e › perfil infantil → adulto |
| Permisos y acceso a documentos | e2e › economía y copias bloqueadas para chicos; facturas ocultas para chicos |

## Lo que NO se pudo ejecutar (y por qué)

| Qué | Motivo | Cómo verificarlo |
| --- | --- | --- |
| Conexión con la cuenta real de Google (Sheets, Drive, Calendar, Gmail, Forms) | Requiere la autorización de la cuenta de Google de la familia | Seguir [GOOGLE_SETUP.md](GOOGLE_SETUP.md) y revisar Ajustes → Google → Estado |
| Instalación en un celular físico (Android/iPhone) y "Compartir con Hogar" desde WhatsApp | No hay dispositivo físico en el entorno; se usó la emulación de Pixel 7 de Chromium | Instalar desde la dirección publicada y compartir un mensaje |
| Grabación con micrófono y dictado del navegador | Sin micrófono en la automatización | Probar "Grabar voz" en el celular |
| Transcripción con Whisper en el navegador | Descarga ~80 MB y necesita WebAssembly/WebGPU; se probó el flujo con un transcriptor simulado | Activarla en Ajustes → Asistente y adjuntar un audio |
| Modelo local (Ollama) | No hay un servidor local instalado; se probó el mapeo de respuestas y la vuelta a reglas | Configurar el endpoint y "Probar conexión" |
| Notificaciones del sistema visibles | El navegador automatizado no muestra notificaciones | Ajustes → Notificaciones → Permitir → Probar |
| Safari y Firefox | Solo se automatizó Chromium | Abrir la app en esos navegadores |

## Observaciones

- En una de las primeras ejecuciones de interfaz, la pantalla de Compras quedó una vez en "Cargando…" mientras el service
  worker descargaba la precarga. No se reprodujo en las ejecuciones siguientes (más de 60 corridas de pruebas de interfaz).
  Como resguardo, la pantalla de carga ofrece "Está tardando: recargar" a los 10 segundos y los fragmentos que fallan al
  cargarse provocan una recarga automática única.
- Las pruebas encontraron y permitieron corregir: el registro del service worker que solo ocurría después de elegir perfil,
  botones anidados dentro de filas clicables (accesibilidad), escritura fuera de las dimensiones de las hojas de Google
  (hojas nuevas de 26 columnas), textos con apóstrofo inicial en Sheets, singulares de productos ("leches"), facturas leídas
  como frases sueltas y la hora "a las 9 de la noche".
