// ARCHIVO GENERADO por scripts/gen-gas-schema.mjs a partir de shared/schema.json. No editar a mano.
var SCHEMA = {
  "schemaVersion": 2,
  "systemFields": [
    [
      "id",
      "string",
      "ID"
    ],
    [
      "rev",
      "number",
      "Revisión"
    ],
    [
      "version",
      "number",
      "Versión"
    ],
    [
      "createdAt",
      "string",
      "Creado"
    ],
    [
      "updatedAt",
      "string",
      "Modificado"
    ],
    [
      "deleted",
      "boolean",
      "Eliminado"
    ],
    [
      "updatedBy",
      "string",
      "Modificado por"
    ],
    [
      "deviceId",
      "string",
      "Dispositivo"
    ],
    [
      "origin",
      "string",
      "Origen"
    ],
    [
      "demo",
      "boolean",
      "Demo"
    ]
  ],
  "folders": {
    "app": "Hogar App",
    "documentos": "Documentos",
    "gastos": "Gastos Mensuales casa",
    "inversiones": "Inversiones",
    "peques": "Peques",
    "casa": "Reforma, mantenimiento casa"
  },
  "books": {
    "app": {
      "title": "Hogar — datos de la app",
      "folder": "app"
    },
    "gastos": {
      "title": "Gastos de la casa",
      "folder": "gastos"
    },
    "inversiones": {
      "title": "Inversiones",
      "folder": "inversiones"
    },
    "casa": {
      "title": "Casa y mantenimiento",
      "folder": "casa"
    },
    "documentos": {
      "title": "Índice de documentos",
      "folder": "documentos"
    }
  },
  "placement": {
    "household": [
      "app",
      "Hogar"
    ],
    "profiles": [
      "app",
      "Perfiles"
    ],
    "config": [
      "app",
      "Configuración"
    ],
    "tasks": [
      "app",
      "Tareas"
    ],
    "events": [
      "app",
      "Agenda"
    ],
    "shoppingLists": [
      "app",
      "Listas de compras"
    ],
    "shoppingItems": [
      "app",
      "Compras"
    ],
    "notes": [
      "app",
      "Notas"
    ],
    "captures": [
      "app",
      "Capturas"
    ],
    "attachments": [
      "app",
      "Archivos"
    ],
    "history": [
      "app",
      "Historial"
    ],
    "payments": [
      "gastos",
      "Pagos"
    ],
    "expenses": [
      "gastos",
      "Gastos"
    ],
    "investments": [
      "inversiones",
      "Inversiones"
    ],
    "investmentContracts": [
      "inversiones",
      "Contratos"
    ],
    "investmentTaxes": [
      "inversiones",
      "Impuestos"
    ],
    "investmentWorks": [
      "inversiones",
      "Mantenimiento"
    ],
    "rooms": [
      "casa",
      "Ambientes"
    ],
    "providers": [
      "casa",
      "Proveedores"
    ],
    "assets": [
      "casa",
      "Elementos"
    ],
    "maintenance": [
      "casa",
      "Mantenimiento"
    ],
    "repairs": [
      "casa",
      "Reparaciones"
    ],
    "documents": [
      "documentos",
      "Documentos"
    ],
    "healthNotes": [
      "app",
      "Salud - Indicaciones"
    ],
    "treatments": [
      "app",
      "Salud - Tratamientos"
    ],
    "medications": [
      "app",
      "Salud - Medicamentos"
    ],
    "doseLogs": [
      "app",
      "Salud - Tomas"
    ],
    "doctors": [
      "app",
      "Salud - Cartilla"
    ],
    "vaccinations": [
      "app",
      "Salud - Vacunas"
    ]
  },
  "required": {
    "tasks": [
      "title"
    ],
    "events": [
      "title",
      "start"
    ],
    "shoppingItems": [
      "name"
    ],
    "payments": [
      "concept"
    ],
    "expenses": [
      "date",
      "amount",
      "concept"
    ],
    "rooms": [
      "name"
    ],
    "providers": [
      "name"
    ],
    "assets": [
      "name"
    ],
    "maintenance": [
      "title"
    ],
    "repairs": [
      "title"
    ],
    "documents": [
      "name"
    ],
    "investments": [
      "name"
    ],
    "investmentContracts": [
      "investmentId",
      "kind"
    ],
    "investmentTaxes": [
      "investmentId",
      "tax"
    ],
    "investmentWorks": [
      "investmentId",
      "title"
    ],
    "healthNotes": [
      "title"
    ],
    "treatments": [
      "personId"
    ],
    "medications": [
      "treatmentId",
      "name"
    ],
    "doseLogs": [
      "medicationId",
      "plannedAt"
    ],
    "doctors": [
      "name"
    ],
    "vaccinations": [
      "vaccine"
    ]
  },
  "entities": {
    "household": [
      [
        "name",
        "string",
        "Nombre"
      ],
      [
        "timezone",
        "string",
        "Zona horaria"
      ],
      [
        "currency",
        "string",
        "Moneda"
      ],
      [
        "email",
        "string",
        "Correo"
      ]
    ],
    "profiles": [
      [
        "name",
        "string",
        "Nombre"
      ],
      [
        "role",
        "string",
        "Rol"
      ],
      [
        "color",
        "string",
        "Color"
      ],
      [
        "avatar",
        "string",
        "Avatar"
      ],
      [
        "active",
        "boolean",
        "Activo"
      ],
      [
        "aliases",
        "json",
        "Alias"
      ],
      [
        "prefs",
        "json",
        "Preferencias"
      ],
      [
        "pinHash",
        "string",
        "PIN (hash)"
      ],
      [
        "birthDate",
        "string",
        "Cumpleaños"
      ],
      [
        "notes",
        "string",
        "Notas"
      ]
    ],
    "config": [
      [
        "key",
        "string",
        "Clave"
      ],
      [
        "value",
        "json",
        "Valor"
      ]
    ],
    "tasks": [
      [
        "title",
        "string",
        "Tarea"
      ],
      [
        "description",
        "string",
        "Descripción"
      ],
      [
        "category",
        "string",
        "Categoría"
      ],
      [
        "assigneeId",
        "person",
        "Responsable"
      ],
      [
        "collaboratorIds",
        "persons",
        "Colaboradores"
      ],
      [
        "dueDate",
        "date",
        "Fecha límite"
      ],
      [
        "dueTime",
        "string",
        "Hora"
      ],
      [
        "priority",
        "string",
        "Prioridad"
      ],
      [
        "status",
        "string",
        "Estado"
      ],
      [
        "recurrence",
        "json",
        "Repetición"
      ],
      [
        "isSeries",
        "boolean",
        "Es serie"
      ],
      [
        "seriesId",
        "string",
        "Serie"
      ],
      [
        "occurrenceDate",
        "date",
        "Fecha de la ocurrencia"
      ],
      [
        "detached",
        "boolean",
        "Editada aparte"
      ],
      [
        "nextRun",
        "date",
        "Próxima"
      ],
      [
        "completedAt",
        "string",
        "Completada el"
      ],
      [
        "completedBy",
        "person",
        "Completada por"
      ],
      [
        "notes",
        "string",
        "Notas"
      ],
      [
        "attachmentIds",
        "json",
        "Archivos"
      ],
      [
        "relatedType",
        "string",
        "Relacionado (tipo)"
      ],
      [
        "relatedId",
        "string",
        "Relacionado (ID)"
      ],
      [
        "assetId",
        "string",
        "Elemento"
      ],
      [
        "roomId",
        "string",
        "Ambiente"
      ],
      [
        "maintenanceId",
        "string",
        "Mantenimiento"
      ]
    ],
    "events": [
      [
        "title",
        "string",
        "Evento"
      ],
      [
        "description",
        "string",
        "Descripción"
      ],
      [
        "start",
        "string",
        "Inicio"
      ],
      [
        "end",
        "string",
        "Fin"
      ],
      [
        "allDay",
        "boolean",
        "Todo el día"
      ],
      [
        "location",
        "string",
        "Lugar"
      ],
      [
        "participantIds",
        "persons",
        "Participantes"
      ],
      [
        "ownerId",
        "person",
        "Responsable"
      ],
      [
        "category",
        "string",
        "Categoría"
      ],
      [
        "reminders",
        "json",
        "Recordatorios (min)"
      ],
      [
        "recurrence",
        "json",
        "Repetición"
      ],
      [
        "notes",
        "string",
        "Notas"
      ],
      [
        "attachmentIds",
        "json",
        "Archivos"
      ],
      [
        "rsvp",
        "string",
        "Confirmación"
      ],
      [
        "syncCalendar",
        "boolean",
        "En Google Calendar"
      ],
      [
        "googleEventId",
        "string",
        "ID en Calendar"
      ],
      [
        "googleUpdated",
        "string",
        "Calendar actualizado"
      ],
      [
        "calendarSyncedAt",
        "string",
        "Calendar sincronizado"
      ],
      [
        "relatedType",
        "string",
        "Relacionado (tipo)"
      ],
      [
        "relatedId",
        "string",
        "Relacionado (ID)"
      ]
    ],
    "shoppingLists": [
      [
        "name",
        "string",
        "Lista"
      ],
      [
        "isTemplate",
        "boolean",
        "Habitual"
      ],
      [
        "archived",
        "boolean",
        "Archivada"
      ],
      [
        "notes",
        "string",
        "Notas"
      ]
    ],
    "shoppingItems": [
      [
        "listId",
        "string",
        "Lista"
      ],
      [
        "name",
        "string",
        "Producto"
      ],
      [
        "quantity",
        "number",
        "Cantidad"
      ],
      [
        "unit",
        "string",
        "Unidad"
      ],
      [
        "category",
        "string",
        "Categoría"
      ],
      [
        "priority",
        "string",
        "Prioridad"
      ],
      [
        "buyerId",
        "person",
        "Lo compra"
      ],
      [
        "status",
        "string",
        "Estado"
      ],
      [
        "purchasedAt",
        "string",
        "Comprado el"
      ],
      [
        "purchasedBy",
        "person",
        "Comprado por"
      ],
      [
        "notes",
        "string",
        "Notas"
      ],
      [
        "relatedType",
        "string",
        "Relacionado (tipo)"
      ],
      [
        "relatedId",
        "string",
        "Relacionado (ID)"
      ],
      [
        "expenseId",
        "string",
        "Gasto"
      ],
      [
        "mergedInto",
        "string",
        "Fusionado en"
      ],
      [
        "requestedBy",
        "person",
        "Lo pidió"
      ]
    ],
    "payments": [
      [
        "concept",
        "string",
        "Concepto"
      ],
      [
        "category",
        "string",
        "Categoría"
      ],
      [
        "provider",
        "string",
        "Proveedor"
      ],
      [
        "amount",
        "number",
        "Importe"
      ],
      [
        "currency",
        "string",
        "Moneda"
      ],
      [
        "issueDate",
        "date",
        "Emisión"
      ],
      [
        "dueDate",
        "date",
        "Vencimiento"
      ],
      [
        "paidDate",
        "date",
        "Fecha de pago"
      ],
      [
        "responsibleId",
        "person",
        "Responsable"
      ],
      [
        "status",
        "string",
        "Estado"
      ],
      [
        "method",
        "string",
        "Medio de pago"
      ],
      [
        "receiptDocId",
        "string",
        "Comprobante (ID)"
      ],
      [
        "recurrence",
        "json",
        "Repetición"
      ],
      [
        "isSeries",
        "boolean",
        "Es serie"
      ],
      [
        "seriesId",
        "string",
        "Serie"
      ],
      [
        "occurrenceDate",
        "date",
        "Fecha de la ocurrencia"
      ],
      [
        "notes",
        "string",
        "Notas"
      ],
      [
        "expenseId",
        "string",
        "Gasto (ID)"
      ],
      [
        "relatedType",
        "string",
        "Relacionado (tipo)"
      ],
      [
        "relatedId",
        "string",
        "Relacionado (ID)"
      ]
    ],
    "expenses": [
      [
        "date",
        "date",
        "Fecha"
      ],
      [
        "amount",
        "number",
        "Importe"
      ],
      [
        "currency",
        "string",
        "Moneda"
      ],
      [
        "category",
        "string",
        "Categoría"
      ],
      [
        "concept",
        "string",
        "Concepto"
      ],
      [
        "responsibleId",
        "person",
        "Responsable"
      ],
      [
        "receiptDocId",
        "string",
        "Comprobante (ID)"
      ],
      [
        "paymentId",
        "string",
        "Pago (ID)"
      ],
      [
        "repairId",
        "string",
        "Reparación (ID)"
      ],
      [
        "assetId",
        "string",
        "Elemento (ID)"
      ],
      [
        "shoppingItemIds",
        "json",
        "Compras (IDs)"
      ],
      [
        "extraordinary",
        "boolean",
        "Extraordinario"
      ],
      [
        "method",
        "string",
        "Medio de pago"
      ],
      [
        "notes",
        "string",
        "Notas"
      ]
    ],
    "rooms": [
      [
        "name",
        "string",
        "Ambiente"
      ],
      [
        "floor",
        "string",
        "Planta"
      ],
      [
        "notes",
        "string",
        "Notas"
      ]
    ],
    "providers": [
      [
        "name",
        "string",
        "Proveedor"
      ],
      [
        "trade",
        "string",
        "Rubro"
      ],
      [
        "phone",
        "string",
        "Teléfono"
      ],
      [
        "email",
        "string",
        "Correo"
      ],
      [
        "address",
        "string",
        "Dirección"
      ],
      [
        "notes",
        "string",
        "Notas"
      ]
    ],
    "assets": [
      [
        "name",
        "string",
        "Elemento"
      ],
      [
        "category",
        "string",
        "Categoría"
      ],
      [
        "roomId",
        "string",
        "Ambiente (ID)"
      ],
      [
        "brand",
        "string",
        "Marca"
      ],
      [
        "model",
        "string",
        "Modelo"
      ],
      [
        "serial",
        "string",
        "N.º de serie"
      ],
      [
        "purchaseDate",
        "date",
        "Compra"
      ],
      [
        "warrantyUntil",
        "date",
        "Garantía hasta"
      ],
      [
        "manualDocId",
        "string",
        "Manual (ID)"
      ],
      [
        "providerId",
        "string",
        "Proveedor (ID)"
      ],
      [
        "specs",
        "string",
        "Datos técnicos"
      ],
      [
        "photoIds",
        "json",
        "Fotos"
      ],
      [
        "notes",
        "string",
        "Notas"
      ]
    ],
    "maintenance": [
      [
        "title",
        "string",
        "Mantenimiento"
      ],
      [
        "category",
        "string",
        "Categoría"
      ],
      [
        "assetId",
        "string",
        "Elemento (ID)"
      ],
      [
        "roomId",
        "string",
        "Ambiente (ID)"
      ],
      [
        "recurrence",
        "json",
        "Frecuencia"
      ],
      [
        "frequencySource",
        "string",
        "Fuente de la frecuencia"
      ],
      [
        "assigneeId",
        "person",
        "Responsable"
      ],
      [
        "taskSeriesId",
        "string",
        "Serie de tareas"
      ],
      [
        "active",
        "boolean",
        "Activo"
      ],
      [
        "notes",
        "string",
        "Notas"
      ]
    ],
    "repairs": [
      [
        "title",
        "string",
        "Reparación"
      ],
      [
        "description",
        "string",
        "Descripción"
      ],
      [
        "assetId",
        "string",
        "Elemento (ID)"
      ],
      [
        "roomId",
        "string",
        "Ambiente (ID)"
      ],
      [
        "providerId",
        "string",
        "Proveedor (ID)"
      ],
      [
        "reportedAt",
        "date",
        "Reportada"
      ],
      [
        "resolvedAt",
        "date",
        "Resuelta"
      ],
      [
        "status",
        "string",
        "Estado"
      ],
      [
        "cost",
        "number",
        "Costo"
      ],
      [
        "taskId",
        "string",
        "Tarea (ID)"
      ],
      [
        "expenseId",
        "string",
        "Gasto (ID)"
      ],
      [
        "invoiceDocId",
        "string",
        "Factura (ID)"
      ],
      [
        "notes",
        "string",
        "Notas"
      ]
    ],
    "documents": [
      [
        "name",
        "string",
        "Documento"
      ],
      [
        "mimeType",
        "string",
        "Tipo de archivo"
      ],
      [
        "category",
        "string",
        "Categoría"
      ],
      [
        "date",
        "date",
        "Fecha"
      ],
      [
        "personId",
        "person",
        "Persona"
      ],
      [
        "relatedType",
        "string",
        "Relacionado (tipo)"
      ],
      [
        "relatedId",
        "string",
        "Relacionado (ID)"
      ],
      [
        "description",
        "string",
        "Descripción"
      ],
      [
        "tags",
        "json",
        "Etiquetas"
      ],
      [
        "visibility",
        "string",
        "Visibilidad"
      ],
      [
        "ownerId",
        "person",
        "Cargado por"
      ],
      [
        "attachmentId",
        "string",
        "Archivo (ID)"
      ],
      [
        "extractedText",
        "string",
        "Texto extraído"
      ],
      [
        "expiresAt",
        "date",
        "Vence"
      ],
      [
        "driveUrl",
        "string",
        "Enlace en Drive"
      ]
    ],
    "attachments": [
      [
        "name",
        "string",
        "Archivo"
      ],
      [
        "mimeType",
        "string",
        "Tipo"
      ],
      [
        "size",
        "number",
        "Tamaño"
      ],
      [
        "hash",
        "string",
        "SHA-256"
      ],
      [
        "folder",
        "string",
        "Carpeta"
      ],
      [
        "driveFileId",
        "string",
        "ID en Drive"
      ],
      [
        "driveUrl",
        "string",
        "Enlace"
      ],
      [
        "uploadStatus",
        "string",
        "Estado de subida"
      ]
    ],
    "notes": [
      [
        "title",
        "string",
        "Título"
      ],
      [
        "body",
        "string",
        "Texto"
      ],
      [
        "personIds",
        "persons",
        "Personas"
      ],
      [
        "relatedType",
        "string",
        "Relacionado (tipo)"
      ],
      [
        "relatedId",
        "string",
        "Relacionado (ID)"
      ],
      [
        "pinned",
        "boolean",
        "Fijada"
      ]
    ],
    "captures": [
      [
        "kind",
        "string",
        "Tipo"
      ],
      [
        "text",
        "string",
        "Texto"
      ],
      [
        "attachmentIds",
        "json",
        "Archivos"
      ],
      [
        "extractedText",
        "string",
        "Texto extraído"
      ],
      [
        "processor",
        "string",
        "Procesador"
      ],
      [
        "status",
        "string",
        "Estado"
      ],
      [
        "proposals",
        "json",
        "Propuestas"
      ],
      [
        "decisions",
        "json",
        "Decisiones"
      ],
      [
        "sourceRef",
        "string",
        "Origen externo"
      ],
      [
        "createdBy",
        "person",
        "Cargado por"
      ],
      [
        "processedAt",
        "string",
        "Procesada el"
      ]
    ],
    "history": [
      [
        "entity",
        "string",
        "Entidad"
      ],
      [
        "recordId",
        "string",
        "Registro"
      ],
      [
        "action",
        "string",
        "Acción"
      ],
      [
        "at",
        "string",
        "Fecha"
      ],
      [
        "by",
        "person",
        "Por"
      ],
      [
        "changes",
        "json",
        "Cambios"
      ]
    ],
    "investments": [
      [
        "name",
        "string",
        "Inversión"
      ],
      [
        "kind",
        "string",
        "Tipo"
      ],
      [
        "address",
        "string",
        "Dirección / detalle"
      ],
      [
        "owners",
        "string",
        "Titulares"
      ],
      [
        "status",
        "string",
        "Estado"
      ],
      [
        "purchaseDate",
        "date",
        "Fecha de compra"
      ],
      [
        "purchaseValue",
        "number",
        "Valor de compra"
      ],
      [
        "currency",
        "string",
        "Moneda"
      ],
      [
        "taxIds",
        "string",
        "Partidas / nomenclatura"
      ],
      [
        "driveFolderId",
        "string",
        "Carpeta en Drive (ID)"
      ],
      [
        "driveUrl",
        "string",
        "Carpeta en Drive"
      ],
      [
        "notes",
        "string",
        "Notas"
      ]
    ],
    "investmentContracts": [
      [
        "investmentId",
        "ref:investments",
        "Inversión"
      ],
      [
        "kind",
        "string",
        "Tipo de contrato"
      ],
      [
        "counterpart",
        "string",
        "Contraparte (inquilino, administración…)"
      ],
      [
        "startDate",
        "date",
        "Inicio"
      ],
      [
        "endDate",
        "date",
        "Fin"
      ],
      [
        "amount",
        "number",
        "Importe"
      ],
      [
        "currency",
        "string",
        "Moneda"
      ],
      [
        "frequency",
        "string",
        "Periodicidad"
      ],
      [
        "adjustment",
        "string",
        "Actualización / índice"
      ],
      [
        "dueDay",
        "number",
        "Día de cobro/pago"
      ],
      [
        "status",
        "string",
        "Estado"
      ],
      [
        "documentId",
        "string",
        "Contrato (ID documento)"
      ],
      [
        "notes",
        "string",
        "Notas"
      ]
    ],
    "investmentTaxes": [
      [
        "investmentId",
        "ref:investments",
        "Inversión"
      ],
      [
        "tax",
        "string",
        "Impuesto / servicio"
      ],
      [
        "period",
        "string",
        "Período"
      ],
      [
        "dueDate",
        "date",
        "Vencimiento"
      ],
      [
        "amount",
        "number",
        "Importe"
      ],
      [
        "currency",
        "string",
        "Moneda"
      ],
      [
        "paidDate",
        "date",
        "Fecha de pago"
      ],
      [
        "status",
        "string",
        "Estado"
      ],
      [
        "method",
        "string",
        "Medio de pago"
      ],
      [
        "receiptDocId",
        "string",
        "Comprobante (ID)"
      ],
      [
        "accountNumber",
        "string",
        "N.º de cuenta / partida"
      ],
      [
        "notes",
        "string",
        "Notas"
      ]
    ],
    "investmentWorks": [
      [
        "investmentId",
        "ref:investments",
        "Inversión"
      ],
      [
        "title",
        "string",
        "Trabajo"
      ],
      [
        "date",
        "date",
        "Fecha"
      ],
      [
        "provider",
        "string",
        "Proveedor"
      ],
      [
        "cost",
        "number",
        "Costo"
      ],
      [
        "currency",
        "string",
        "Moneda"
      ],
      [
        "status",
        "string",
        "Estado"
      ],
      [
        "paidBy",
        "string",
        "Pagó"
      ],
      [
        "documentId",
        "string",
        "Factura (ID)"
      ],
      [
        "notes",
        "string",
        "Notas"
      ]
    ],
    "healthNotes": [
      [
        "personId",
        "person",
        "Persona"
      ],
      [
        "kind",
        "string",
        "Tipo"
      ],
      [
        "title",
        "string",
        "Título"
      ],
      [
        "body",
        "string",
        "Indicaciones"
      ],
      [
        "doctor",
        "string",
        "Médico/a"
      ],
      [
        "date",
        "date",
        "Fecha"
      ],
      [
        "pinned",
        "boolean",
        "Plan de crisis"
      ],
      [
        "attachmentIds",
        "json",
        "Archivos"
      ]
    ],
    "treatments": [
      [
        "personId",
        "person",
        "Persona"
      ],
      [
        "diagnosis",
        "string",
        "Diagnóstico"
      ],
      [
        "doctor",
        "string",
        "Médico/a"
      ],
      [
        "place",
        "string",
        "Lugar"
      ],
      [
        "startDate",
        "date",
        "Inicio"
      ],
      [
        "status",
        "string",
        "Estado"
      ],
      [
        "notes",
        "string",
        "Indicaciones generales"
      ],
      [
        "attachmentIds",
        "json",
        "Archivos"
      ],
      [
        "sourceText",
        "string",
        "Texto leído de la receta"
      ]
    ],
    "medications": [
      [
        "treatmentId",
        "string",
        "Tratamiento (ID)"
      ],
      [
        "personId",
        "person",
        "Persona"
      ],
      [
        "name",
        "string",
        "Medicamento"
      ],
      [
        "dose",
        "string",
        "Dosis"
      ],
      [
        "everyHours",
        "number",
        "Cada (horas)"
      ],
      [
        "days",
        "number",
        "Días"
      ],
      [
        "firstDose",
        "string",
        "Primera toma"
      ],
      [
        "times",
        "json",
        "Horarios fijos"
      ],
      [
        "asNeeded",
        "boolean",
        "Solo si hace falta"
      ],
      [
        "notes",
        "string",
        "Indicaciones"
      ],
      [
        "status",
        "string",
        "Estado"
      ]
    ],
    "doseLogs": [
      [
        "medicationId",
        "string",
        "Medicamento (ID)"
      ],
      [
        "plannedAt",
        "string",
        "Hora prevista"
      ],
      [
        "takenAt",
        "string",
        "Hora en que se dio"
      ],
      [
        "by",
        "person",
        "La dio"
      ],
      [
        "skipped",
        "boolean",
        "Salteada"
      ],
      [
        "note",
        "string",
        "Nota"
      ]
    ],
    "doctors": [
      [
        "name",
        "string",
        "Nombre"
      ],
      [
        "specialty",
        "string",
        "Especialidad"
      ],
      [
        "personIds",
        "persons",
        "Atiende a"
      ],
      [
        "phone",
        "string",
        "Teléfono"
      ],
      [
        "whatsapp",
        "string",
        "WhatsApp"
      ],
      [
        "address",
        "string",
        "Dirección"
      ],
      [
        "insurance",
        "string",
        "Obra social / prepaga"
      ],
      [
        "email",
        "string",
        "Mail"
      ],
      [
        "notes",
        "string",
        "Notas"
      ]
    ],
    "vaccinations": [
      [
        "personId",
        "person",
        "Persona"
      ],
      [
        "vaccine",
        "string",
        "Vacuna"
      ],
      [
        "dose",
        "string",
        "Dosis"
      ],
      [
        "ageLabel",
        "string",
        "Edad"
      ],
      [
        "dueDate",
        "date",
        "Le corresponde"
      ],
      [
        "status",
        "string",
        "Estado"
      ],
      [
        "appliedDate",
        "date",
        "Aplicada el"
      ],
      [
        "place",
        "string",
        "Lugar"
      ],
      [
        "lot",
        "string",
        "Lote"
      ],
      [
        "notes",
        "string",
        "Notas"
      ],
      [
        "scheduleId",
        "string",
        "Calendario (ID)"
      ]
    ]
  },
  "syncOrder": [
    "household",
    "config",
    "profiles",
    "rooms",
    "providers",
    "investments",
    "attachments",
    "doctors",
    "healthNotes",
    "treatments",
    "medications",
    "doseLogs",
    "vaccinations",
    "documents",
    "assets",
    "maintenance",
    "shoppingLists",
    "tasks",
    "events",
    "payments",
    "expenses",
    "shoppingItems",
    "repairs",
    "investmentContracts",
    "investmentTaxes",
    "investmentWorks",
    "notes",
    "captures",
    "history"
  ]
};
