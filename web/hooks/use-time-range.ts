'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback, useMemo } from 'react';

export type RangePreset = '15m' | '1h' | '4h' | '1d' | '7d' | '30d' | 'custom';

export function useTimeRange() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const range = (searchParams.get('range') as RangePreset) || '7d';
  const customStart = searchParams.get('start') || '';
  const customEnd = searchParams.get('end') || '';

  const { start, end } = useMemo(() => {
    if (range === 'custom' && customStart && customEnd) {
      return { start: customStart, end: customEnd };
    }
    const now = new Date();
    const ms: Record<string, number> = {
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };
    const offset = ms[range] || ms['7d'];
    return {
      start: new Date(now.getTime() - offset).toISOString(),
      end: now.toISOString(),
    };
  }, [range, customStart, customEnd]);

  const setRange = useCallback(
    (newRange: RangePreset, newStart?: string, newEnd?: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('range', newRange);
      if (newRange === 'custom' && newStart && newEnd) {
        params.set('start', newStart);
        params.set('end', newEnd);
      } else {
        params.delete('start');
        params.delete('end');
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  return { range, start, end, setRange };
}
