'use client';

import { signOut } from 'next-auth/react';

export function SignOutButton() {
  return (
    <button type="button" onClick={() => signOut({ callbackUrl: '/login' })}>
      Cerrar sesión
    </button>
  );
}
