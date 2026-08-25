/**
 * Motor reusable de paginación de documentos convertidos de PDF a
 * markdown (inserta marcadores [página N] para que lib/openai.ts pueda
 * citar "Fuente: página N" de forma confiable).
 *
 * Codifica el método que se fue afinando a mano documento por documento
 * durante varias sesiones (BU-01/26, DOFA/Fernández, TPS-70, LCE/Gomez,
 * USF/Coaquira, AD-18/Rea): en vez de reescribir la lógica de cero cada
 * vez, esto la centraliza y la deja probada.
 *
 * Patrón que se repite en TODOS los documentos vistos hasta ahora: cada
 * página termina (o empieza) con un "ancla" — un código corto que se
 * repite (ej. "BU-01/26", "DOP 11/26", "AD-18/26") — y un número cerca
 * de esa ancla, ya sea en la misma línea o en una línea aparte antes o
 * después. Ese número puede:
 *   - Coincidir 1 a 1 con la página real del PDF (offset 0).
 *   - Tener un desfase fijo (ej. Fernández: +6, por un preámbulo sin
 *     numerar que se cortó).
 *   - Tener un desfase que CAMBIA a lo largo del documento (ej. Gomez:
 *     un módulo nuevo reinicia su propia numeración) — ahí no sirve un
 *     desfase fijo, hace falta alinear cada ancla contra el texto real
 *     del PDF.
 *   - Ser el número real que se quiere conservar tal cual, sin tocar
 *     (ej. Rea, a pedido explícito del cliente).
 */

export interface PaginationWarning {
  type:
    | 'no_number_found'
    | 'duplicate_dropped'
    | 'not_monotonic'
    | 'offset_inconsistent'
    | 'alignment_miss'
    | 'already_paginated'
    | 'pdf_unavailable';
  detail: string;
}

export interface PaginationResult {
  markdown: string;
  markerCount: number;
  firstPage: number | null;
  lastPage: number | null;
  /** Páginas dentro del rango [firstPage, lastPage] sin marcador propio (contenido plegado a la siguiente). */
  gaps: number[];
  warnings: PaginationWarning[];
  /** Desfase fijo aplicado, si se usó ese método (numberingMode 'absolute'). */
  offsetApplied: number | null;
  /** true si se usó alineación por fragmento de texto en vez de un desfase fijo. */
  alignmentUsed: boolean;
}

export type NumberingMode = 'internal' | 'absolute';

export interface PaginateOptions {
  /** Texto (o regex) que identifica el ancla que se repite en cada página. */
  anchor: string | RegExp;
  /**
   * 'internal' (default): usa el número tal cual aparece en el documento,
   * sin compararlo contra el PDF. 'absolute': corrige para que el
   * marcador coincida con la página real del PDF (lo que muestra
   * cualquier lector) — requiere `pdfPages`.
   */
  mode?: NumberingMode;
  /** Texto de cada página real del PDF, en orden (ver extractPdfPages). Solo hace falta si mode='absolute'. */
  pdfPages?: string[];
}

function lineBounds(text: string, idx: number): [number, number] {
  let start = text.lastIndexOf('\n', idx - 1) + 1;
  let end = text.indexOf('\n', idx);
  if (end === -1) end = text.length;
  return [start, end];
}

function stripDecor(s: string): string {
  return s.replace(/\||\*|_|<br>|~/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeForMatch(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[a-z]+>/gi, ' ')
    .replace(/[*_~#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

interface RawAnchor {
  index: number; // posición del match del ancla en el texto
  footerEnd: number; // fin de línea del ancla — ahí termina el bloque de esta página
  n: string | null; // número interno detectado (puede ser null)
  /**
   * Punto hasta donde llega el contenido "real" de la página (prosa,
   * antes del número/ancla). Para alinear contra el PDF importa este
   * punto, NO `index` — cuando el número se encontró ANTES del ancla
   * (estrategia b), el contenido real de la página termina antes de esa
   * línea de número, no antes del ancla: la conversión a menudo reordena
   * "ancla número" del PDF real a "número \n ancla" en el markdown, así
   * que el texto que de verdad precede al ancla en el PDF es el que
   * viene ANTES del número, no antes del ancla.
   */
  contentEnd: number;
}

/**
 * Busca el número de página pegado a cada ocurrencia del ancla, probando
 * las dos variantes que cubren todos los documentos vistos hasta ahora:
 * (a) el número va DESPUÉS del ancla, en la misma línea (ej. "BU-01/26 178")
 * (b) el número va ANTES del ancla, en una línea propia, buscando hacia
 *     atrás hasta 12 líneas (para saltar bloques de imagen/membrete en
 *     el medio, como pasó en Rea2).
 */
function findRawAnchors(text: string, anchorRe: RegExp): RawAnchor[] {
  const anchors = [...text.matchAll(anchorRe)];
  const results: RawAnchor[] = [];

  for (const a of anchors) {
    const [anchorLineStart, anchorLineEnd] = lineBounds(text, a.index);
    const footerEnd = anchorLineEnd < text.length ? anchorLineEnd + 1 : anchorLineEnd;

    // (a) número después del ancla, misma línea. El contenido real
    // termina justo antes del ancla (el orden ancla->número del
    // markdown coincide con el del PDF).
    const afterSameLine = text.slice(a.index + a[0].length, anchorLineEnd);
    const afterMatch = stripDecor(afterSameLine).match(/^(\d+)/);
    if (afterMatch) {
      results.push({ index: a.index, footerEnd, n: afterMatch[1], contentEnd: anchorLineStart });
      continue;
    }

    // (b) número antes del ancla, escaneando hacia atrás. OJO: en el PDF
    // real el orden casi siempre es "ancla número" (ej. "DOP 11/26 -1-"),
    // pero la conversión a menudo lo invierte a "número \n ancla" en el
    // markdown. Por eso el contenido real de la página termina antes de
    // la línea del NÚMERO, no antes del ancla — si se usa `index` acá
    // para alinear contra el PDF, la huella de texto queda mal armada.
    let cursor = anchorLineStart - 1;
    let found: string | null = null;
    let numberLineStart = anchorLineStart;
    for (let hop = 0; hop < 12 && cursor >= 0; hop++) {
      const [s, e] = lineBounds(text, cursor);
      const raw = stripDecor(text.slice(s, e));
      const m = raw.match(/^-?(\d+)-?$/);
      if (m) {
        found = m[1];
        numberLineStart = s;
        break;
      }
      if (s === 0) break;
      cursor = s - 1;
    }
    results.push({ index: a.index, footerEnd, n: found, contentEnd: numberLineStart });
  }

  return results;
}

/** Descarta anchors consecutivos que resolvieron al MISMO número (duplicado de OCR, ej. página repetida dentro de un bloque de imagen). */
function dedupeConsecutive<T extends { n: string }>(
  anchors: T[],
  warnings: PaginationWarning[]
): T[] {
  const out: T[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const cur = anchors[i];
    const next = anchors[i + 1];
    if (next && next.n === cur.n) {
      warnings.push({
        type: 'duplicate_dropped',
        detail: `Duplicado de página ${cur.n} descartado (se conserva la última ocurrencia).`,
      });
      continue;
    }
    out.push(cur);
  }
  return out;
}

/**
 * Intenta un desfase FIJO (página_absoluta = interna + offset) probando
 * los mismos 3 puntos de muestra (primero, medio, último anchor) contra
 * el texto real del PDF. Si los 3 dan el mismo offset, se usa ese modo
 * (rápido). Si no, hace falta alineación completa (ver alignToPdf).
 */
function detectFixedOffset(
  anchors: { contentEnd: number; footerEnd: number; n: string }[],
  text: string,
  normPages: string[]
): number | null {
  if (anchors.length < 2) return null;
  const sampleIdxs = [0, Math.floor(anchors.length / 2), anchors.length - 1];
  const offsets: number[] = [];

  for (const i of sampleIdxs) {
    const a = anchors[i];
    const fingerprint = normalizeForMatch(text.slice(Math.max(0, a.contentEnd - 150), a.contentEnd)).slice(-60);
    if (fingerprint.length < 15) continue;
    const pageIdx = normPages.findIndex((p) => p.includes(fingerprint));
    if (pageIdx === -1) continue;
    offsets.push(pageIdx + 1 - parseInt(a.n, 10));
  }

  if (offsets.length < 2) return null;
  const allSame = offsets.every((o) => o === offsets[0]);
  return allSame ? offsets[0] : null;
}

/**
 * Alinea CADA ancla contra el texto real del PDF buscando el fragmento
 * que la precede (mismo método que se usó a mano para Gomez, donde un
 * desfase fijo no alcanzaba por el reinicio de numeración a mitad del
 * documento). Devuelve, para cada anchor, la página real del PDF (o null
 * si no se pudo encontrar con confianza).
 */
function alignToPdf(
  anchors: { contentEnd: number; footerEnd: number }[],
  text: string,
  normPages: string[],
  warnings: PaginationWarning[]
): (number | null)[] {
  let cursorPage = 0;
  return anchors.map((a) => {
    const before = text.slice(Math.max(0, a.contentEnd - 200), a.contentEnd);
    const fingerprint = normalizeForMatch(before).slice(-70);
    if (fingerprint.length < 15) return null;
    for (let p = cursorPage; p < normPages.length; p++) {
      if (normPages[p].includes(fingerprint)) {
        cursorPage = p;
        return p + 1;
      }
    }
    warnings.push({ type: 'alignment_miss', detail: `Sin match en el PDF para el fragmento: "${fingerprint}"` });
    return null;
  });
}

export function paginateDocument(markdown: string, options: PaginateOptions): PaginationResult {
  const mode: NumberingMode = options.mode ?? 'internal';
  const anchorRe =
    typeof options.anchor === 'string'
      ? new RegExp(options.anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      : new RegExp(options.anchor.source, options.anchor.flags.includes('g') ? options.anchor.flags : options.anchor.flags + 'g');

  const warnings: PaginationWarning[] = [];

  // Idempotencia: si el markdown ya tiene marcadores propios (ej. se
  // corrió "Analizar y paginar" dos veces en el panel), se sacan antes de
  // procesar. Sin esto, una segunda corrida duplicaba cada marcador
  // ("[página 5]\n\n[página 5]\n\n...") porque el ancla original sigue
  // intacta y se vuelve a detectar igual.
  const alreadyPaginated = /\[página \d+\]/i.test(markdown);
  if (alreadyPaginated) {
    warnings.push({
      type: 'already_paginated',
      detail: 'El markdown ya tenía marcadores [página N] — se sacaron antes de volver a paginar.',
    });
  }
  // Saca exactamente lo que se insertó ("[página N]" + las 2 líneas
  // nuevas de después, ver el `[página ${n}]\n\n` más abajo) — con \n*
  // (cualquier cantidad) se comía además líneas en blanco que ya
  // formaban parte del contenido original, corriendo todo lo de abajo.
  const source = alreadyPaginated ? markdown.replace(/\[página \d+\]\n\n/gi, '') : markdown;

  const raw = findRawAnchors(source, anchorRe);

  raw.filter((r) => r.n === null).forEach((r) => {
    warnings.push({ type: 'no_number_found', detail: `Sin número detectado cerca del ancla en índice ${r.index}.` });
  });

  const withNumber = raw.filter((r): r is RawAnchor & { n: string } => r.n !== null);
  const deduped = dedupeConsecutive(withNumber, warnings);

  let offsetApplied: number | null = null;
  let alignmentUsed = false;
  let finalPages: (number | null)[];

  if (mode === 'absolute' && options.pdfPages && options.pdfPages.length > 0) {
    // Se normaliza cada página del PDF una sola vez acá, no dentro de
    // cada función — detectFixedOffset y alignToPdf comparten el mismo
    // array normalizado en vez de recalcularlo cada una por su cuenta.
    const normPages = options.pdfPages.map(normalizeForMatch);
    const offset = detectFixedOffset(deduped, source, normPages);
    if (offset !== null) {
      offsetApplied = offset;
      finalPages = deduped.map((a) => parseInt(a.n, 10) + offset);
    } else {
      warnings.push({
        type: 'offset_inconsistent',
        detail: 'El desfase no es constante a lo largo del documento — se usa alineación completa contra el PDF.',
      });
      alignmentUsed = true;
      finalPages = alignToPdf(deduped, source, normPages, warnings);
    }
  } else {
    // Si se pidió mode='absolute' pero no hay páginas de PDF utilizables
    // (no se mandó el archivo, o la extracción devolvió un array vacío
    // sin tirar error — pasa con PDFs degenerados/corruptos), antes esto
    // caía acá en silencio y devolvía la numeración SIN corregir como si
    // hubiera funcionado. Ahora avisa explícitamente que la corrección
    // pedida no se pudo aplicar.
    if (mode === 'absolute') {
      warnings.push({
        type: 'pdf_unavailable',
        detail:
          options.pdfPages && options.pdfPages.length === 0
            ? 'El PDF no devolvió texto extraíble (¿archivo vacío o corrupto?) — se usó la numeración SIN corregir.'
            : 'No se recibió el PDF — se usó la numeración SIN corregir.',
      });
    }
    finalPages = deduped.map((a) => parseInt(a.n, 10));
  }

  let prevN = 0;
  let isFirst = true;
  const gaps: number[] = [];
  let out = '';
  let prevEnd = 0;

  for (let i = 0; i < deduped.length; i++) {
    const n = finalPages[i];
    if (n === null) continue; // sin alineación confiable: el contenido se pliega al siguiente marcador
    // El primer marcador nunca dispara "no creciente" ni cuenta huecos
    // hacia atrás — comparar contra el prevN=0 inicial inventaba huecos
    // falsos cuando la primera página real no es la 1 (ej. Fernández
    // empieza en la 5): no sabemos si algo "falta" antes del primer
    // marcador que de verdad se encontró, así que no se reporta nada ahí.
    if (!isFirst) {
      if (n <= prevN) {
        warnings.push({ type: 'not_monotonic', detail: `Número no creciente: ${prevN} -> ${n}.` });
      }
      if (n > prevN + 1) {
        for (let g = prevN + 1; g < n; g++) gaps.push(g);
      }
    }
    isFirst = false;
    prevN = n;
    out += `[página ${n}]\n\n` + source.slice(prevEnd, deduped[i].footerEnd);
    prevEnd = deduped[i].footerEnd;
  }
  out += source.slice(prevEnd);

  const markers = [...out.matchAll(/\[página (\d+)\]/gi)].map((m) => parseInt(m[1], 10));

  return {
    markdown: out,
    markerCount: markers.length,
    firstPage: markers[0] ?? null,
    lastPage: markers[markers.length - 1] ?? null,
    gaps,
    warnings,
    offsetApplied,
    alignmentUsed,
  };
}

/**
 * Sugiere anclas candidatas: líneas cortas que se repiten varias veces
 * en el documento (el "código" que se repite en cada página). No decide
 * nada solo, es para elegir en segundos en vez de leer el documento
 * entero a mano.
 */
export function suggestAnchors(markdown: string, minOccurrences = 4): { text: string; count: number }[] {
  const lines = markdown.split('\n');
  const counts = new Map<string, number>();

  for (const line of lines) {
    const stripped = stripDecor(line);
    // Candidatas: cortas, con al menos una letra y no puramente numéricas
    // (esas ya son el número de página, no el ancla).
    if (stripped.length < 3 || stripped.length > 30) continue;
    if (/^\d+$/.test(stripped)) continue;
    if (!/[a-zA-ZÁÉÍÓÚÑ]/.test(stripped)) continue;
    counts.set(stripped, (counts.get(stripped) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= minOccurrences)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([text, count]) => ({ text, count }));
}
