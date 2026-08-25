import { getDocumentProxy, extractText } from 'unpdf';

/**
 * Extrae el texto de cada página real de un PDF, en orden. Es la ÚNICA
 * función que hace esto en todo el proyecto — tanto scripts/paginate.ts
 * (CLI local) como app/api/admin/content/paginate/route.ts (producción)
 * la importan de acá, para no tener dos implementaciones que puedan
 * divergir (antes el CLI usaba el binario `pdftotext` y la ruta usaba
 * `unpdf` por separado).
 */
export async function extractPdfPages(pdfBytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(pdfBytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}
