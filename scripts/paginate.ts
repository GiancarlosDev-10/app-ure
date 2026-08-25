/**
 * CLI reusable para paginar un documento convertido de PDF a markdown.
 * Reemplaza los scripts de un solo uso que se escribían a mano para cada
 * cliente nuevo — ver lib/pagination.ts para el motor.
 *
 * Uso:
 *   bun run scripts/paginate.ts <md> <anchor> [--mode=internal|absolute] [--pdf=<ruta.pdf>] [--out=<ruta>]
 *
 * Ejemplos:
 *   # Numeración tal cual la trae el documento (default: internal)
 *   bun run scripts/paginate.ts "doc.md" "BU-01/26"
 *
 *   # Corregida contra la página real del PDF (como Fernández)
 *   bun run scripts/paginate.ts "doc.md" "DOP 11/26" --mode=absolute --pdf="doc.pdf"
 *
 * Si no se pasa --anchor y se quiere ver candidatos, correr:
 *   bun run scripts/paginate.ts "doc.md" --suggest
 */
import { readFileSync, writeFileSync } from 'fs';
import { paginateDocument, suggestAnchors, type NumberingMode } from '../lib/pagination';
import { extractPdfPages } from '../lib/pdfText';

const args = process.argv.slice(2);
const mdPath = args[0];

if (!mdPath) {
  console.error('Uso: bun run scripts/paginate.ts <md> <anchor|--suggest> [--mode=...] [--pdf=...] [--out=...]');
  process.exit(1);
}

const markdown = readFileSync(mdPath, 'utf8');

if (args.includes('--suggest')) {
  console.log('Anclas candidatas (líneas cortas que se repiten):\n');
  for (const c of suggestAnchors(markdown)) {
    console.log(`  x${c.count}  "${c.text}"`);
  }
  process.exit(0);
}

const anchor = args[1];
if (!anchor) {
  console.error('Falta el ancla. Corré con --suggest primero si no sabés cuál es.');
  process.exit(1);
}

const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const rawMode = flag('mode');
if (rawMode && rawMode !== 'internal' && rawMode !== 'absolute') {
  console.error(`--mode inválido: "${rawMode}". Tiene que ser "internal" o "absolute".`);
  process.exit(1);
}
const mode: NumberingMode = (rawMode as NumberingMode | undefined) ?? 'internal';
const pdfPath = flag('pdf');

// Si mdPath no termina en ".md" (o si el nombre generado por error
// coincidiera con el original), el replace no encuentra nada y devuelve
// mdPath sin cambios — sin este chequeo, writeFileSync pisaría el
// archivo fuente. Nunca se escribe sobre el mismo archivo que se lee.
const defaultOut = mdPath.replace(/\.md$/i, ' (paginado).md');
const outPath = flag('out') ?? (defaultOut !== mdPath ? defaultOut : `${mdPath} (paginado).md`);
if (outPath === mdPath) {
  console.error('El archivo de salida coincide con el de entrada — no se sobreescribe el original. Usá --out=<ruta>.');
  process.exit(1);
}

let pdfPages: string[] | undefined;
if (mode === 'absolute') {
  if (!pdfPath) {
    console.error('mode=absolute necesita --pdf=<ruta al PDF original> para verificar contra la página real.');
    process.exit(1);
  }
  console.log(`Extrayendo texto del PDF (${pdfPath})...`);
  pdfPages = await extractPdfPages(new Uint8Array(readFileSync(pdfPath)));
  console.log(`Páginas reales en el PDF: ${pdfPages.length}`);
  if (pdfPages.length === 0) {
    console.error('El PDF no devolvió texto extraíble (¿vacío o corrupto?). No se puede verificar contra él.');
    process.exit(1);
  }
}

const result = paginateDocument(markdown, { anchor, mode, pdfPages });

console.log(`\nMarcadores insertados: ${result.markerCount}`);
console.log(`Rango: [página ${result.firstPage}] .. [página ${result.lastPage}]`);
if (result.offsetApplied !== null) console.log(`Desfase fijo aplicado: ${result.offsetApplied >= 0 ? '+' : ''}${result.offsetApplied}`);
if (result.alignmentUsed) console.log('Se usó alineación completa contra el PDF (el desfase no era constante).');
console.log(`Páginas sin marcador propio (plegadas a la siguiente): ${result.gaps.length}${result.gaps.length ? ' -> ' + result.gaps.join(', ') : ''}`);

if (result.warnings.length > 0) {
  console.log(`\nAvisos (${result.warnings.length}):`);
  for (const w of result.warnings.slice(0, 20)) {
    console.log(`  [${w.type}] ${w.detail}`);
  }
  if (result.warnings.length > 20) console.log(`  ... y ${result.warnings.length - 20} más`);
}

writeFileSync(outPath, result.markdown, 'utf8');
console.log(`\nEscrito: ${outPath}`);
