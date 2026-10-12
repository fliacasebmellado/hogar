# Hogar — app familiar integral

PWA para organizar el hogar de Papá, Mamá, Hijo y Hija: agenda, tareas, compras, economía, casa y mantenimiento,
documentos, perfiles y un asistente que convierte mensajes, fotos, documentos y audios en registros **siempre con revisión
antes de guardar**. Funciona sin conexión, se instala en el celular sin tienda y sincroniza entre dispositivos con
Google Sheets y Drive de **la cuenta de Google de la familia**, con costo operativo cero.

## Inicio rápido

```bash
npm install
```
```bash
npm run dev
```

Abrir <http://localhost:5173>, elegir un perfil y usar. Sin configurar Google, los datos quedan en ese dispositivo.

## Módulos

| Módulo | Qué incluye |
| --- | --- |
| Inicio | Saludo, agenda próxima, tareas de hoy y prioritarias, pagos por vencer, compras, casa, recordatorios, responsabilidades, estado de sincronización, bandeja y captura rápida. Bloques configurables por perfil; vista simple para chicos |
| Agenda | Vistas día/semana/mes, categorías, participantes, responsable, recordatorios, repetición, adjuntos, confirmación, origen, sincronización bidireccional con Google Calendar |
| Tareas | Puntuales y recurrentes (editar una o toda la serie), estados, prioridad, colaboradores, filtros, historial, autor y fecha de finalización |
| Compras | Varias listas, listas habituales, búsqueda, duplicados y fusión, comprado → gasto opcional, relación con tareas/gastos/casa |
| Economía | Pagos (obligaciones) y gastos (realizados) sin doble conteo, recurrentes, comprobantes, resumen mensual, por categoría, evolución, extraordinarios, CSV |
| Inversiones | Propiedades e inversiones (una por subcarpeta de *Inversiones* en Drive) con contratos, impuestos, mantenimiento y documentos; avisos de vencimientos. Solo adultos |
| Casa | Ambientes, elementos (garantía, manual, fotos, costos), reparaciones con tarea y factura, mantenimientos con frecuencia propia, proveedores |
| Familia | Perfiles editables (color, avatar, alias, preferencias, PIN opcional), agenda y tareas por integrante, información autorizada |
| Documentos | Archivo central con original conservado, categorías, visibilidad (familia/adultos/personal), etiquetas, búsqueda y extracción de texto local |
| Asistente | Texto, pegado, capturas, fotos, documentos, grabación de voz y audios importados; varias acciones por entrada; ambigüedades, faltantes y duplicados; historial; Gmail y Forms |
| Ajustes | Google, sincronización, conflictos, copias, permisos, categorías, notificaciones, asistente, apariencia, privacidad, estado del sistema, datos de demostración |

## Documentación

- [Configurar Google (Apps Script, Sheets, Drive, Calendar, Gmail, Forms)](docs/GOOGLE_SETUP.md)
- [Instalación, desarrollo, publicación y estructura de archivos](docs/DESPLIEGUE.md)
- [Arquitectura, modelo de datos, sincronización y seguridad](docs/ARQUITECTURA.md)
- [Guía de uso para la familia e instalación en el celular](docs/GUIA_FAMILIA.md)
- [Copias de seguridad y recuperación](docs/COPIAS.md)
- [Pruebas ejecutadas y resultados](docs/PRUEBAS.md)
- [Integraciones, limitaciones y costos](docs/LIMITACIONES_Y_COSTOS.md)
- [Diagnóstico de problemas](docs/TROUBLESHOOTING.md)

## Pruebas

```bash
npm test
```
```bash
npx playwright install chromium
```
```bash
npm run e2e
```

Última ejecución: 86/86 pruebas Vitest (más la de OCR real) y 23/23 pruebas de interfaz en Chromium (celular y
computadora). Detalle y lo que no se pudo probar en [docs/PRUEBAS.md](docs/PRUEBAS.md).

## Privacidad

Los datos se procesan en el dispositivo y, si se conecta, en la cuenta de Google de la familia. No se usan servicios de IA
en la nube ni se publican secretos en el repositorio. El selector de perfil no es autenticación: ver
[ARQUITECTURA.md](docs/ARQUITECTURA.md#seguridad-y-privacidad).
