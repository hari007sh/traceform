'use client';
import { useAuth } from '@/hooks/use-auth';

const ROLE_LEVELS: Record<string, number> = {
  viewer: 1,
  member: 1,
  admin: 2,
  owner: 3,
};

interface Props {
  role: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function RequireRole({ role, children, fallback = null }: Props) {
  const auth = useAuth();
  const userLevel = ROLE_LEVELS[auth?.role || ''] || 0;
  const requiredLevel = ROLE_LEVELS[role] || 99;
  if (userLevel < requiredLevel) return <>{fallback}</>;
  return <>{children}</>;
}
