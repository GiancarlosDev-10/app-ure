import type { Role } from '@/types/index';
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    error?: 'SessionInvalidated';
    user?: {
      id: string;
      role: Role;
    } & DefaultSession['user'];
  }

  interface User {
    id: string;
    role: Role;
    sessionToken: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    uid?: string;
    role?: Role;
    sessionToken?: string;
    invalidated?: boolean;
  }
}
