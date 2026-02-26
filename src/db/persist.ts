// ── Async persistence layer — writes dirty state to SQLite off-tick ──

import { getDb } from './connection.ts';
import { state } from '../engine/state.ts';

export function queuePersistence(): void {
  // setImmediate equivalent in Bun: queueMicrotask or setTimeout(0)
  setTimeout(persistDirtyState, 0);
}

function persistDirtyState(): void {
  const db = getDb();

  try {
    const txn = db.transaction(() => {
      // Upsert dirty players
      const playerStmt = db.prepare(`
        INSERT OR REPLACE INTO players
          (id, twitter_id, twitter_handle, display_name, avatar_url,
           usdc_balance, referral_code, referred_by, bonus_capital,
           has_made_first_trade, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const id of state.dirtyPlayers) {
        const p = state.players.get(id);
        if (!p) continue;
        playerStmt.run(
          p.id,
          p.twitterId,
          p.twitterHandle,
          p.displayName,
          p.avatarUrl,
          p.usdcBalance,
          p.referralCode,
          p.referredBy,
          p.bonusCapital,
          p.hasMadeFirstTrade ? 1 : 0,
          p.createdAt,
        );
      }

      // Upsert dirty assets
      const assetStmt = db.prepare(`
        INSERT OR REPLACE INTO assets
          (id, name, creator_id, cloned_from_id, constituents,
           clone_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const id of state.dirtyAssets) {
        const a = state.assets.get(id);
        if (!a) continue;
        assetStmt.run(
          a.id,
          a.name,
          a.creatorId,
          a.clonedFromId,
          JSON.stringify(a.constituents),
          a.cloneCount,
          a.createdAt,
        );
      }

      // Upsert dirty positions (or delete if gone)
      const posUpsertStmt = db.prepare(`
        INSERT OR REPLACE INTO positions
          (id, player_id, asset_id, shares, entry_price, entry_value)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const posDeleteStmt = db.prepare(
        'DELETE FROM positions WHERE id = ?',
      );

      for (const id of state.dirtyPositions) {
        const pos = state.positions.get(id);
        if (pos) {
          posUpsertStmt.run(
            pos.id,
            pos.playerId,
            pos.assetId,
            pos.shares,
            pos.entryPrice,
            pos.entryValue,
          );
        } else {
          posDeleteStmt.run(id);
        }
      }

      // Upsert dirty stakes (or delete if gone)
      const stakeUpsertStmt = db.prepare(`
        INSERT OR REPLACE INTO stakes
          (id, player_id, asset_id, staked_shares, cost_basis,
           staked_at, accumulated_yield, last_yield_tick)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const stakeDeleteStmt = db.prepare(
        'DELETE FROM stakes WHERE id = ?',
      );

      for (const id of state.dirtyStakes) {
        const s = state.stakes.get(id);
        if (s) {
          stakeUpsertStmt.run(
            s.id,
            s.playerId,
            s.assetId,
            s.stakedShares,
            s.costBasis,
            s.stakedAt,
            s.accumulatedYield,
            s.lastYieldTick,
          );
        } else {
          stakeDeleteStmt.run(id);
        }
      }

      // Persist new trades
      if (state.trades.length > 0) {
        const tradeStmt = db.prepare(`
          INSERT INTO trades
            (player_id, asset_id, shares, usdc_amount, side, timestamp)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const t of state.trades) {
          tradeStmt.run(
            t.playerId,
            t.assetId,
            t.shares,
            t.usdcAmount,
            t.side,
            t.timestamp,
          );
        }
      }
    });

    txn();

    // Clear dirty sets after successful persist
    state.dirtyPlayers.clear();
    state.dirtyAssets.clear();
    state.dirtyPositions.clear();
    state.dirtyStakes.clear();
    state.trades.length = 0;
  } catch (err) {
    console.error('[persist] Failed to persist state:', err);
  }
}
