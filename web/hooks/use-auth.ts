'use client';
import { useMemo } from 'react';

interface AuthContext {
  userId: string;
  orgId: string;
  email: string;
  role: string;
  isOwner: boolean;
  isAdmin: boolean;
  canWrite: boolean;
}

export function useAuth(): AuthContext | null {
  return useMemo(() => {
    if (typeof window === 'undefined') return null;
    const token = localStorage.getItem('token');
    if (!token) return null;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const role = payload.role || 'viewer';
      return {
        userId: payload.user_id || '',
        orgId: payload.org_id || '',
        email: payload.email || '',
        role,
        isOwner: role === 'owner',
        isAdmin: role === 'admin' || role === 'owner',
        canWrite: role === 'admin' || role === 'owner',
      };
    } catch {
      return null;
    }
  }, []);
}
