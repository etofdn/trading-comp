// ── Leaderboard computation — sorted in-place after each tick ──

import { state } from './state.ts';
import { SEASON } from '../config.ts';
import type { LeaderboardEntry } from '../types.ts';

/**
 * Compute portfolio values and rank all players.
 * Returns the top N entries for broadcast.
 */
export function buildLeaderboard(): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];

  for (const player of state.players.values()) {
    let positionsValue = 0;
    let stakesValue = 0;

    // Sum positions
    for (const pos of state.positions.values()) {
      if (pos.playerId === player.id) {
        positionsValue += pos.currentValue;
      }
    }

    // Sum stakes (share value + accumulated yield)
    for (const stake of state.stakes.values()) {
      if (stake.playerId === player.id) {
        const asset = state.assets.get(stake.assetId);
        if (asset) {
          stakesValue +=
            stake.stakedShares * asset.spotPrice +
            stake.accumulatedYield;
        }
      }
    }

    const totalValue =
      player.usdcBalance + positionsValue + stakesValue;
    const startingCapital =
      SEASON.startingBalance + player.bonusCapital;
    const returnPct =
      ((totalValue - startingCapital) / startingCapital) * 100;

    const prevRank =
      state.previousRanks.get(player.id) ?? 0;

    entries.push({
      playerId: player.id,
      twitterHandle: player.twitterHandle,
      avatarUrl: player.avatarUrl,
      totalReturnPct: returnPct,
      rank: 0,
      rankDelta: 0,
      totalValue,
    });
  }

  // Sort by return % descending
  entries.sort((a, b) => b.totalReturnPct - a.totalReturnPct);

  // Assign ranks and compute deltas
  const newRanks = new Map<string, number>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const rank = i + 1;
    const prevRank =
      state.previousRanks.get(entry.playerId) ?? rank;

    // Mutate rank fields (these are the only mutable fields)
    (entry as { rank: number }).rank = rank;
    (entry as { rankDelta: number }).rankDelta = prevRank - rank;

    newRanks.set(entry.playerId, rank);
  }

  state.previousRanks = newRanks;

  return entries.slice(0, SEASON.leaderboardSize);
}
