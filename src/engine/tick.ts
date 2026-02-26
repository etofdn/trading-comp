// ── Tick engine — the heartbeat of the trading competition ──
// Runs every 2 seconds, recomputes all prices/positions/leaderboard

import { state } from './state.ts';
import { priceCache } from '../feeds/cache.ts';
import { buildLeaderboard, takePortfolioSnapshots } from './leaderboard.ts';
import { SEASON, MS_PER_YEAR } from '../config.ts';
import { queuePersistence, queuePriceHistoryPersist } from '../db/persist.ts';
import { broadcastTick, sendPlayerUpdates } from '../ws/broadcast.ts';

let tickTimer: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;

export function startTickEngine(): void {
  if (tickTimer) return;

  console.log(
    `[tick] Starting engine (${SEASON.tickIntervalMs}ms interval)`,
  );

  tickTimer = setInterval(() => {
    runTick();
  }, SEASON.tickIntervalMs);
}

export function stopTickEngine(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
    console.log('[tick] Engine stopped');
  }
}

export function runTick(): void {
  const tickStart = performance.now();
  tickCount++;

  // 1. Snapshot current prices
  const prices = priceCache.snapshot();

  // 2. Recompute all asset spot prices
  for (const asset of state.assets.values()) {
    let spotPrice = 0;
    for (const c of asset.constituents) {
      spotPrice += c.weight * (prices.get(c.feedId) ?? 0);
    }
    asset.spotPrice = spotPrice;

    // Ring buffer: keep last ~43200 ticks (24h at 2s intervals)
    asset.spotPriceHistory.push(spotPrice);
    if (asset.spotPriceHistory.length > 43_200) {
      asset.spotPriceHistory.shift();
    }
  }

  // 3. Recompute all position values
  for (const pos of state.positions.values()) {
    const asset = state.assets.get(pos.assetId);
    if (!asset) continue;
    pos.currentValue = pos.shares * asset.spotPrice;
    pos.unrealizedPnl = pos.currentValue - pos.entryValue;
    pos.unrealizedPnlPct =
      pos.entryValue > 0
        ? pos.unrealizedPnl / pos.entryValue
        : 0;
  }

  // 4. Compute staking yield
  const yieldPerTick =
    (SEASON.baseAnnualYieldBps / 10_000) *
    (SEASON.tickIntervalMs / MS_PER_YEAR);

  for (const stake of state.stakes.values()) {
    const asset = state.assets.get(stake.assetId);
    if (!asset) continue;
    const baseYield =
      yieldPerTick * stake.stakedShares * asset.spotPrice;
    stake.accumulatedYield += baseYield;
    stake.lastYieldTick = Date.now();
  }

  // 5. Take portfolio snapshots periodically (for 24h/7d windowed leaderboard)
  if (tickCount % SEASON.portfolioSnapshotIntervalTicks === 0) {
    takePortfolioSnapshots();
  }

  // 6. Build windowed leaderboard
  const leaderboard = buildLeaderboard();

  const tickMs = performance.now() - tickStart;

  // 7. Broadcast to all connected clients
  broadcastTick({
    timestamp: Date.now(),
    leaderboard: leaderboard.overall,
    leaderboard24h: leaderboard['24h'],
    leaderboard7d: leaderboard['7d'],
    tickMs,
  });

  // 8. Send individual portfolio updates
  sendPlayerUpdates();

  // 9. Async persistence (non-blocking)
  queuePersistence();

  // 10. Persist price history periodically (~every minute)
  if (tickCount % SEASON.priceSnapshotIntervalTicks === 0) {
    queuePriceHistoryPersist(prices);
  }

  // Log every 30 ticks (~1 min)
  if (tickCount % 30 === 0) {
    console.log(
      `[tick] #${tickCount} | ${state.players.size} players | ` +
      `${state.assets.size} assets | ${state.positions.size} positions | ` +
      `${tickMs.toFixed(1)}ms`,
    );
  }
}
