// ── Action processor — synchronous, in-memory mutations ──
// All 6 primitives: create, clone, buy, sell, stake, unstake
// No async, no DB on the hot path.

import { nanoid } from 'nanoid';
import { state } from './state.ts';
import { priceCache } from '../feeds/cache.ts';
import { SEASON, FLOAT_EPSILON } from '../config.ts';
import type {
  Action,
  ActionResult,
  Asset,
  Position,
  StakePosition,
  TradeSide,
} from '../types.ts';

const ROYALTY_RATE = SEASON.royaltyRateBps / 10_000;

export function processAction(
  playerId: string,
  action: Action,
): ActionResult {
  const player = state.players.get(playerId);
  if (!player) {
    return { ok: false, error: 'Player not found' };
  }

  switch (action.type) {
    case 'create':
      return handleCreate(playerId, action.name, action.constituents);
    case 'clone':
      return handleClone(playerId, action.assetId);
    case 'buy':
      return handleBuy(playerId, action.assetId, action.usdcAmount);
    case 'sell':
      return handleSell(playerId, action.assetId, action.shares);
    case 'stake':
      return handleStake(playerId, action.assetId, action.shares);
    case 'unstake':
      return handleUnstake(playerId, action.assetId, action.shares);
    case 'rebalance':
      return handleRebalance(
        playerId,
        action.assetId,
        action.constituents,
      );
  }
}

// ── Create ──
function handleCreate(
  playerId: string,
  name: string,
  constituents: readonly { feedId: string; weight: number }[],
): ActionResult {
  if (!name || name.length > 64) {
    return { ok: false, error: 'Name must be 1-64 characters' };
  }
  if (
    constituents.length === 0 ||
    constituents.length > SEASON.maxConstituents
  ) {
    return {
      ok: false,
      error: `Must have 1-${SEASON.maxConstituents} constituents`,
    };
  }

  const totalWeight = constituents.reduce(
    (sum, c) => sum + c.weight,
    0,
  );
  if (Math.abs(totalWeight - 1) > 0.001) {
    return { ok: false, error: 'Weights must sum to 1.0' };
  }

  for (const c of constituents) {
    if (!priceCache.has(c.feedId)) {
      return { ok: false, error: `Unknown feed: ${c.feedId}` };
    }
    if (c.weight <= 0 || c.weight > 1) {
      return {
        ok: false,
        error: 'Each weight must be between 0 and 1',
      };
    }
  }

  const asset = createAssetRecord(
    name,
    playerId,
    constituents,
    null,
  );
  state.assets.set(asset.id, asset);
  state.dirtyAssets.add(asset.id);

  return { ok: true, assetId: asset.id };
}

// ── Clone ──
function handleClone(
  playerId: string,
  assetId: string,
): ActionResult {
  const original = state.assets.get(assetId);
  if (!original) {
    return { ok: false, error: 'Asset not found' };
  }

  const clone = createAssetRecord(
    `${original.name} (clone)`,
    playerId,
    original.constituents,
    original.id,
  );
  original.cloneCount++;
  state.assets.set(clone.id, clone);
  state.dirtyAssets.add(clone.id);
  state.dirtyAssets.add(original.id);

  return { ok: true, assetId: clone.id };
}

// ── Buy ──
function handleBuy(
  playerId: string,
  assetId: string,
  usdcAmount: number,
): ActionResult {
  const asset = state.assets.get(assetId);
  if (!asset) return { ok: false, error: 'Asset not found' };
  if (!Number.isFinite(usdcAmount) || usdcAmount <= 0) {
    return { ok: false, error: 'Amount must be a positive number' };
  }

  const player = state.players.get(playerId)!;
  if (player.usdcBalance < usdcAmount) {
    return { ok: false, error: 'Insufficient balance' };
  }
  if (asset.spotPrice <= 0) {
    return { ok: false, error: 'Asset has no valid price yet' };
  }

  const shares = usdcAmount / asset.spotPrice;
  player.usdcBalance -= usdcAmount;

  const posKey = `${playerId}:${assetId}`;
  const existing = state.positions.get(posKey);
  if (existing) {
    existing.entryValue += usdcAmount;
    existing.shares += shares;
    existing.entryPrice = existing.entryValue / existing.shares;
  } else {
    const pos: Position = {
      id: posKey,
      playerId,
      assetId,
      shares,
      entryPrice: asset.spotPrice,
      entryValue: usdcAmount,
      currentValue: usdcAmount,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
    };
    state.positions.set(posKey, pos);
  }

  // Mark first trade for referral bonus activation
  if (!player.hasMadeFirstTrade) {
    player.hasMadeFirstTrade = true;
    activateReferralBonus(player.referredBy, playerId);
  }

  recordTrade(playerId, assetId, shares, usdcAmount, 'buy');
  state.dirtyPlayers.add(playerId);
  state.dirtyPositions.add(posKey);

  return { ok: true, shares };
}

// ── Sell ──
function handleSell(
  playerId: string,
  assetId: string,
  sharesToSell: number,
): ActionResult {
  const posKey = `${playerId}:${assetId}`;
  const pos = state.positions.get(posKey);
  if (!pos || pos.shares < sharesToSell) {
    return { ok: false, error: 'Insufficient shares' };
  }
  if (!Number.isFinite(sharesToSell) || sharesToSell <= 0) {
    return { ok: false, error: 'Shares must be a positive number' };
  }

  const asset = state.assets.get(assetId)!;
  const proceeds = sharesToSell * asset.spotPrice;
  const costBasis = (sharesToSell / pos.shares) * pos.entryValue;
  const realizedPnl = proceeds - costBasis;

  // Royalty on cloned assets with positive P&L
  let royaltyPaid = 0;
  if (asset.clonedFromId && realizedPnl > 0) {
    const originalAsset = state.assets.get(asset.clonedFromId);
    if (originalAsset) {
      const isSelfClone =
        originalAsset.creatorId === playerId;
      if (!isSelfClone) {
        royaltyPaid = realizedPnl * ROYALTY_RATE;
        const creator = state.players.get(
          originalAsset.creatorId,
        );
        if (creator) {
          creator.usdcBalance += royaltyPaid;
          state.dirtyPlayers.add(creator.id);
        }
      }
    }
  }

  const player = state.players.get(playerId)!;
  player.usdcBalance += proceeds - royaltyPaid;
  pos.shares -= sharesToSell;
  pos.entryValue -= costBasis;

  if (pos.shares < FLOAT_EPSILON) {
    state.positions.delete(posKey);
  }

  recordTrade(playerId, assetId, sharesToSell, proceeds, 'sell');
  state.dirtyPlayers.add(playerId);
  state.dirtyPositions.add(posKey);

  return { ok: true, proceeds, realizedPnl, royaltyPaid };
}

// ── Stake ──
function handleStake(
  playerId: string,
  assetId: string,
  sharesToStake: number,
): ActionResult {
  if (!Number.isFinite(sharesToStake) || sharesToStake <= 0) {
    return { ok: false, error: 'Shares must be a positive number' };
  }

  const posKey = `${playerId}:${assetId}`;
  const pos = state.positions.get(posKey);
  if (!pos || pos.shares < sharesToStake) {
    return { ok: false, error: 'Insufficient shares' };
  }

  // Move shares from position to stake
  const costBasisMoved =
    (sharesToStake / pos.shares) * pos.entryValue;
  pos.shares -= sharesToStake;
  pos.entryValue -= costBasisMoved;

  if (pos.shares < FLOAT_EPSILON) {
    state.positions.delete(posKey);
  }

  const stakeKey = `${playerId}:${assetId}:stake`;
  const existing = state.stakes.get(stakeKey);
  if (existing) {
    existing.stakedShares += sharesToStake;
    existing.costBasis += costBasisMoved;
  } else {
    const stakePos: StakePosition = {
      id: stakeKey,
      playerId,
      assetId,
      stakedShares: sharesToStake,
      costBasis: costBasisMoved,
      stakedAt: Date.now(),
      accumulatedYield: 0,
      lastYieldTick: Date.now(),
    };
    state.stakes.set(stakeKey, stakePos);
  }

  state.dirtyPositions.add(posKey);
  state.dirtyStakes.add(stakeKey);

  return { ok: true, stakedShares: sharesToStake };
}

// ── Unstake ──
function handleUnstake(
  playerId: string,
  assetId: string,
  sharesToUnstake: number,
): ActionResult {
  if (!Number.isFinite(sharesToUnstake) || sharesToUnstake <= 0) {
    return { ok: false, error: 'Shares must be a positive number' };
  }

  const stakeKey = `${playerId}:${assetId}:stake`;
  const stake = state.stakes.get(stakeKey);
  if (!stake || stake.stakedShares < sharesToUnstake) {
    return { ok: false, error: 'Insufficient stake' };
  }

  // Proportional yield + cost basis collection
  const unstakeRatio = sharesToUnstake / stake.stakedShares;
  const yieldPortion = unstakeRatio * stake.accumulatedYield;
  const costBasisReturned = unstakeRatio * stake.costBasis;

  const player = state.players.get(playerId)!;
  player.usdcBalance += yieldPortion;
  stake.accumulatedYield -= yieldPortion;
  stake.costBasis -= costBasisReturned;
  stake.stakedShares -= sharesToUnstake;

  if (stake.stakedShares < FLOAT_EPSILON) {
    state.stakes.delete(stakeKey);
  }

  // Re-create or add to position using ORIGINAL cost basis
  const posKey = `${playerId}:${assetId}`;
  const asset = state.assets.get(assetId)!;
  const entryPrice =
    costBasisReturned > 0 && sharesToUnstake > 0
      ? costBasisReturned / sharesToUnstake
      : asset.spotPrice;
  const existing = state.positions.get(posKey);

  if (existing) {
    existing.shares += sharesToUnstake;
    existing.entryValue += costBasisReturned;
    existing.entryPrice = existing.entryValue / existing.shares;
  } else {
    const currentValue = sharesToUnstake * asset.spotPrice;
    const pos: Position = {
      id: posKey,
      playerId,
      assetId,
      shares: sharesToUnstake,
      entryPrice,
      entryValue: costBasisReturned,
      currentValue,
      unrealizedPnl: currentValue - costBasisReturned,
      unrealizedPnlPct:
        costBasisReturned > 0
          ? (currentValue - costBasisReturned) / costBasisReturned
          : 0,
    };
    state.positions.set(posKey, pos);
  }

  state.dirtyPlayers.add(playerId);
  state.dirtyPositions.add(posKey);
  state.dirtyStakes.add(stakeKey);

  return {
    ok: true,
    unstakedShares: sharesToUnstake,
    yieldCollected: yieldPortion,
  };
}

// ── Rebalance ──
function handleRebalance(
  playerId: string,
  assetId: string,
  newConstituents: readonly { feedId: string; weight: number }[],
): ActionResult {
  const asset = state.assets.get(assetId);
  if (!asset) {
    return { ok: false, error: 'Asset not found' };
  }
  if (asset.creatorId !== playerId) {
    return { ok: false, error: 'Only the creator can rebalance' };
  }
  if (
    newConstituents.length === 0 ||
    newConstituents.length > SEASON.maxConstituents
  ) {
    return {
      ok: false,
      error: `Must have 1-${SEASON.maxConstituents} constituents`,
    };
  }

  const totalWeight = newConstituents.reduce(
    (sum, c) => sum + c.weight,
    0,
  );
  if (Math.abs(totalWeight - 1) > 0.001) {
    return { ok: false, error: 'Weights must sum to 1.0' };
  }

  for (const c of newConstituents) {
    if (!priceCache.has(c.feedId)) {
      return { ok: false, error: `Unknown feed: ${c.feedId}` };
    }
    if (c.weight <= 0 || c.weight > 1) {
      return {
        ok: false,
        error: 'Each weight must be between 0 and 1',
      };
    }
  }

  // Replace constituents — next tick picks up new weights
  asset.constituents = [...newConstituents];
  state.dirtyAssets.add(assetId);

  return { ok: true, assetId };
}

// ── Helpers ──
function createAssetRecord(
  name: string,
  creatorId: string,
  constituents: readonly { feedId: string; weight: number }[],
  clonedFromId: string | null,
): Asset {
  const prices = priceCache.snapshot();
  let spotPrice = 0;
  for (const c of constituents) {
    spotPrice += c.weight * (prices.get(c.feedId) ?? 0);
  }

  return {
    id: nanoid(12),
    name,
    creatorId,
    clonedFromId,
    constituents: [...constituents],
    createdAt: Date.now(),
    cloneCount: 0,
    spotPrice,
    spotPriceHistory: [spotPrice],
  };
}

function recordTrade(
  playerId: string,
  assetId: string,
  shares: number,
  usdcAmount: number,
  side: TradeSide,
): void {
  state.trades.push({
    playerId,
    assetId,
    shares,
    usdcAmount,
    side,
    timestamp: Date.now(),
  });
}

function activateReferralBonus(
  referrerId: string | null,
  _refereeId: string,
): void {
  if (!referrerId) return;

  const referrer = state.players.get(referrerId);
  if (!referrer) return;

  // Count how many referrals this player has activated
  let activatedCount = 0;
  for (const p of state.players.values()) {
    if (
      p.referredBy === referrerId &&
      p.hasMadeFirstTrade
    ) {
      activatedCount++;
    }
  }

  const bonusIndex = Math.min(
    activatedCount - 1,
    SEASON.referralBonuses.length - 1,
  );
  const bonus = SEASON.referralBonuses[bonusIndex] ?? 0;

  if (bonus > 0) {
    referrer.usdcBalance += bonus;
    referrer.bonusCapital += bonus;
    state.dirtyPlayers.add(referrerId);
  }
}
