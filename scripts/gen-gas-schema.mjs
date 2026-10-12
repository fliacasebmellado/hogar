// Copia shared/schema.json a apps-script/Schema.gs para que frontend y backend compartan una única definición.
import { readFileSync, writeFileSync } from 'node:fs';
const schema = JSON.parse(readFileSync(new URL('../shared/schema.json', import.meta.url), 'utf8'));
const out = `// ARCHIVO GENERADO por scripts/gen-gas-schema.mjs a partir de shared/schema.json. No editar a mano.\nvar SCHEMA = ${JSON.stringify(schema, null, 2)};\n`;
writeFileSync(new URL('../apps-script/Schema.gs', import.meta.url), out);
console.log('apps-script/Schema.gs actualizado (schemaVersion ' + schema.schemaVersion + ')');
