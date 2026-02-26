// ── Startup recovery — rehydrate in-memory state from SQLite ──

import { getDb } from './connection.ts';
import { state } from '../engine/state.ts';
import type {
  Player,
  Asset,
  Position,
  StakePosition,
  Constituent,
} from '../types.ts';

interface PlayerRow {
  id: string;
  twitter_id: string;
  twitter_handle: string;
  display_name: string;
  avatar_url: string;
  usdc_balance: number;
  referral_code: string;
  referred_by: string | null;
  bonus_capital: number;
  has_made_first_trade: number;
  created_at: number;
}

interface AssetRow {
  id: string;
  name: string;
  creator_id: string;
  cloned_from_id: string | null;
  constituents: string;
  clone_count: number;
  created_at: number;
}

interface PositionRow {
  id: string;
  player_id: string;
  asset_id: string;
  shares: number;
  entry_price: number;
  entry_value: number;
}

interface StakeRow {
  id: string;
  player_id: string;
  asset_id: string;
  staked_shares: number;
  cost_basis: number;
  staked_at: number;
  accumulated_yield: number;
  last_yield_tick: number;
}

export function rehydrateState(): void {
  const db = getDb();

  // 1. Load players
  const playerRows = db
    .query('SELECT * FROM players')
    .all() as PlayerRow[];

  for (const row of playerRows) {
    const player: Player = {
      id: row.id,
      twitterId: row.twitter_id,
      twitterHandle: row.twitter_handle,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      usdcBalance: row.usdc_balance,
      referralCode: row.referral_code,
      referredBy: row.referred_by,
      bonusCapital: row.bonus_capital,
      hasMadeFirstTrade: row.has_made_first_trade === 1,
      createdAt: row.created_at,
    };
    state.players.set(player.id, player);
  }

  // 2. Load assets
  const assetRows = db
    .query('SELECT * FROM assets')
    .all() as AssetRow[];

  for (const row of assetRows) {
    const constituents = JSON.parse(
      row.constituents,
    ) as Constituent[];
    const asset: Asset = {
      id: row.id,
      name: row.name,
      creatorId: row.creator_id,
      clonedFromId: row.cloned_from_id,
      constituents,
      createdAt: row.created_at,
      cloneCount: row.clone_count,
      spotPrice: 0,
      spotPriceHistory: [],
    };
    state.assets.set(asset.id, asset);
  }

  // 3. Load positions
  const positionRows = db
    .query('SELECT * FROM positions')
    .all() as PositionRow[];

  for (const row of positionRows) {
    const pos: Position = {
      id: row.id,
      playerId: row.player_id,
      assetId: row.asset_id,
      shares: row.shares,
      entryPrice: row.entry_price,
      entryValue: row.entry_value,
      currentValue: 0,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
    };
    state.positions.set(pos.id, pos);
  }

  // 4. Load stakes
  const stakeRows = db
    .query('SELECT * FROM stakes')
    .all() as StakeRow[];

  for (const row of stakeRows) {
    const stake: StakePosition = {
      id: row.id,
      playerId: row.player_id,
      assetId: row.asset_id,
      stakedShares: row.staked_shares,
      costBasis: row.cost_basis,
      stakedAt: row.staked_at,
      accumulatedYield: row.accumulated_yield,
      lastYieldTick: row.last_yield_tick,
    };
    state.stakes.set(stake.id, stake);
  }

  console.log(
    `[recover] Loaded ${state.players.size} players, ` +
    `${state.assets.size} assets, ` +
    `${state.positions.size} positions, ` +
    `${state.stakes.size} stakes`,
  );
}
