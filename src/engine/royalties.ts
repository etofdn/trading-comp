// ── Creator royalty computation ──
// Royalties are computed at sell-time in actions.ts (inline).
// This module tracks aggregate royalty stats for API responses.

import { state } from './state.ts';

interface RoyaltyStats {
  readonly creatorId: string;
  readonly assetId: string;
  totalRoyaltiesEarned: number;
}

const royaltyLedger = new Map<string, RoyaltyStats>();

export function recordRoyalty(
  creatorId: string,
  assetId: string,
  amount: number,
): void {
  const key = `${creatorId}:${assetId}`;
  const existing = royaltyLedger.get(key);
  if (existing) {
    existing.totalRoyaltiesEarned += amount;
  } else {
    royaltyLedger.set(key, {
      creatorId,
      assetId,
      totalRoyaltiesEarned: amount,
    });
  }
}

export function getCreatorRoyalties(
  creatorId: string,
): RoyaltyStats[] {
  const result: RoyaltyStats[] = [];
  for (const stats of royaltyLedger.values()) {
    if (stats.creatorId === creatorId) {
      result.push(stats);
    }
  }
  return result;
}

export function getTopCreators(
  limit: number,
): Array<{
  creatorId: string;
  handle: string;
  totalEarned: number;
  assetsCreated: number;
  totalClones: number;
}> {
  // Aggregate per creator
  const creatorMap = new Map<
    string,
    { totalEarned: number; assetsCreated: number; totalClones: number }
  >();

  for (const asset of state.assets.values()) {
    const existing = creatorMap.get(asset.creatorId);
    if (existing) {
      existing.assetsCreated++;
      existing.totalClones += asset.cloneCount;
    } else {
      creatorMap.set(asset.creatorId, {
        totalEarned: 0,
        assetsCreated: 1,
        totalClones: asset.cloneCount,
      });
    }
  }

  for (const stats of royaltyLedger.values()) {
    const existing = creatorMap.get(stats.creatorId);
    if (existing) {
      existing.totalEarned += stats.totalRoyaltiesEarned;
    }
  }

  const entries = [...creatorMap.entries()]
    .map(([creatorId, data]) => {
      const player = state.players.get(creatorId);
      return {
        creatorId,
        handle: player?.twitterHandle ?? 'unknown',
        ...data,
      };
    })
    .sort((a, b) => b.totalEarned - a.totalEarned)
    .slice(0, limit);

  return entries;
}
