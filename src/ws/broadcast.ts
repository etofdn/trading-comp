// ── WebSocket hub — tick broadcast + per-player portfolio updates ──

import type { ServerWebSocket } from 'bun';
import { state } from '../engine/state.ts';
import { SEASON } from '../config.ts';
import type {
  TickBroadcast,
  WindowedLeaderboard,
  LeaderboardEntry,
  WsOutgoingMessage,
} from '../types.ts';

export interface WsData {
  playerId: string;
}

const clients = new Map<string, ServerWebSocket<WsData>>();

export function registerClient(
  playerId: string,
  ws: ServerWebSocket<WsData>,
): void {
  clients.set(playerId, ws);
}

export function removeClient(playerId: string): void {
  clients.delete(playerId);
}

export function getClientCount(): number {
  return clients.size;
}

/** Strip totalValue from leaderboard entries (private data). */
function stripPrivateFields(entries: readonly LeaderboardEntry[]) {
  return entries.map((e) => ({
    playerId: e.playerId,
    twitterHandle: e.twitterHandle,
    avatarUrl: e.avatarUrl,
    totalReturnPct: e.totalReturnPct,
    rank: e.rank,
    rankDelta: e.rankDelta,
  }));
}

/** Broadcast tick + windowed leaderboards to ALL connected clients. */
export function broadcastTick(
  payload: TickBroadcast,
  windowed: WindowedLeaderboard,
): void {
  if (clients.size === 0) return;

  const encoded = JSON.stringify({
    type: 'tick',
    data: {
      timestamp: payload.timestamp,
      leaderboard: stripPrivateFields(windowed.overall),
      leaderboard24h: stripPrivateFields(windowed['24h']),
      leaderboard7d: stripPrivateFields(windowed['7d']),
      tickMs: payload.tickMs,
    },
  });

  for (const ws of clients.values()) {
    try {
      ws.send(encoded);
    } catch {
      // Client disconnected — will be cleaned up on close
    }
  }
}

/** Send individual portfolio updates to each connected player. */
export function sendPlayerUpdates(): void {
  for (const [playerId, ws] of clients) {
    try {
      const update = buildPortfolioUpdate(playerId);
      if (update) {
        ws.send(JSON.stringify(update));
      }
    } catch {
      // Client disconnected
    }
  }
}

function buildPortfolioUpdate(
  playerId: string,
): WsOutgoingMessage | null {
  const player = state.players.get(playerId);
  if (!player) return null;

  let positionsValue = 0;
  const positions = [];

  for (const pos of state.positions.values()) {
    if (pos.playerId !== playerId) continue;
    positionsValue += pos.currentValue;
    const asset = state.assets.get(pos.assetId);
    positions.push({
      assetId: pos.assetId,
      assetName: asset?.name ?? 'Unknown',
      shares: pos.shares,
      currentValue: pos.currentValue,
      pnl: pos.unrealizedPnl,
      pnlPct: pos.unrealizedPnlPct * 100,
    });
  }

  let stakesValue = 0;
  const stakes = [];

  for (const stake of state.stakes.values()) {
    if (stake.playerId !== playerId) continue;
    const asset = state.assets.get(stake.assetId);
    const shareValue = asset
      ? stake.stakedShares * asset.spotPrice
      : 0;
    stakesValue += shareValue + stake.accumulatedYield;
    stakes.push({
      assetId: stake.assetId,
      assetName: asset?.name ?? 'Unknown',
      stakedShares: stake.stakedShares,
      value: shareValue,
      yield: stake.accumulatedYield,
    });
  }

  const totalValue =
    player.usdcBalance + positionsValue + stakesValue;
  const startingCapital =
    SEASON.startingBalance + player.bonusCapital;
  const returnPct =
    ((totalValue - startingCapital) / startingCapital) * 100;

  return {
    type: 'portfolio',
    data: {
      usdcBalance: player.usdcBalance,
      totalValue,
      returnPct,
      positions,
      stakes,
    },
  };
}
