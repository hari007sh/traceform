export interface Point {
  x: number;
  y: number;
  [key: string]: any;
}

/**
 * Largest-Triangle-Three-Buckets (LTTB) downsampling algorithm.
 * Reduces data points while preserving visual shape.
 */
export function lttb<T extends Point>(data: T[], targetCount: number): T[] {
  if (data.length <= targetCount || targetCount < 3) return data;

  const sampled: T[] = [data[0]]; // Always keep first point
  const bucketSize = (data.length - 2) / (targetCount - 2);

  let prevIndex = 0;

  for (let i = 1; i < targetCount - 1; i++) {
    // Calculate average point for next bucket
    const avgRangeStart = Math.floor((i + 0) * bucketSize) + 1;
    const avgRangeEnd = Math.min(
      Math.floor((i + 1) * bucketSize) + 1,
      data.length
    );
    let avgX = 0;
    let avgY = 0;
    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += data[j].x;
      avgY += data[j].y;
    }
    avgX /= avgRangeEnd - avgRangeStart;
    avgY /= avgRangeEnd - avgRangeStart;

    // Find point in current bucket with largest triangle area
    const rangeStart = Math.floor((i - 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor(i * bucketSize) + 1, data.length);
    let maxArea = -1;
    let maxAreaIndex = rangeStart;

    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs(
        (data[prevIndex].x - avgX) * (data[j].y - data[prevIndex].y) -
          (data[prevIndex].x - data[j].x) * (avgY - data[prevIndex].y)
      );
      if (area > maxArea) {
        maxArea = area;
        maxAreaIndex = j;
      }
    }

    sampled.push(data[maxAreaIndex]);
    prevIndex = maxAreaIndex;
  }

  sampled.push(data[data.length - 1]); // Always keep last point
  return sampled;
}

/**
 * Downsample an array of indices using LTTB on associated values.
 * Returns the selected indices from the original array.
 * Useful for stacked charts where all series must share the same x-indices.
 */
export function lttbIndices(
  values: number[],
  targetCount: number
): number[] {
  if (values.length <= targetCount || targetCount < 3) {
    return values.map((_, i) => i);
  }

  const points: Point[] = values.map((v, i) => ({ x: i, y: v }));
  const sampled = lttb(points, targetCount);
  return sampled.map((p) => p.x);
}

/**
 * Calculate optimal label interval to prevent overlap.
 * Returns how many data points to skip between labels.
 */
export function labelInterval(
  dataLength: number,
  maxLabels: number = 10
): number {
  return Math.max(1, Math.ceil(dataLength / maxLabels));
}
