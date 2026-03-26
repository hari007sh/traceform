'use client';

import { Suspense } from 'react';
import { motion } from 'framer-motion';
import { useTimeRange, type RangePreset } from '@/hooks/use-time-range';

const presets: { label: string; value: RangePreset }[] = [
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '4h', value: '4h' },
  { label: '1d', value: '1d' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
];

function TimeRangePickerInner() {
  const { range, setRange } = useTimeRange();

  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
      {presets.map((preset) => {
        const isActive = range === preset.value;
        return (
          <motion.button
            key={preset.value}
            onClick={() => setRange(preset.value)}
            whileTap={{ scale: 0.96 }}
            className={`relative px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors duration-150 ${
              isActive
                ? 'bg-[var(--accent-blue)] text-white shadow-sm'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            {preset.label}
          </motion.button>
        );
      })}
    </div>
  );
}

export function TimeRangePicker() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
          {presets.map((preset) => (
            <div
              key={preset.value}
              className="px-2.5 py-1 text-[11px] font-medium rounded-md text-[var(--text-tertiary)]"
            >
              {preset.label}
            </div>
          ))}
        </div>
      }
    >
      <TimeRangePickerInner />
    </Suspense>
  );
}
