'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import type { AdminContentSummary, AdminUserSummary } from '@/types';

export default function AdminContentPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [content, setContent] = useState<AdminContentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setLoadError(null);
    try {
      const [usersRes, contentRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/content'),
      ]);
      const usersJson = await usersRes.json();
      const contentJson = await contentRes.json();

      if (!usersRes.ok) throw new Error(usersJson.error ?? 'No se pudo cargar usuarios.');
      if (!contentRes.ok) throw new Error(contentJson.error ?? 'No se pudo cargar contenido.');

      setUsers(usersJson.users);
      setContent(contentJson.content);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Error inesperado.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  return (
    <main className="container-wide">
      <PageHeader email={session?.user?.email} />
      <nav className="nav-links">
        <Link href="/admin">← Panel</Link>
        <Link href="/admin/users">Usuarios</Link>
      </nav>

      <div className="card">
        <h1>Subir contenido</h1>
        <p className="hint">
          Pegá el material ya convertido a markdown (el PDF nunca se sube acá) y asignalo a un
          usuario puntual.
        </p>
        <UploadForm users={users} onCreated={loadAll} />
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>Contenido asignado</h2>
        {loading && <p className="hint">Cargando…</p>}
        {loadError && <p className="error">{loadError}</p>}
        {!loading && !loadError && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Asignado a</th>
                  <th>Estado</th>
                  <th>Creado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {content.map((c) => (
                  <ContentRow key={c.id} content={c} onChanged={loadAll} />
                ))}
                {content.length === 0 && (
                  <tr>
                    <td colSpan={5} className="hint">
                      Todavía no se subió contenido.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

function ContentRow({
  content,
  onChanged,
}: {
  content: AdminContentSummary;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleActive() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/content/${content.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !content.active }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No se pudo actualizar.');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      `¿Borrar "${content.title}" definitivamente? Esto también borra las preguntas ya generadas a partir de este contenido. No se puede deshacer.`
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/content/${content.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'No se pudo borrar.');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado.');
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>{content.title}</td>
      <td>{content.assigned_user?.email ?? '—'}</td>
      <td>
        <span className={`badge ${content.active ? 'badge-active' : 'badge-inactive'}`}>
          {content.active ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td>{new Date(content.created_at).toLocaleDateString('es-PE')}</td>
      <td>
        <div className="toolbar">
          <button type="button" className="btn-secondary" disabled={busy} onClick={toggleActive}>
            {content.active ? 'Desactivar' : 'Activar'}
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={handleDelete}>
            Borrar
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </td>
    </tr>
  );
}

interface PaginateReport {
  markerCount: number;
  firstPage: number | null;
  lastPage: number | null;
  gaps: number[];
  warnings: { type: string; detail: string }[];
  offsetApplied: number | null;
  alignmentUsed: boolean;
  pdfPageCount: number | null;
}

/**
 * Asistente de paginación: reemplaza el proceso manual (leer el PDF,
 * escribir un script de un solo uso, verificar a mano) por un llamado a
 * /api/admin/content/paginate. No guarda nada por sí solo — solo llena
 * el textarea de markdown de abajo con el resultado para que el admin lo
 * revise antes de asignarlo.
 */
function PaginateAssist({
  markdown,
  onResult,
}: {
  markdown: string;
  onResult: (markdown: string) => void;
}) {
  const [anchor, setAnchor] = useState('');
  const [mode, setMode] = useState<'internal' | 'absolute'>('internal');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PaginateReport | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  async function handleRun() {
    setError(null);
    setReport(null);
    if (!markdown.trim()) {
      setError('Primero cargá el markdown más abajo (archivo o pegado).');
      return;
    }
    if (!anchor.trim()) {
      setError('Falta el ancla — el código corto que se repite en cada página (ej. "BU-01/26", "DOP 11/26").');
      return;
    }
    if (mode === 'absolute' && !pdfFile) {
      setError('El modo "corregido contra el PDF" necesita que cargues el PDF original.');
      return;
    }

    setRunning(true);
    try {
      const fd = new FormData();
      fd.append('markdown', markdown);
      fd.append('anchor', anchor);
      fd.append('mode', mode);
      if (pdfFile) fd.append('pdf', pdfFile);

      const res = await fetch('/api/admin/content/paginate', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No se pudo paginar.');

      setReport(json);
      onResult(json.markdown);
      // Limpia el input del PDF: el resultado ya quedó aplicado al
      // markdown de abajo, y como éste ya no es el mismo texto que se
      // acaba de analizar (ya tiene los marcadores puestos), reusar el
      // mismo PDF sin querer no tiene sentido — fuerza a elegirlo de
      // nuevo si el admin quiere volver a correr el análisis.
      setPdfFile(null);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      style={{
        marginTop: '1rem',
        padding: '0.85rem 1rem',
        borderRadius: '10px',
        background: '#161d33',
        border: '1px solid #232c46',
      }}
    >
      <strong style={{ fontSize: '0.85rem' }}>Paginación automática (opcional)</strong>
      <p className="hint" style={{ marginTop: '0.3rem' }}>
        Inserta [página N] en el markdown de abajo para que las explicaciones puedan citar
        "Fuente: página N". Necesitás el markdown ya cargado más abajo antes de correr esto.
      </p>

      <div className="grid-form">
        <div>
          <label htmlFor="anchor">Ancla (código que se repite en cada página)</label>
          <input
            id="anchor"
            value={anchor}
            onChange={(e) => setAnchor(e.target.value)}
            placeholder='ej. "BU-01/26", "DOP 11/26"'
          />
        </div>
        <div>
          <label htmlFor="mode">Numeración</label>
          <select id="mode" value={mode} onChange={(e) => setMode(e.target.value as 'internal' | 'absolute')}>
            <option value="internal">Tal cual la trae el documento</option>
            <option value="absolute">Corregida contra la página real del PDF</option>
          </select>
        </div>
      </div>

      {mode === 'absolute' && (
        <>
          <label htmlFor="pdf-file">PDF original (para verificar, nunca se guarda)</label>
          <input
            id="pdf-file"
            ref={pdfInputRef}
            type="file"
            accept="application/pdf"
            onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
          />
        </>
      )}

      <button type="button" className="btn-secondary" disabled={running} onClick={handleRun} style={{ marginTop: '0.75rem' }}>
        {running ? 'Analizando…' : 'Analizar y paginar'}
      </button>

      {error && <p className="error">{error}</p>}

      {report && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.8rem' }}>
          <p style={{ margin: 0 }}>
            ✅ {report.markerCount} marcadores insertados — [página {report.firstPage}] a [página{' '}
            {report.lastPage}]
          </p>
          {report.offsetApplied !== null && (
            <p className="hint" style={{ margin: '0.25rem 0 0' }}>
              Desfase fijo aplicado contra el PDF: {report.offsetApplied >= 0 ? '+' : ''}
              {report.offsetApplied}
            </p>
          )}
          {report.alignmentUsed && (
            <p className="hint" style={{ margin: '0.25rem 0 0' }}>
              El desfase no era constante — se alineó cada página contra el texto real del PDF.
            </p>
          )}
          {report.gaps.length > 0 && (
            <p className="hint" style={{ margin: '0.25rem 0 0' }}>
              {report.gaps.length} página{report.gaps.length > 1 ? 's' : ''} sin marcador propio
              (se pliegan a la siguiente): {report.gaps.slice(0, 15).join(', ')}
              {report.gaps.length > 15 ? '…' : ''}
            </p>
          )}
          {report.warnings.some((w) => w.type === 'pdf_unavailable') && (
            <p className="error" style={{ margin: '0.25rem 0 0' }}>
              ⚠️ No se pudo verificar contra el PDF — se usó la numeración del documento SIN
              corregir. Revisá si es la que querías.
            </p>
          )}
          {report.warnings.some((w) => w.type === 'already_paginated') && (
            <p className="hint" style={{ margin: '0.25rem 0 0' }}>
              El markdown ya tenía marcadores de una corrida anterior — se sacaron y se volvió a
              paginar de cero.
            </p>
          )}
          {report.warnings.length > 0 && (
            <p className="hint" style={{ margin: '0.25rem 0 0' }}>
              {report.warnings.length} aviso{report.warnings.length > 1 ? 's' : ''} en total —
              revisá el markdown de abajo antes de asignarlo.
            </p>
          )}
          <p style={{ margin: '0.5rem 0 0', color: '#4ade80' }}>
            El markdown de abajo ya se actualizó con el resultado.
          </p>
        </div>
      )}
    </div>
  );
}

function UploadForm({
  users,
  onCreated,
}: {
  users: AdminUserSummary[];
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [assignedTo, setAssignedTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const assignableUsers = users.filter((u) => u.role !== 'admin');

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    try {
      const text = await file.text();
      setMarkdown(text);
      setFileName(file.name);
      // Si todavía no pusiste título, lo completamos con el nombre del
      // archivo (sin la extensión) para no dejarlo vacío.
      if (!title.trim()) {
        setTitle(file.name.replace(/\.(md|markdown|txt)$/i, ''));
      }
    } catch {
      setError('No se pudo leer el archivo. Prueba pegando el contenido directo.');
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/admin/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, markdown, assignedTo }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No se pudo subir el contenido.');

      setTitle('');
      setMarkdown('');
      setFileName(null);
      setAssignedTo('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setSuccess('Contenido asignado correctamente.');
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="title">Título</label>
      <input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />

      <label htmlFor="assigned">Asignar a</label>
      <select
        id="assigned"
        required
        value={assignedTo}
        onChange={(e) => setAssignedTo(e.target.value)}
      >
        <option value="" disabled>
          Seleccioná un usuario…
        </option>
        {assignableUsers.map((u) => (
          <option key={u.id} value={u.id}>
            {u.email} ({u.role})
          </option>
        ))}
      </select>
      {assignableUsers.length === 0 && (
        <p className="hint">
          No hay usuarios demo/pago todavía. Creá uno primero en{' '}
          <Link href="/admin/users">Usuarios</Link>.
        </p>
      )}

      <label htmlFor="md-file">Cargar desde archivo (opcional)</label>
      <input
        id="md-file"
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        onChange={handleFileChange}
      />
      {fileName && <p className="hint">Cargado: {fileName}</p>}

      <label htmlFor="markdown">Contenido (markdown)</label>
      <textarea
        id="markdown"
        required
        value={markdown}
        onChange={(e) => {
          setMarkdown(e.target.value);
          setFileName(null); // si lo edita a mano, ya no es "el archivo tal cual"
        }}
        placeholder="# Tema&#10;&#10;Contenido del material ya convertido a markdown… (o cargalo desde un archivo arriba)"
      />
      <p className="hint">
        {markdown.length.toLocaleString('es-PE')} / 1.000.000 caracteres
        {markdown.length > 1_000_000 && ' — supera el máximo permitido'}
      </p>

      <PaginateAssist markdown={markdown} onResult={setMarkdown} />

      <button type="submit" disabled={saving}>
        {saving ? 'Subiendo…' : 'Asignar contenido'}
      </button>
      {error && <p className="error">{error}</p>}
      {success && <p style={{ color: '#4ade80', fontSize: '0.875rem' }}>{success}</p>}
    </form>
  );
}
