import { NextResponse } from 'next/server';
import { requireRole, handleApiError } from '@/lib/apiAuth';
import { paginateDocument, type NumberingMode } from '@/lib/pagination';
import { extractPdfPages } from '@/lib/pdfText';

// Vista previa de paginación para /admin/content: no guarda nada, solo
// devuelve el markdown con [página N] insertado + un reporte para que el
// admin lo revise antes de asignarlo. El PDF nunca se persiste (mismo
// principio que el resto de la app — solo el markdown final se guarda).
export async function POST(req: Request) {
  try {
    await requireRole('admin');

    const form = await req.formData();
    const markdown = form.get('markdown');
    const anchor = form.get('anchor');
    const modeRaw = form.get('mode');
    const pdfFile = form.get('pdf');

    if (typeof markdown !== 'string' || markdown.trim().length === 0) {
      return NextResponse.json({ error: 'Falta el markdown a paginar.' }, { status: 400 });
    }
    if (typeof anchor !== 'string' || anchor.trim().length === 0) {
      return NextResponse.json({ error: 'Falta el ancla (el código que se repite en cada página).' }, { status: 400 });
    }
    const mode: NumberingMode = modeRaw === 'absolute' ? 'absolute' : 'internal';

    let pdfPages: string[] | undefined;
    if (mode === 'absolute') {
      if (!(pdfFile instanceof File)) {
        return NextResponse.json(
          { error: 'El modo "absoluto" necesita el PDF original para verificar contra la página real.' },
          { status: 400 }
        );
      }
      const buffer = new Uint8Array(await pdfFile.arrayBuffer());
      pdfPages = await extractPdfPages(buffer);
      if (pdfPages.length === 0) {
        return NextResponse.json(
          { error: 'El PDF no devolvió texto extraíble (¿archivo vacío o corrupto?). Probá con otro archivo.' },
          { status: 400 }
        );
      }
    }

    const result = paginateDocument(markdown, { anchor, mode, pdfPages });

    return NextResponse.json({
      markdown: result.markdown,
      markerCount: result.markerCount,
      firstPage: result.firstPage,
      lastPage: result.lastPage,
      gaps: result.gaps,
      warnings: result.warnings,
      offsetApplied: result.offsetApplied,
      alignmentUsed: result.alignmentUsed,
      pdfPageCount: pdfPages?.length ?? null,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
