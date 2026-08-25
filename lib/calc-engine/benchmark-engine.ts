/**
 * Peer benchmarking & normalization (Blueprint v2.0 §6).
 *
 * Percentile rank is used instead of raw z-score because several metrics
 * (profit, value_per_hour) are fat-tailed and non-normal in the real
 * data (confirmed during the Blueprint v1 analysis — e.g. a single 2024
 * row at −6.99M THB alongside a peer-group mean of ~1,185 THB/hr).
 * Percentile rank is robust to this without assuming a distribution shape.
 */

export const MIN_PEER_GROUP_SAMPLE_SIZE = 5;
const WINSORIZE_LOWER = 0.01;
const WINSORIZE_UPPER = 0.99;

export interface PeerDistributionStats {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  mean: number;
  median: number;
  mad: number; // median absolute deviation — robust spread measure
  sampleSize: number;
}

/** Winsorizes a metric array at p1/p99 to prevent a single extreme
 * outlier row (of the class found in the real 2024–2026 data) from
 * distorting the whole peer distribution. */
export function winsorize(values: number[]): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const lowerBound = percentile(sorted, WINSORIZE_LOWER);
  const upperBound = percentile(sorted, WINSORIZE_UPPER);
  return values.map((v) => Math.min(Math.max(v, lowerBound), upperBound));
}

export function computePeerDistributionStats(rawValues: number[]): PeerDistributionStats | null {
  if (rawValues.length < MIN_PEER_GROUP_SAMPLE_SIZE) return null;

  const winsorized = winsorize(rawValues);
  const sorted = [...winsorized].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const median = percentile(sorted, 0.5);
  const absDeviations = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = percentile(absDeviations, 0.5);

  return {
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p50: median,
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    mean: round2(mean),
    median: round2(median),
    mad: round2(mad),
    sampleSize: rawValues.length,
  };
}

/**
 * Percentile rank of `value` within `peerValues` (winsorized), returned
 * as a 0–100 score. This is the normalization step every Layer 2 metric
 * goes through before it can become a Layer 1 dimension score.
 * Returns null if the peer group is below the minimum sample size —
 * callers must fall back to a wider grouping and log that fact, never
 * silently benchmark against too few peers (Blueprint v2.0 §6).
 */
export function percentileRank(value: number, peerValues: number[]): number | null {
  if (peerValues.length < MIN_PEER_GROUP_SAMPLE_SIZE) return null;

  const winsorized = winsorize(peerValues);
  const clamped = Math.min(Math.max(value, Math.min(...winsorized)), Math.max(...winsorized));
  const countBelow = winsorized.filter((v) => v < clamped).length;
  const countEqual = winsorized.filter((v) => v === clamped).length;

  // Standard midpoint percentile-rank formula, avoids bias at ties.
  const rank = (countBelow + 0.5 * countEqual) / winsorized.length;
  return round2(rank * 100);
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = (sortedAsc.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedAsc[lower]!;
  const weight = idx - lower;
  return sortedAsc[lower]! * (1 - weight) + sortedAsc[upper]! * weight;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
