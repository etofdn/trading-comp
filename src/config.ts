// ── Season and runtime configuration ──

import type { SeasonConfig } from './types.ts';

export const SEASON: SeasonConfig = {
  startingBalance: 100_000,
  seasonDurationDays: 21,
  baseAnnualYieldBps: 1200,
  royaltyRateBps: 300,
  maxConstituents: 10,
  tickIntervalMs: 2000,
  referralBonuses: [10_000, 30_000, 50_000, 10_000],
  leaderboardSize: 100,
} as const;

export const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
export const FLOAT_EPSILON = 0.0001;
export const MAX_ACTIONS_PER_SECOND = 10;
export const PRICE_STALENESS_THRESHOLD_MS = 5_000;

// ── Pyth Hermes feed IDs (hex, no 0x prefix) ──
// These are mainnet Pyth price feed IDs
export const PYTH_FEEDS: Record<string, { name: string; symbol: string }> = {
  'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43':
    { name: 'Bitcoin', symbol: 'BTC' },
  'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace':
    { name: 'Ethereum', symbol: 'ETH' },
  'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d':
    { name: 'Solana', symbol: 'SOL' },
  '93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7':
    { name: 'Avalanche', symbol: 'AVAX' },
  'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a':
    { name: 'USDC', symbol: 'USDC' },
  '8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221':
    { name: 'Chainlink', symbol: 'LINK' },
  'b0948a5e5313200c632b51bb5ca32f6de0d36e9950a942d19751e833f70dabfd':
    { name: 'Dogecoin', symbol: 'DOGE' },
  'c96458d393fe9deb7a7d63a0ac41e2898a67a7750dbd166673c4e3e8784aa18d':
    { name: 'Sui', symbol: 'SUI' },
  '2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b':
    { name: 'BNB', symbol: 'BNB' },
  'dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c':
    { name: 'Dogwifhat', symbol: 'WIF' },
} as const;

// ── FRED series for macro/commodity feeds ──
export const FRED_FEEDS = [
  {
    id: 'CPIAUCSL',
    name: 'CPI (Consumer Price Index)',
    symbol: 'CPI',
    category: 'macro' as const,
    scaleFactor: 1,
  },
  {
    id: 'DCOILWTICO',
    name: 'WTI Crude Oil',
    symbol: 'OIL',
    category: 'commodity' as const,
    scaleFactor: 1,
  },
  {
    id: 'GOLDAMGBD228NLBM',
    name: 'Gold (London Fix)',
    symbol: 'GOLD',
    category: 'commodity' as const,
    scaleFactor: 1,
  },
  {
    id: 'DFF',
    name: 'Federal Funds Rate',
    symbol: 'FFR',
    category: 'macro' as const,
    scaleFactor: 100,
  },
  {
    id: 'DTWEXBGS',
    name: 'USD Trade-Weighted Index',
    symbol: 'DXY',
    category: 'macro' as const,
    scaleFactor: 1,
  },
] as const;

// ── Environment variable helpers ──
export function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

export function optionalEnv(
  key: string,
  fallback: string,
): string {
  return process.env[key] ?? fallback;
}
