'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import type { AdminContentSummary, AdminUserSummary } from '@/types';

export default function AdminContentPage() {
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
                </tr>
              </thead>
              <tbody>
                {content.map((c) => (
                  <tr key={c.id}>
                    <td>{c.title}</td>
                    <td>{c.assigned_user?.email ?? '—'}</td>
                    <td>
                      <span className={`badge ${c.active ? 'badge-active' : 'badge-inactive'}`}>
                        {c.active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td>{new Date(c.created_at).toLocaleDateString('es-PE')}</td>
                  </tr>
                ))}
                {content.length === 0 && (
                  <tr>
                    <td colSpan={4} className="hint">
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
      setError('No se pudo leer el archivo. Probá pegando el contenido directo.');
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
        {markdown.length.toLocaleString('es-PE')} / 200.000 caracteres
        {markdown.length > 200_000 && ' — supera el máximo permitido'}
      </p>

      <button type="submit" disabled={saving}>
        {saving ? 'Subiendo…' : 'Asignar contenido'}
      </button>
      {error && <p className="error">{error}</p>}
      {success && <p style={{ color: '#4ade80', fontSize: '0.875rem' }}>{success}</p>}
    </form>
  );
}
