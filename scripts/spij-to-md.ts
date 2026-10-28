/**
 * Convierte una norma descargada del SPIJ (PDF en docs/pdf/) en el markdown
 * de estudio que se sube a la app (docs/md/): recorta solo los rangos que
 * pide el temario, quita el ruido del SPIJ (concordancias, jurisprudencia,
 * notas de modificación), se queda con la versión vigente de cada
 * artículo y deja marcadores [página N] con la página real del PDF (los usa
 * lib/openai.ts para trocear y para citar la fuente).
 *
 * El texto de los artículos es literal: no se resume ni se redacta nada.
 *
 * Uso:
 *   bun run scripts/spij-to-md.ts <documento>      (ej. civil, penal, tuo)
 *   bun run scripts/spij-to-md.ts --all
 *
 * Para una norma nueva: dejar el PDF en docs/pdf/ y agregar una entrada en
 * DOCS con los rangos (encabezados de inicio/fin tal como aparecen en el PDF).
 */
import { readFileSync, writeFileSync } from 'fs';
import { extractPdfPages } from '../lib/pdfText';

const PDF_DIR = 'docs/pdf';
const MD_DIR = 'docs/md';

// from: buscar `start` recién después de esta línea (encabezados que se repiten, ej. "TITULO IX").
// incl: la línea `start` entra en el rango (para recortar artículos sueltos:
// start = "Artículo 5.", end = "Artículo 6."). label vacío = sigue bajo el
// mismo "##" que el rango anterior.
type Range = { label: string; start: RegExp; end: RegExp; startNth?: number; from?: RegExp; incl?: boolean };
// notes: notas del SPIJ (por su primera línea) que se copian al inicio del
// documento como "> Nota:" — ej. las que remiten los montos a otra ley.
type Doc = { pdf: string; out: string; title: string; ranges: Range[]; notes?: { label: string; match: RegExp[] } };

const DOCS: Record<string, Doc> = {
  penal: {
    pdf: '3. CODIGO PENAL.pdf',
    out: '3. Codigo Penal.md',
    title: 'Código Penal — Principios, Teoría del delito y Penas',
    ranges: [
      { label: 'Título Preliminar — Principios generales', start: /^TITULO PRELIMINAR$/, end: /^LIBRO PRIMERO$/ },
      { label: 'Título II — Del hecho punible (Teoría del delito)', start: /^TITULO II$/, end: /^TITULO III$/ },
      { label: 'Título III — De las penas', start: /^TITULO III$/, end: /^TITULO IV$/ },
    ],
  },
  civil: {
    pdf: '1. CODIGO CIVIL.pdf',
    out: '1. Codigo Civil.md',
    title: 'Código Civil — Parte General, Familia, Sucesiones, Derechos Reales y Responsabilidad Civil',
    ranges: [
      { label: 'Título Preliminar (arts. I–X)', start: /^TITULO PRELIMINAR$/, end: /^LIBRO I$/ },
      { label: 'Libro I — Derecho de las Personas (arts. 1–139)', start: /^LIBRO I$/, end: /^LIBRO II$/ },
      { label: 'Libro II — Acto Jurídico (arts. 140–232)', start: /^LIBRO II$/, end: /^LIBRO III$/ },
      { label: 'Libro III — Derecho de Familia (arts. 233–659)', start: /^LIBRO III$/, end: /^LIBRO IV$/ },
      { label: 'Libro IV — Derecho de Sucesiones (arts. 660–880)', start: /^LIBRO IV$/, end: /^LIBRO V$/ },
      { label: 'Libro V — Derechos Reales y garantías (arts. 881–1131)', start: /^LIBRO V$/, end: /^LIBRO VI$/ },
      { label: 'Responsabilidad civil contractual — Inejecución de obligaciones (arts. 1314–1332)', from: /^LIBRO VI$/, start: /^TITULO IX$/, end: /^CAPITULO SEGUNDO$/ },
      { label: 'Responsabilidad civil extracontractual (arts. 1969–1988)', start: /^SECCION SEXTA$/, from: /^LIBRO VII$/, end: /^LIBRO VIII$/ },
    ],
  },
  tuo: {
    pdf: '5. TUO Ley N 27444.pdf',
    out: '5. TUO Ley 27444.md',
    title: 'TUO de la Ley 27444 — Ley del Procedimiento Administrativo General (D.S. 004-2019-JUS)',
    ranges: [
      { label: 'Título Preliminar — Principios del procedimiento administrativo', start: /^TÍTULO PRELIMINAR$/, end: /^TÍTULO I$/ },
      // Sin el Cap. III (eficacia y notificación, arts. 16–28): no está en el temario.
      { label: 'Título I, Caps. I–II — Acto administrativo: requisitos de validez y nulidad', from: /^TÍTULO I$/, start: /^TÍTULO I$/, end: /^CAPÍTULO III$/ },
      { label: 'Título II — Del procedimiento administrativo (incluye silencio administrativo)', start: /^TÍTULO II$/, end: /^TÍTULO III$/ },
      { label: 'Título III — Revisión de los actos en vía administrativa (nulidad de oficio y recursos)', start: /^TÍTULO III$/, end: /^TÍTULO IV$/ },
    ],
  },
  ley32069: {
    pdf: '6. LEY DE CONTRATACIONES PUBLICAS (LEY Nº 32069) y su modificatoria.pdf',
    out: '6. Ley 32069 Contrataciones Publicas.md',
    title: 'Ley 32069 — Ley General de Contrataciones Públicas: principios, montos y procedimientos',
    ranges: [
      { label: 'Principios', from: /^TÍTULO I$/, start: /^Artículo 5\./, end: /^Artículo 6\./, incl: true },
      { label: 'Montos', from: /^TÍTULO III$/, start: /^Artículo 34\./, end: /^Artículo 35\./, incl: true },
      { label: '', from: /^TÍTULO IV$/, start: /^Artículo 48\./, end: /^Artículo 49\./, incl: true },
      { label: '', from: /^TÍTULO IV$/, start: /^Artículo 50\./, end: /^Artículo 51\./, incl: true },
      { label: 'Procedimientos de selección', from: /^TÍTULO IV$/, start: /^Artículo 53\./, end: /^CAPÍTULO III$/, incl: true },
    ],
  },
  reglamento: {
    pdf: '7. REGLAMENTO DE LEY DE CONTRATACIÓN PUBLICA.pdf',
    out: '7. Reglamento Ley 32069.md',
    title: 'Reglamento de la Ley 32069 — Procedimientos de selección y contratos menores',
    ranges: [
      { label: 'Título III, Caps. II–IV — Procedimientos de selección', from: /^TÍTULO III$/, start: /^CAPÍTULO II$/, end: /^CAPÍTULO V$/ },
      { label: 'Título VI, Capítulo I — Contratos menores', start: /^TÍTULO VI$/, end: /^CAPÍTULO II$/, from: /^TÍTULO VI$/ },
    ],
  },
  ley30225: {
    pdf: '8. ley-n-30225-ley-de-contrataciones-del-estado-y-modificatorias.pdf',
    out: '8. Ley 30225 Contrataciones del Estado.md',
    title: 'Ley 30225 — Ley de Contrataciones del Estado (TUO D.S. 082-2019-EF), derogada por la Ley 32069: principios, montos y procedimientos',
    notes: {
      label: 'Montos vigentes de los procedimientos (notas del SPIJ)',
      match: [
        /^\(\*\) De conformidad con el Numeral 14\.1 del Artículo 14 de la Ley Nº 32185/,
        /^\(\*\) De conformidad con el Numeral 3\.1 del Artículo 3 del Decreto de Urgencia Nº 016-2022/,
      ],
    },
    ranges: [
      { label: 'Principios', from: /^TÍTULO I$/, start: /^Artículo 2\./, end: /^Artículo 3\./, incl: true },
      { label: 'Montos', from: /^TÍTULO I$/, start: /^Artículo 5\./, end: /^Artículo 6\./, incl: true },
      { label: '', from: /^TÍTULO II$/, start: /^Artículo 18\./, end: /^Artículo 19\./, incl: true },
      { label: '', from: /^TÍTULO II$/, start: /^Artículo 20\./, end: /^Artículo 21\./, incl: true },
      { label: 'Procedimientos de selección (métodos de contratación)', from: /^TÍTULO II$/, start: /^Artículo 21\./, end: /^CAPÍTULO IV$/, incl: true },
    ],
  },
  procivil: {
    pdf: '2. CODIGO PROCESAL CIVIL.pdf',
    out: '2. Codigo Procesal Civil.md',
    title: 'Código Procesal Civil — Procesos vinculados a Familia, Sucesiones, Personas, Derechos Reales, Garantías y Responsabilidad Civil',
    ranges: [
      { label: 'Proceso de conocimiento — Separación de cuerpos o divorcio por causal', from: /^PROCESO DE CONOCIMIENTO$/, start: /^Subcapítulo 1$/, end: /^TITULO II$/ },
      { label: 'Proceso abreviado — Retracto; Título supletorio, prescripción adquisitiva y rectificación de áreas; Responsabilidad civil de los jueces', from: /^PROCESO ABREVIADO$/, start: /^Subcapítulo 1$/, end: /^Subcapítulo 4$/ },
      { label: 'Proceso abreviado — Tercería', from: /^PROCESO ABREVIADO$/, start: /^Subcapítulo 5$/, end: /^Subcapítulo 6$/ },
      { label: 'Proceso sumarísimo — Alimentos, separación convencional y divorcio ulterior, interdicción, desalojo e interdictos', from: /^PROCESO SUMARISIMO$/, start: /^Subcapítulo 1$/, end: /^TITULO IV$/ },
      { label: 'Proceso de ejecución de garantías', from: /^PROCESOS DE EJECUCION/, start: /^Capítulo IV$/, end: /^Capítulo V$/ },
      // Sin administración judicial de bienes (Subcap. 2) ni autorización para disponer derechos de incapaces (Subcap. 4): vínculo débil.
      { label: 'Procesos no contenciosos — Inventario', from: /^DISPOSICIONES ESPECIALES$/, start: /^Subcapítulo 1$/, end: /^Subcapítulo 2$/ },
      { label: 'Procesos no contenciosos — Adopción', from: /^DISPOSICIONES ESPECIALES$/, start: /^Sub-Capítulo 3$/, end: /^Subcapítulo 4$/ },
      { label: 'Procesos no contenciosos — Desaparición, ausencia o muerte presunta; patrimonio familiar', from: /^DISPOSICIONES ESPECIALES$/, start: /^Subcapítulo 5$/, end: /^Subcapítulo 7$/ },
      { label: 'Procesos no contenciosos — Comprobación de testamento, inscripción y rectificación de partida, sucesión intestada', from: /^DISPOSICIONES ESPECIALES$/, start: /^Subcapítulo 8$/, end: /^Subcapítulo 11$/ },
    ],
  },
  ncpp: {
    pdf: '4. NUEVO CODIGO PROCESAL PENAL.pdf',
    out: '4. Nuevo Codigo Procesal Penal.md',
    title: 'Nuevo Código Procesal Penal — Principios, acción penal y civil, sentencia y determinación de la pena, terminación anticipada y ejecución',
    ranges: [
      { label: 'Título Preliminar — Principios del proceso penal', start: /^TÍTULO PRELIMINAR$/, end: /^LIBRO PRIMERO$/ },
      // Solo arts. 1–2 de la Sección I (acción penal y principio de oportunidad);
      // 3–10 (cuestión previa, prejudicial, excepciones) no se vinculan al temario.
      { label: 'Libro I, Sección I — Acción penal y principio de oportunidad (arts. 1–2)', from: /^LIBRO PRIMERO$/, start: /^Artículo 1 /, end: /^Artículo 3 /, incl: true },
      { label: 'Libro I, Sección II — La acción civil (reparación civil)', from: /^LIBRO PRIMERO$/, start: /^SECCIÓN II$/, end: /^SECCIÓN III$/ },
      { label: 'Libro III, Sección III (Juzgamiento) — Conclusión anticipada del juicio (art. 372)', from: /^EL JUZGAMIENTO$/, start: /^Artículo 372 /, end: /^Artículo 373 /, incl: true },
      { label: 'Libro III, Sección III (Juzgamiento) — La deliberación y la sentencia', from: /^EL JUZGAMIENTO$/, start: /^TÍTULO VI$/, end: /^LIBRO CUARTO$/ },
      { label: 'Libro V, Sección V — El proceso de terminación anticipada', from: /^LIBRO QUINTO$/, start: /^SECCIÓN V$/, end: /^SECCIÓN VI$/ },
      { label: 'Libro VI, Sección I — La ejecución de la sentencia', from: /^LIBRO SEXTO$/, start: /^SECCIÓN I$/, end: /^SECCIÓN II$/ },
    ],
  },
};

// Texto del documento en proceso, una línea por elemento, con un marcador
// <<<PAGE N>>> al inicio de cada página real del PDF; pageOf[i] = página de
// la línea i. Los usan findLine() y buildDoc().
let raw: string[] = [];
let pageOf: number[] = [];

async function loadPdf(file: string) {
  const pages = await extractPdfPages(new Uint8Array(readFileSync(`${PDF_DIR}/${file}`)));
  raw = pages.map((p, i) => `<<<PAGE ${i + 1}>>>\n${p}`).join('\n').split(/\r?\n/);
  pageOf = [];
  let page = 0;
  for (const l of raw) {
    const m = l.match(/^<<<PAGE (\d+)>>>$/);
    if (m) page = Number(m[1]);
    pageOf.push(page);
  }
}

/** Índice de la n-ésima línea que matchea, a partir de `from`. El índice
 * (TOC) del documento repite los encabezados, por eso startNth. */
function findLine(re: RegExp, from: number, nth = 0): number {
  let seen = 0;
  for (let i = from; i < raw.length; i++) {
    // Se compara también sin comilla inicial: “ Artículo 6. ...
    const t = raw[i].trim();
    if (re.test(t) || re.test(t.replace(/^[“"]\s*/, ''))) {
      if (seen === nth) return i;
      seen++;
    }
  }
  return -1;
}

const NOISE = [
  /^PROCESOS CONSTITUCIONALES$/,
  /^JURISPRUDENCIA\b/,
  /^EXPOSICI[OÓ]N DE MOTIVOS$/,
  /^(\(\*\)\s*)?RECTIFICADO POR FE DE ERRATAS$/,
  // La misma marca partida en 2 líneas de distintas formas.
  /^(\(\*\)\s*)?(RECTIFICADO( POR( FE( DE)?)?)?|(POR )?(FE )?(DE )?ERRATAS)$/,
];
// "Artículo 5.-", "Artículo 5. Título", "Artículo 45- A.-" y el formato del
// NCPP "Artículo 1 Acción penal.-" (número + espacio + título en mayúscula).
// El NCPP escribe algunos romanos con ele minúscula ("Vl", "Vlll").
const ARTICLE = /^[“"]?\s*Art[ií]culo\s+([0-9IVXLC]+|[IVX][IVXl]*)(\s?-\s?[A-Z]|\s[A-Z](?=\s?[.-]))?(?:[\s.º°]*[-.–]|\s+(?=[A-ZÁÉÍÓÚÑ]))/;
// Sufijo normalizado: "45- A", "659 F" → "45-A", "659-F".
const articleId = (m: RegExpMatchArray) =>
  m[1].replace(/l/g, 'I') + (m[2] ? '-' + m[2].replace(/[\s-]/g, '') : '');
// Notas del SPIJ: "(*) ..." o numeradas "(1) ...", "(2) ..." cuando hay varias.
const NOTE = /^\((\*+|\d)\)\s*(?=[A-ZÚ])/;
const REPLACES_ARTICLE = /^\((\*+|\d)\)\s*Art[ií]culo\s+(modificado|sustituido)/i;
const REPEALS_ARTICLE = /^\((\*+|\d)\)\s*Art[ií]culo\s+derogado/i;
// Fórmula con la que el SPIJ introduce el texto vigente tras una nota.
const INTRO = /(siguiente|redacci[oó]n)\s*:\s*$/;
// Remisiones a notas pegadas al final de una línea: "...muerte.” (1)(2)"
const TRAILING_REFS = /(\s*\((\*+|\d)\))+\s*$/;

/** Quita notas (*) multilínea y bloques de CONCORDANCIAS. */
function stripNoise(lines: { t: string; p: number }[]) {
  const out: typeof lines = [];
  let inNote = false;
  let inConc = false;
  let concParens = 0;
  // Separar notas que vienen pegadas en la misma línea que el texto:
  // "...cause lesiones o muerte.” (1)(2) (1) Numeral 11) adicionado por..."
  const split: typeof lines = [];
  for (const ln of lines) {
    const m = ln.t.match(/^(.*?)((?:\s*\(\s*(?:\*+|\d)\))+)\s+(\(\s*(?:\*+|\d)\)\s*[A-ZÚ].*)$/);
    if (m && m[1].trim()) split.push({ ...ln, t: m[1] }, { ...ln, t: m[3].replace(/^\(\s*/, '(') });
    else split.push(ln);
  }
  // ¿La nota sigue después de una línea que termina en punto? Pasa con
  // notas largas ("...publicada el 19 enero 2010. La citada Ley entrará en
  // vigencia... cuyo texto es el siguiente:"). Solo se considera
  // continuación si unas líneas más abajo aparece la fórmula "cuyo texto es
  // el siguiente:" antes de cualquier texto citado/artículo/otra nota — si
  // no, lo que sigue es texto normativo (ej. un párrafo tras "(*) Párrafo
  // incorporado por...").
  const continuesNote = (k: number) => {
    for (let x = k + 1; x < Math.min(split.length, k + 13); x++) {
      const n = split[x].t.trim();
      if (/^([“"]|Art[ií]culo)/.test(n) || NOTE.test(n)) return false;
      if (INTRO.test(n)) return true;
    }
    return false;
  };
  for (let k = 0; k < split.length; k++) {
    const ln = split[k];
    const t = ln.t.trim();
    if (!t || NOISE.some((r) => r.test(t))) continue;
    const parenDelta = (s: string) => (s.match(/\(/g)?.length ?? 0) - (s.match(/\)/g)?.length ?? 0);
    // Origen del texto en los TUO: "(Texto según el artículo 3 de la Ley Nº 27444)",
    // "(Texto modificado según ...)", a veces partido en 2 líneas.
    if (/^\((Texto|Art[ií]culo|Numeral|P[aá]rrafo|Literal|Cap[ií]tulo|Sub\s?cap[ií]tulo|T[ií]tulo|Inciso)\b[^)]*\b(seg[uú]n|incorporad|modificad|sustituid)/i.test(t)) {
      inConc = parenDelta(t) > 0; concParens = parenDelta(t); continue;
    }
    if (/^CONCORDANCIAS?\s*:/.test(t)) { inConc = true; concParens = parenDelta(t); continue; }
    if (inConc) {
      // Las concordancias siguen mientras las líneas sean referencias a normas
      // o mientras quede un paréntesis abierto de la referencia anterior.
      if (concParens > 0 || /^(Ley|D\.?\s?Leg|D\.?\s?S\.?|D\.?\s?U|R\.|Res\.|Decreto|Directiva|Acuerdo|Resoluci|Constituci|Código|Art\.|[A-Z]\.[A-Z])/.test(t)) {
        // (Antes también seguía con cualquier línea en minúscula y se comía
        // literales del texto legal como "c) Desabastecimiento...". Las
        // continuaciones reales de una concordancia quedan dentro de un
        // paréntesis abierto y ya las cubre concParens.)
        concParens = Math.max(0, concParens + parenDelta(t));
        continue;
      }
      inConc = false;
    }
    const tt = t.replace(TRAILING_REFS, '');
    const noteEnds = () =>
      INTRO.test(tt) || (/\.\s*$/.test(tt) && !continuesNote(k));
    // Un "Artículo N.-" sin comillas nunca es parte de una nota: la cierra.
    if (inNote && /^Art[ií]culo\s/.test(t) && ARTICLE.test(t)) inNote = false;
    if (NOTE.test(t)) { inNote = !noteEnds(); out.push(ln); continue; }
    if (inNote) {
      out.push({ ...ln, t: '__NOTECONT__ ' + t });
      if (noteEnds()) inNote = false;
      continue;
    }
    out.push(ln);
  }
  return out;
}

function buildDoc(doc: Doc): { text: string; warnings: string[] } {
const md: string[] = [`# ${doc.title}`, ''];
const warnings: string[] = [];
let lastPageEmitted = -1;

if (doc.notes) {
  md.push(`## ${doc.notes.label}`, '');
  for (const re of doc.notes.match) {
    const i = findLine(re, 0);
    if (i < 0) throw new Error(`nota no encontrada: ${re}`);
    const parts = [raw[i].trim()];
    for (let j = i + 1; j < raw.length; j++) {
      const t = raw[j].trim();
      if (/^<<<PAGE/.test(t) || (/^<<<PAGE/.test(raw[j - 1]) && /^\d{1,4}$/.test(t))) continue;
      if (NOTE.test(t) || /^(TÍTULO|TITULO|LEY|Artículo)\b/.test(t)) break;
      parts.push(t);
    }
    md.push(`[página ${pageOf[i]}]`, '', '> **Nota:** ' + parts.join(' ').replace(NOTE, '').replace(/^\((\*+|\d)\)\s*/, ''), '');
  }
}

for (const r of doc.ranges) {
  const base = r.from ? findLine(r.from, 0) : 0;
  const s = findLine(r.start, Math.max(base, 0), r.startNth ?? 0);
  const e = findLine(r.end, s + 1);
  if (s < 0 || e < 0) throw new Error(`rango no encontrado: ${r.label}`);
  const slice = [];
  for (let i = r.incl ? s : s + 1; i < e; i++) {
    if (/^<<<PAGE/.test(raw[i])) continue;
    // Número de página impreso al inicio de la hoja (ej. Ley 30225): "12".
    if (/^<<<PAGE/.test(raw[i - 1] ?? '') && /^\d{1,4}$/.test(raw[i].trim())) continue;
    slice.push({ t: raw[i], p: pageOf[i] });
  }
  const lines = stripNoise(slice);

  // Agrupar por artículo. Lo previo al primer artículo es encabezado.
  type Block = { head: string[]; body: { t: string; p: number }[] };
  const blocks: Block[] = [];
  let pendingHead: string[] = [];
  let cur: Block | null = null;
  for (const ln of lines) {
    const t = ln.t.trim();
    if (ARTICLE.test(t.replace(/^__NOTECONT__ /, '')) && !t.startsWith('__NOTECONT__')) {
      // Un "Artículo X" citado como texto nuevo tras una nota pertenece al mismo bloque.
      // Mirar las 2 líneas previas: a veces la sumilla citada va entre la
      // nota y el "Artículo N" nuevo ("...siguiente:" / "Conversión de..." / "Artículo 52.-").
      const prevs = (cur?.body.slice(-2) ?? []).map((x) => x.t.replace(/^__NOTECONT__ /, '').trim());
      const isNewVersion = prevs.some((p) => INTRO.test(p));
      // El mismo número que el bloque actual (ej. tras "(*) Epígrafe modificado")
      // es otra versión del mismo artículo, no uno nuevo.
      const am = t.match(ARTICLE)!;
      const sameId = cur && (() => { const cm = cur!.body[0].t.trim().match(ARTICLE); return cm && articleId(cm) === articleId(am); })();
      if (cur && (isNewVersion || sameId)) { cur.body.push(ln); continue; }
      cur = { head: pendingHead, body: [ln] };
      blocks.push(cur);
      pendingHead = [];
      continue;
    }
    if (!cur) { pendingHead.push(t); continue; }
    cur.body.push(ln);
  }
  // Las líneas de encabezado/epígrafe que quedaron al final del bloque anterior
  // (sumilla del siguiente artículo, CAPITULO...) se detectan como líneas cortas
  // sin punto final justo antes del próximo artículo.
  for (let b = 0; b < blocks.length - 1; b++) {
    const body = blocks[b].body;
    const moved: string[] = [];
    while (body.length > 1) {
      const t = body.at(-1)!.t.trim();
      if (t.startsWith('__NOTECONT__') || NOTE.test(t)) break;
      if (t.length <= 90 && !/[.:;,”"]$/.test(t)) { moved.unshift(t); body.pop(); } else break;
    }
    blocks[b + 1].head = [...moved, ...blocks[b + 1].head];
  }

  if (r.label) md.push(`## ${r.label}`, '');
  for (const h of pendingHead.length && !blocks.length ? pendingHead : []) md.push(h);

  for (const blk of blocks) {
    let body = blk.body;
    // Versión vigente a nivel artículo: quedarse con lo que sigue a la ÚLTIMA nota que lo reemplaza entero.
    let lastRepl = -1;
    let repealed = false;
    const plain = (i: number) => body[i]?.t.replace(/^__NOTECONT__ /, '').trim() ?? '';
    body.forEach((ln, i) => {
      const t = ln.t.trim();
      if (REPEALS_ARTICLE.test(t)) repealed = true;
      if (REPLACES_ARTICLE.test(t)) { lastRepl = i; return; }
      // Otras notas que reintroducen el artículo entero ("...restitúyese la
      // vigencia del texto, que tiene la siguiente redacción:" + "Artículo N").
      if (NOTE.test(t) && !/(Numeral|Inciso|P[aá]rrafo|Literal)/i.test(t)) {
        let j = i;
        while (j < body.length && j < i + 15 && !INTRO.test(plain(j))) j++;
        if (INTRO.test(plain(j)) && [j + 1, j + 2].some((x) => ARTICLE.test(plain(x)))) lastRepl = i;
      }
    });
    if (lastRepl >= 0) {
      let j = lastRepl;
      while (j < body.length && !INTRO.test(body[j].t.replace(/^__NOTECONT__ /, '').trim())) j++;
      body = body.slice(j + 1);
    }
    // Quitar notas restantes; avisar si eran cambios parciales (numeral/párrafo/inciso).
    // Las notas del Tribunal Constitucional (inconstitucionalidad parcial,
    // interpretación) cambian cómo se lee el artículo: se conservan como cita.
    const clean: typeof body = [];
    for (let i = 0; i < body.length; i++) {
      const ln = body[i];
      const t = ln.t.trim();
      if (NOTE.test(t)) {
        let full = t;
        while (body[i + 1]?.t.startsWith('__NOTECONT__')) full += ' ' + body[++i].t.replace(/^__NOTECONT__ /, '').trim();
        if (/(Numeral|Inciso|P[aá]rrafo|Literal|Ep[ií]grafe)\s.*(modificado|sustituido)/i.test(full)) {
          clean.push({ ...ln, t: '@@PARCIAL@@' });
        } else if (/Tribunal Constitucional|^\((\*+|\d)\)\s*De conformidad/i.test(full) && !INTRO.test(full)) {
          // También las "De conformidad con ... se modifica ..." sin texto
          // nuevo (típico en el TUO 27444): avisan que el artículo cambió.
          clean.push({ ...ln, t: '@@NOTA@@' + full.replace(NOTE, '').replace(/^\((\*+|\d)\)\s*/, '') });
        }
        continue;
      }
      if (t.startsWith('__NOTECONT__')) continue;
      clean.push(ln);
    }

    // Encabezados: sin notas ni remisiones. Si una nota cambió la
    // denominación ("...cuyo texto es el siguiente:" + "Ejecución de
    // garantías"), queda solo la denominación nueva.
    const heads: string[] = [];
    for (let hi = 0; hi < blk.head.length; hi++) {
      const h0 = blk.head[hi];
      if (h0.startsWith('__NOTECONT__')) {
        if (INTRO.test(h0)) heads.pop(); // la denominación anterior queda reemplazada
        continue;
      }
      if (NOTE.test(h0)) continue;
      heads.push(h0.replace(TRAILING_REFS, '').replace(/^[“"]\s*|\s*[”"]$/g, ''));
    }
    for (let h of heads) {
      h = h.replace(/\s*\(\*\)\s*RECTIFICADO POR FE DE ERRATAS/i, '');
      if (/^(LIBRO|TITULO|TÍTULO|CAPITULO|CAPÍTULO|SECCION|SECCIÓN|SUBCAP)/.test(h)) md.push('', `### ${h}`);
      else md.push(`### ${h}`.replace(/^### (?=[a-záéíóú])/, '')); // sumilla
    }
    if (repealed && lastRepl < 0) {
      const am = blk.body[0].t.match(ARTICLE);
      const id = am ? articleId(am) : '?';
      md.push(`**Artículo ${id}.** (Derogado)`, '');
      continue;
    }
    type Item = { k: 'page'; p: number } | { k: 'para'; t: string } | { k: 'parcial' };
    const items: Item[] = [];
    let para = '';
    const flush = () => { if (para) { items.push({ k: 'para', t: para.trim() }); para = ''; } };
    for (let ci = 0; ci < clean.length; ci++) {
      const ln = clean[ci];
      if (ln.p !== lastPageEmitted) { flush(); items.push({ k: 'page', p: ln.p }); lastPageEmitted = ln.p; }
      if (ln.t === '@@PARCIAL@@') { flush(); items.push({ k: 'parcial' }); continue; }
      if (ln.t.startsWith('@@NOTA@@')) {
        flush();
        items.push({ k: 'para', t: '> **Nota:** ' + ln.t.slice(8).replace(/\s*\(\*+\)/g, '').trim() });
        continue;
      }
      let t = ln.t.trim()
        .replace(/\s*\(\*\)\s*NOTA SPIJ/g, '')
        .replace(/\s*\(\*\)\s*RECTIFICADO( POR FE DE ERRATAS)?/gi, '')
        .replace(/\s*\(\*+\)(?=[\s,.;:]|$)/g, '')
        .replace(TRAILING_REFS, '')
        .replace(/^[“"]\s*/, '')
        .replace(/\s*[”"]\s*\.?\s*$/, (m) => (m.includes('.') ? '.' : ''));
      if (!t) continue;
      const m = t.match(ARTICLE);
      if (m) {
        flush();
        let rest = t.slice(m[0].length).trim();
        // Formato NCPP: "Artículo 1 Acción penal.- La acción..." → el ".-"
        // cierra el título; se normaliza a "Acción penal. La acción...".
        if (!/[-.–]\s*$/.test(m[0])) rest = rest.replace(/^([^.]{1,150}?)\s*[.:]-?\s*(?=\S|$)/, '$1. ').trim();
        // "Artículo I. Justicia Penal.-" → "Justicia Penal."
        rest = rest.replace(/^([^.]{1,150}?)\.-(?=\s|$)/, '$1.');
        t = `**Artículo ${articleId(m)}.-** ${rest}`.trim();
      }
      // Una línea nueva es párrafo/inciso propio si empieza con numeración.
      if (/^(\d+\s*[.)]|[a-z]\)|[IVX]+\.)\s*\S/.test(t)) flush();
      para += (para && !para.endsWith('-') ? ' ' : '') + t;
      if (/[.:;]$/.test(t) && t.length < 80) flush();
      // "Artículo 1.- Concepto de acto administrativo" + texto en la línea
      // siguiente: el título va en su propia línea. Solo si la línea no
      // termina en puntuación y la siguiente arranca en mayúscula/numeración
      // (si arranca en minúscula es la misma oración que sigue).
      const nextT = clean[ci + 1]?.t.trim().replace(/^[“"]\s*/, '') ?? '';
      if (m && t.length < 120 && !/[.:;,]$/.test(t) && /^([A-ZÁÉÍÓÚÑ¿]|\d+[.)\s])/.test(nextT)) flush();
    }
    flush();

    // Cambio parcial: el texto nuevo (después de la nota) reemplaza al
    // numeral/literal con la misma etiqueta más cercano hacia atrás —con todo
    // lo que cuelga de él— o, si no tiene etiqueta, al párrafo anterior.
    // Etiqueta completa: "34.1." → "34.1", "1.2.1 Los" → "1.2.1", "b)" → "b".
    const label = (s: string) =>
      s.match(/^(?:\*\*Artículo [^*]+\*\*\s*)?(\d+(?:\.\d+)+|\d+|[a-z])(?=\s*[.)]|\s)/)?.[1];
    for (let i = 0; i < items.length; i++) {
      if (items[i].k !== 'parcial') continue;
      const next = items.slice(i + 1).find((x) => x.k === 'para') as { t: string } | undefined;
      // Epígrafe modificado: el texto nuevo es otra vez "**Artículo N.-** ..."
      // y reemplaza entera a la línea de artículo anterior.
      if (next?.t.startsWith('**Artículo')) {
        for (let j = i - 1; j >= 0; j--) {
          const it = items[j];
          if (it.k === 'para' && it.t.startsWith('**Artículo')) { items[j] = { k: 'page', p: -1 }; break; }
        }
        warnings.push(`resuelto [epígrafe] → ${next.t.slice(0, 70)}`);
        continue;
      }
      const lbl = next && label(next.t);
      let from = -1;
      for (let j = i - 1; j >= 0; j--) {
        const it = items[j];
        if (it.k !== 'para') continue;
        if (!lbl) { from = j; break; }
        if (label(it.t) === lbl && !it.t.startsWith('**Artículo')) { from = j; break; }
      }
      if (from < 0) { warnings.push(`sin resolver (etiqueta ${lbl}) cerca de: ${next?.t.slice(0, 80)}`); continue; }
      for (let j = from; j < i; j++) {
        const it = items[j];
        if (it.k !== 'para') continue;
        // Si lo reemplazado es el primer párrafo del artículo, conservar el rótulo.
        const art = it.t.match(/^\*\*Artículo [^*]+\*\*/)?.[0];
        items[j] = art ? { k: 'para', t: art } : { k: 'page', p: -1 };
      }
      warnings.push(`resuelto [${lbl ?? 'párrafo'}] → ${next?.t.slice(0, 70)}`);
    }
    for (const it of items) {
      if (it.k === 'page' && it.p > 0) md.push(`[página ${it.p}]`, '');
      else if (it.k === 'para') md.push(it.t, '');
    }
  }
}

return { text: md.join('\n').replace(/\n{3,}/g, '\n\n'), warnings };
}

const arg = process.argv[2];
const names = arg === '--all' ? Object.keys(DOCS) : [arg];
if (!arg || names.some((n) => !DOCS[n])) {
  console.error(`Uso: bun run scripts/spij-to-md.ts <${Object.keys(DOCS).join('|')}|--all>`);
  process.exit(1);
}
for (const name of names) {
  const doc = DOCS[name];
  await loadPdf(doc.pdf);
  const { text, warnings } = buildDoc(doc);
  writeFileSync(`${MD_DIR}/${doc.out}`, text);
  // Los cambios parciales (numeral/párrafo modificado) se resuelven solos;
  // solo se avisa de los que no se pudieron resolver.
  console.log(`${doc.out}: ${text.length} caracteres`);
  for (const w of warnings.filter((w) => w.startsWith('sin resolver'))) console.log('  ⚠️ ' + w);
}
