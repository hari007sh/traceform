'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface PlanFeatures {
  sso: boolean;
  auditLog: boolean;
  dataExport: boolean;
  customRoles: boolean;
}

export interface PlanInfo {
  plan: string;
  eventsThisMonth: number;
  eventsLimit: number;
  usagePercent: number;
  teamMembers: number;
  teamLimit: number;
  webhooks: number;
  webhooksLimit: number;
  retentionDays: number;
  apiRateLimit: number;
  features: PlanFeatures;
}

interface UsageAPIResponse {
  plan: string;
  events_this_month: number;
  events_limit: number;
  usage_percent: number;
  team_members: number;
  team_limit: number;
  webhooks: number;
  webhooks_limit: number;
  retention_days: number;
  api_rate_limit: number;
  features: {
    sso: boolean;
    audit_log: boolean;
    data_export: boolean;
    custom_roles: boolean;
  };
}

export function usePlan(): { plan: PlanInfo | null; loading: boolean } {
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }

    api.setToken(token);
    api
      .get<UsageAPIResponse>('/api/usage')
      .then((data) => {
        setPlan({
          plan: data.plan,
          eventsThisMonth: data.events_this_month,
          eventsLimit: data.events_limit,
          usagePercent: data.usage_percent,
          teamMembers: data.team_members,
          teamLimit: data.team_limit,
          webhooks: data.webhooks,
          webhooksLimit: data.webhooks_limit,
          retentionDays: data.retention_days,
          apiRateLimit: data.api_rate_limit,
          features: {
            sso: data.features.sso,
            auditLog: data.features.audit_log,
            dataExport: data.features.data_export,
            customRoles: data.features.custom_roles,
          },
        });
      })
      .catch(() => {
        // Fail gracefully — treat as free plan
        setPlan(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return { plan, loading };
}
