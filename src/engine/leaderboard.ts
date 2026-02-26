// ── Leaderboard computation — sorted in-place after each tick ──
// Supports three windows: overall, 24h, 7d

import { state } from './state.ts';
import { SEASON } from '../config.ts';
import type { LeaderboardEntry, WindowedLeaderboard } from '../types.ts';

const MS_24H = 24 * 60 * 60 * 1000;
const MS_7D = 7 * 24 * 60 * 60 * 1000;

/** Cached result from the last tick, served by REST endpoint. */
let cachedLeaderboard: WindowedLeaderboard | null = null;

export function getCachedLeaderboard(): WindowedLeaderboard {
  if (cachedLeaderboard) return cachedLeaderboard;
  return buildLeaderboard();
}

/** Compute portfolio value for a single player (used by both overall and windowed). */
function computePortfolioValue(playerId: string): number {
  const player = state.players.get(playerId);
  if (!player) return 0;

  let positionsValue = 0;
  for (const pos of state.positions.values()) {
    if (pos.playerId === playerId) {
      positionsValue += pos.currentValue;
    }
  }

  let stakesValue = 0;
  for (const stake of state.stakes.values()) {
    if (stake.playerId === playerId) {
      const asset = state.assets.get(stake.assetId);
      if (asset) {
        stakesValue +=
          stake.stakedShares * asset.spotPrice +
          stake.accumulatedYield;
      }
    }
  }

  return player.usdcBalance + positionsValue + stakesValue;
}

/** Find the closest portfolio snapshot to a target timestamp for a player. */
function getSnapshotValueAt(playerId: string, targetTs: number): number | null {
  const snapshots = state.portfolioSnapshots.get(playerId);
  if (!snapshots || snapshots.length === 0) return null;

  // Find the snapshot closest to (but not after) the target timestamp
  let best: number | null = null;
  for (const snap of snapshots) {
    if (snap.timestamp <= targetTs) {
      best = snap.totalValue;
    } else {
      break; // snapshots are ordered by time
    }
  }
  return best;
}

/** Rank and slice a list of entries. Tie-break: fewer trades wins, then earlier createdAt. */
function rankEntries(
  entries: { playerId: string; returnPct: number }[],
): LeaderboardEntry[] {
  // Count trades per player for tie-breaking
  const tradeCounts = new Map<string, number>();
  for (const t of state.trades) {
    tradeCounts.set(t.playerId, (tradeCounts.get(t.playerId) ?? 0) + 1);
  }

  entries.sort((a, b) => {
    // Primary: return % descending
    if (b.returnPct !== a.returnPct) return b.returnPct - a.returnPct;
    // Tie-break 1: fewer trades is better
    const aTrades = tradeCounts.get(a.playerId) ?? 0;
    const bTrades = tradeCounts.get(b.playerId) ?? 0;
    if (aTrades !== bTrades) return aTrades - bTrades;
    // Tie-break 2: earlier join is better
    const aCreated = state.players.get(a.playerId)?.createdAt ?? 0;
    const bCreated = state.players.get(b.playerId)?.createdAt ?? 0;
    return aCreated - bCreated;
  });

  const ranked: LeaderboardEntry[] = [];

  for (let i = 0; i < Math.min(entries.length, SEASON.leaderboardSize); i++) {
    const entry = entries[i]!;
    const rank = i + 1;
    // rankDelta is always relative to overall rankings (set by buildLeaderboard)
    const prevRank = state.previousRanks.get(entry.playerId) ?? rank;
    const player = state.players.get(entry.playerId);

    ranked.push({
      playerId: entry.playerId,
      twitterHandle: player?.twitterHandle ?? 'unknown',
      avatarUrl: player?.avatarUrl ?? '',
      totalReturnPct: entry.returnPct,
      rank,
      rankDelta: prevRank - rank,
      totalValue: 0, // stripped before broadcast
    });
  }

  return ranked;
}

/**
 * Build all three leaderboard windows.
 * Also records portfolio snapshots for windowed lookups and updates previousRanks.
 */
export function buildLeaderboard(): WindowedLeaderboard {
  const now = Date.now();
  const overallEntries: { playerId: string; returnPct: number }[] = [];
  const entries24h: { playerId: string; returnPct: number }[] = [];
  const entries7d: { playerId: string; returnPct: number }[] = [];

  for (const player of state.players.values()) {
    const currentValue = computePortfolioValue(player.id);
    const startingCapital = SEASON.startingBalance + player.bonusCapital;

    // Overall return
    const overallReturn =
      ((currentValue - startingCapital) / startingCapital) * 100;
    overallEntries.push({ playerId: player.id, returnPct: overallReturn });

    // 24h return (from snapshot ~24h ago)
    const value24hAgo = getSnapshotValueAt(player.id, now - MS_24H);
    if (value24hAgo !== null && value24hAgo > 0) {
      const return24h = ((currentValue - value24hAgo) / value24hAgo) * 100;
      entries24h.push({ playerId: player.id, returnPct: return24h });
    } else {
      // No snapshot old enough — use overall return as fallback
      entries24h.push({ playerId: player.id, returnPct: overallReturn });
    }

    // 7d return (from snapshot ~7d ago)
    const value7dAgo = getSnapshotValueAt(player.id, now - MS_7D);
    if (value7dAgo !== null && value7dAgo > 0) {
      const return7d = ((currentValue - value7dAgo) / value7dAgo) * 100;
      entries7d.push({ playerId: player.id, returnPct: return7d });
    } else {
      entries7d.push({ playerId: player.id, returnPct: overallReturn });
    }
  }

  const overall = rankEntries(overallEntries);

  // Update previousRanks from overall ranking (used for rankDelta)
  const newRanks = new Map<string, number>();
  for (const entry of overall) {
    newRanks.set(entry.playerId, entry.rank);
  }
  state.previousRanks = newRanks;

  const result: WindowedLeaderboard = {
    overall,
    '24h': rankEntries(entries24h),
    '7d': rankEntries(entries7d),
  };

  cachedLeaderboard = result;
  return result;
}

/** Take a portfolio snapshot for all players (called periodically from tick). */
export function takePortfolioSnapshots(): void {
  const now = Date.now();
  const maxAge = 8 * 24 * 60 * 60 * 1000; // keep 8 days of snapshots

  for (const player of state.players.values()) {
    const value = computePortfolioValue(player.id);
    const snap = { playerId: player.id, totalValue: value, timestamp: now };

    let snapshots = state.portfolioSnapshots.get(player.id);
    if (!snapshots) {
      snapshots = [];
      state.portfolioSnapshots.set(player.id, snapshots);
    }
    snapshots.push(snap);

    // Prune old snapshots (older than 8 days)
    const cutoff = now - maxAge;
    const firstValid = snapshots.findIndex((s) => s.timestamp >= cutoff);
    if (firstValid === -1) {
      // All snapshots are older than cutoff — clear entirely
      snapshots.length = 0;
    } else if (firstValid > 0) {
      snapshots.splice(0, firstValid);
    }
  }

  state.portfolioSnapshotsDirty = true;
}
