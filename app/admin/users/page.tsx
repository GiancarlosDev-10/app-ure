'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { AdminUserSummary, Role } from '@/types';

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  demo: 'Demo',
  paid: 'Pago',
};

const DEFAULT_EXPIRATION = '2026-09-30';
const DEFAULT_LIMIT = 2000;

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  async function loadUsers() {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch('/api/admin/users');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar la lista.');
      setUsers(json.users);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Error inesperado.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  return (
    <main className="container-wide">
      <nav className="nav-links">
        <Link href="/admin">← Panel</Link>
        <Link href="/admin/content">Contenido</Link>
      </nav>

      <div className="card">
        <h1>Usuarios</h1>
        <CreateUserForm onCreated={loadUsers} />
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>Listado</h2>
        {loading && <p className="hint">Cargando…</p>}
        {listError && <p className="error">{listError}</p>}
        {!loading && !listError && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Correo</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Vencimiento</th>
                  <th>Preguntas</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <UserRow key={u.id} user={u} onUpdated={loadUsers} />
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="hint">
                      Todavía no hay usuarios cargados.
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

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('demo');
  const [expirationDate, setExpirationDate] = useState(DEFAULT_EXPIRATION);
  const [questionsLimit, setQuestionsLimit] = useState(DEFAULT_LIMIT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          role,
          expirationDate,
          questionsLimit,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No se pudo crear el usuario.');

      setEmail('');
      setPassword('');
      setRole('demo');
      setExpirationDate(DEFAULT_EXPIRATION);
      setQuestionsLimit(DEFAULT_LIMIT);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid-form">
        <div>
          <label htmlFor="new-email">Correo</label>
          <input
            id="new-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="new-password">Contraseña temporal</label>
          <input
            id="new-password"
            type="text"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="new-role">Rol</label>
          <select id="new-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="demo">Demo</option>
            <option value="paid">Pago</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label htmlFor="new-expiration">Vencimiento</label>
          <input
            id="new-expiration"
            type="date"
            value={expirationDate}
            onChange={(e) => setExpirationDate(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="new-limit">Límite de preguntas</label>
          <input
            id="new-limit"
            type="number"
            min={1}
            value={questionsLimit}
            onChange={(e) => setQuestionsLimit(Number(e.target.value))}
          />
        </div>
      </div>

      <button type="submit" disabled={saving}>
        {saving ? 'Creando…' : 'Crear usuario'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function UserRow({ user, onUpdated }: { user: AdminUserSummary; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState<Role>(user.role);
  const [active, setActive] = useState(user.active);
  const [expirationDate, setExpirationDate] = useState(user.expiration_date);
  const [questionsLimit, setQuestionsLimit] = useState(user.questions_limit);
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        role,
        active,
        expirationDate,
        questionsLimit,
      };
      if (newPassword) body.password = newPassword;

      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No se pudo actualizar.');

      setNewPassword('');
      setEditing(false);
      onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActiveQuick() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !user.active }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No se pudo actualizar.');
      onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <tr>
        <td>{user.email}</td>
        <td>
          <span className={`badge badge-${user.role}`}>{ROLE_LABEL[user.role]}</span>
        </td>
        <td>
          <span className={`badge ${user.active ? 'badge-active' : 'badge-inactive'}`}>
            {user.active ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td>{user.expiration_date}</td>
        <td>
          {user.questions_used} / {user.questions_limit}
        </td>
        <td>
          <div className="toolbar">
            <button
              type="button"
              className="btn-secondary"
              disabled={saving}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? 'Cerrar' : 'Gestionar'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={saving}
              onClick={toggleActiveQuick}
            >
              {user.active ? 'Desactivar' : 'Activar'}
            </button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={6}>
            <div className="grid-form">
              <div>
                <label htmlFor={`role-${user.id}`}>Rol</label>
                <select
                  id={`role-${user.id}`}
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  <option value="demo">Demo</option>
                  <option value="paid">Pago</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label htmlFor={`active-${user.id}`}>Estado</label>
                <select
                  id={`active-${user.id}`}
                  value={active ? '1' : '0'}
                  onChange={(e) => setActive(e.target.value === '1')}
                >
                  <option value="1">Activo</option>
                  <option value="0">Inactivo</option>
                </select>
              </div>
              <div>
                <label htmlFor={`exp-${user.id}`}>Vencimiento</label>
                <input
                  id={`exp-${user.id}`}
                  type="date"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`limit-${user.id}`}>Límite de preguntas</label>
                <input
                  id={`limit-${user.id}`}
                  type="number"
                  min={1}
                  value={questionsLimit}
                  onChange={(e) => setQuestionsLimit(Number(e.target.value))}
                />
              </div>
              <div>
                <label htmlFor={`pass-${user.id}`}>Nueva contraseña (opcional)</label>
                <input
                  id={`pass-${user.id}`}
                  type="text"
                  minLength={8}
                  placeholder="Dejar vacío para no cambiar"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
            </div>
            <p className="hint">
              Resetear la contraseña cierra cualquier sesión activa de esta cuenta.
            </p>
            <button type="button" disabled={saving} onClick={save}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
            {error && <p className="error">{error}</p>}
          </td>
        </tr>
      )}
    </>
  );
}
