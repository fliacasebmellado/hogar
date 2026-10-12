# Integraciones, limitaciones y costos

## Estado de las integraciones

| Integración | Estado en el código | Qué falta para usarla | Alternativa mientras tanto |
| --- | --- | --- | --- |
| Google Sheets (datos) | Implementada y probada contra un emulador de Apps Script | Crear e implementar el script en la cuenta familiar ([GOOGLE_SETUP.md](GOOGLE_SETUP.md)) | Todo funciona en un dispositivo; exportar/importar copias para pasar datos |
| Google Drive (archivos y copias) | Implementada y probada en emulador | Igual que arriba | Archivos guardados en el dispositivo; exportación con archivos |
| Google Calendar | Implementada (bidireccional con reglas de conflicto), probada en emulador | Igual que arriba; marcar los eventos a sincronizar | Agenda interna de la app |
| Gmail (solo lectura) | Implementada, desactivada por defecto, probada en emulador | Habilitarla en la app | Copiar y pegar el texto del correo en el Asistente |
| Google Forms | Implementada vía hoja vinculada (sin API), probada en emulador | Vincular el formulario a la planilla | Pegar respuestas en el Asistente |
| OCR de imágenes (Tesseract.js) | Implementada y probada con OCR real sobre una imagen | Nada (descarga ~5 MB la primera vez) | Escribir el texto de la captura |
| Texto de PDF (pdf.js) | Implementada | Nada | Escribir los datos |
| Dictado del navegador | Implementado (opcional) | Navegador compatible (Chrome/Edge/Android) | Grabar el audio y escribir lo que dice |
| Transcripción local de audios (Whisper) | Implementada, **experimental**, no probada en celulares reales | Activarla; descarga ~80 MB | Escribir lo que dice el audio |
| Modelo de lenguaje local (Ollama u otro compatible) | Implementado, opcional | Un servidor local con CORS y, desde la app publicada, HTTPS | Reglas locales (siempre disponibles) |
| Compartir desde otras apps (Web Share Target) | Implementado en el manifiesto y el service worker | App instalada en Android/Chrome. iPhone no lo admite para PWA | Copiar y pegar / adjuntar desde el Asistente |
| Notificaciones del sistema | Implementadas mientras la app está abierta o en segundo plano reciente | Permiso del navegador | Centro de avisos de la app + recordatorios de Google Calendar |

**Importante:** las integraciones con Google se verificaron ejecutando el código real del backend sobre una emulación en
memoria de los servicios de Google. No se pudieron probar contra la cuenta real porque requieren su autorización. La
primera conexión real debe seguir la guía y verificar el estado en Ajustes → Google.

## Limitaciones técnicas

- **Perfiles sin autenticación individual:** cualquiera con el dispositivo puede cambiar de perfil; el PIN solo disuade.
- **Token compartido:** quien tenga la URL y el token puede leer y escribir los datos del hogar. Si se filtra, rotarlo con
  `generarToken`.
- **Notificaciones con la app cerrada no son fiables:** sin un servidor push (que no se incluye para mantener costo cero)
  el navegador no garantiza avisos con la app cerrada, sobre todo en iPhone. Usar Google Calendar para avisos críticos.
- **Sincronización en segundo plano:** ocurre al abrir la app, al volver la conexión y periódicamente con la app abierta.
  No hay sincronización con la app cerrada.
- **Archivos sin conexión:** solo están disponibles los archivos guardados en ese dispositivo (los cargados ahí o
  descargados con "Guardar sin conexión"). Los de otros dispositivos se ven en Drive con conexión.
- **Interpretación por reglas:** entiende frases frecuentes del español rioplatense; no entiende cualquier redacción.
  Lo que no entiende se marca como faltante o ambiguo, nunca se guarda solo. Horas de 1 a 7 sin "de la mañana/tarde"
  siempre se preguntan; de 8 a 11 se asumen de la mañana.
- **OCR:** depende de la calidad de la imagen; letra manuscrita o fotos oblicuas pueden fallar.
- **Audios de WhatsApp (.opus):** el dictado del navegador no transcribe archivos; Whisper local depende de que el
  navegador decodifique el formato (Chrome sí; Safari puede no hacerlo).
- **Google Sheets no es una base transaccional:** por eso hay bloqueo, versiones, `opId` e historial. El registro `_ops` se
  depura a los 60 días: un dispositivo que reintente una operación de hace más de 60 días podría generar un conflicto (no
  un duplicado silencioso, porque la versión no coincide).
- **Cuotas de Google:** ver [GOOGLE_SETUP.md](GOOGLE_SETUP.md#cuotas-gratuitas-aproximadas-pueden-cambiar). Son
  holgadas para una familia, pero Google puede cambiarlas.
- **Recurrencias de eventos:** se editan como serie completa (como en la agenda interna); las tareas sí permiten editar una
  ocurrencia o toda la serie.
- **Tamaño de archivos:** 15 MB por archivo en la app (20 MB en el backend).

## Costos recurrentes

| Componente | Tipo | Costo esperado |
| --- | --- | --- |
| Código de la app y bibliotecas (React, Dexie, Tesseract.js, pdf.js, Workbox, lucide, Inter) | Software libre | $0 |
| GitHub Pages (repositorio público) | Servicio gratuito con límites (1 GB de sitio, 100 GB/mes de tráfico, sujetos a cambios) | $0 |
| Google Apps Script, Sheets, Drive, Calendar, Gmail, Forms | Cuotas gratuitas de una cuenta personal | $0 mientras se respeten cuotas y almacenamiento |
| Almacenamiento de Google | 15 GB gratis compartidos con Gmail y Fotos | $0; si se llena habría que liberar espacio o pagar Google One (no requerido) |
| CDN públicos (jsDelivr, Hugging Face) para OCR/Whisper | Gratuitos | $0 |
| Dominio propio | Opcional, no necesario | $0 si se usa la dirección de GitHub Pages |

No se usan servicios pagos, créditos promocionales ni APIs de IA con costo. **Ningún proveedor garantiza que sus planes
gratuitos sigan siéndolo para siempre;** si alguno cambiara, la app sigue funcionando localmente y los datos se pueden
exportar en formatos abiertos (JSON y CSV).
