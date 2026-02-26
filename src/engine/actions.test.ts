// ── Core engine tests — invariant verification ──

import { describe, test, expect, beforeEach } from 'bun:test';
import { state } from './state.ts';
import { processAction } from './actions.ts';
import { priceCache } from '../feeds/cache.ts';
import { SEASON } from '../config.ts';
import type { Player } from '../types.ts';

const TEST_FEED_BTC = 'test:BTC';
const TEST_FEED_ETH = 'test:ETH';

function resetState(): void {
  state.players.clear();
  state.assets.clear();
  state.positions.clear();
  state.stakes.clear();
  state.trades.length = 0;
  state.dirtyPlayers.clear();
  state.dirtyPositions.clear();
  state.dirtyAssets.clear();
  state.dirtyStakes.clear();
}

function addTestPlayer(id: string, handle: string): Player {
  const player: Player = {
    id,
    twitterId: `tw-${id}`,
    twitterHandle: handle,
    displayName: handle,
    avatarUrl: '',
    usdcBalance: SEASON.startingBalance,
    referralCode: `REF-${id}`,
    referredBy: null,
    bonusCapital: 0,
    hasMadeFirstTrade: false,
    createdAt: Date.now(),
  };
  state.players.set(id, player);
  return player;
}

function setupFeeds(): void {
  priceCache.registerFeed(TEST_FEED_BTC, {
    name: 'Bitcoin',
    symbol: 'BTC',
    category: 'crypto',
    source: 'pyth',
    scaleFactor: 1,
    updateFrequency: 400,
  });
  priceCache.registerFeed(TEST_FEED_ETH, {
    name: 'Ethereum',
    symbol: 'ETH',
    category: 'crypto',
    source: 'pyth',
    scaleFactor: 1,
    updateFrequency: 400,
  });
  priceCache.update(TEST_FEED_BTC, 50_000);
  priceCache.update(TEST_FEED_ETH, 3_000);
}

describe('Action Processor', () => {
  beforeEach(() => {
    resetState();
    setupFeeds();
  });

  describe('create', () => {
    test('creates asset with valid constituents', () => {
      addTestPlayer('p1', 'alice');
      const result = processAction('p1', {
        type: 'create',
        name: 'BTC-ETH 60/40',
        constituents: [
          { feedId: TEST_FEED_BTC, weight: 0.6 },
          { feedId: TEST_FEED_ETH, weight: 0.4 },
        ],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.assetId).toBeDefined();
        const asset = state.assets.get(result.assetId!);
        expect(asset).toBeDefined();
        expect(asset!.spotPrice).toBeCloseTo(
          0.6 * 50_000 + 0.4 * 3_000,
        );
      }
    });

    test('rejects weights not summing to 1', () => {
      addTestPlayer('p1', 'alice');
      const result = processAction('p1', {
        type: 'create',
        name: 'Bad',
        constituents: [
          { feedId: TEST_FEED_BTC, weight: 0.5 },
          { feedId: TEST_FEED_ETH, weight: 0.3 },
        ],
      });
      expect(result.ok).toBe(false);
    });

    test('rejects unknown feed ID', () => {
      addTestPlayer('p1', 'alice');
      const result = processAction('p1', {
        type: 'create',
        name: 'Bad',
        constituents: [{ feedId: 'fake:NOPE', weight: 1.0 }],
      });
      expect(result.ok).toBe(false);
    });

    test('rejects empty constituents', () => {
      addTestPlayer('p1', 'alice');
      const result = processAction('p1', {
        type: 'create',
        name: 'Empty',
        constituents: [],
      });
      expect(result.ok).toBe(false);
    });
  });

  describe('buy', () => {
    test('deducts USDC and creates position', () => {
      const player = addTestPlayer('p1', 'alice');
      const createResult = processAction('p1', {
        type: 'create',
        name: 'Pure BTC',
        constituents: [{ feedId: TEST_FEED_BTC, weight: 1.0 }],
      });
      expect(createResult.ok).toBe(true);

      const assetId = (createResult as { ok: true; assetId: string }).assetId;
      const result = processAction('p1', {
        type: 'buy',
        assetId,
        usdcAmount: 10_000,
      });

      expect(result.ok).toBe(true);
      expect(player.usdcBalance).toBe(90_000);

      const posKey = `p1:${assetId}`;
      const pos = state.positions.get(posKey);
      expect(pos).toBeDefined();
      expect(pos!.shares).toBeCloseTo(0.2); // 10000 / 50000
      expect(pos!.entryPrice).toBeCloseTo(50_000);
    });

    test('rejects insufficient balance', () => {
      addTestPlayer('p1', 'alice');
      const createResult = processAction('p1', {
        type: 'create',
        name: 'BTC',
        constituents: [{ feedId: TEST_FEED_BTC, weight: 1.0 }],
      });
      const assetId = (createResult as { ok: true; assetId: string }).assetId;

      const result = processAction('p1', {
        type: 'buy',
        assetId,
        usdcAmount: 200_000,
      });
      expect(result.ok).toBe(false);
    });

    test('averages into existing position', () => {
      addTestPlayer('p1', 'alice');
      const createResult = processAction('p1', {
        type: 'create',
        name: 'BTC',
        constituents: [{ feedId: TEST_FEED_BTC, weight: 1.0 }],
      });
      const assetId = (createResult as { ok: true; assetId: string }).assetId;

      processAction('p1', { type: 'buy', assetId, usdcAmount: 10_000 });
      processAction('p1', { type: 'buy', assetId, usdcAmount: 10_000 });

      const pos = state.positions.get(`p1:${assetId}`);
      expect(pos!.shares).toBeCloseTo(0.4);
      expect(pos!.entryValue).toBeCloseTo(20_000);
    });
  });

  describe('sell', () => {
    test('returns proceeds and removes position', () => {
      const player = addTestPlayer('p1', 'alice');
      const createResult = processAction('p1', {
        type: 'create',
        name: 'BTC',
        constituents: [{ feedId: TEST_FEED_BTC, weight: 1.0 }],
      });
      const assetId = (createResult as { ok: true; assetId: string }).assetId;

      processAction('p1', { type: 'buy', assetId, usdcAmount: 10_000 });

      const pos = state.positions.get(`p1:${assetId}`)!;
      const sellResult = processAction('p1', {
        type: 'sell',
        assetId,
        shares: pos.shares,
      });

      expect(sellResult.ok).toBe(true);
      expect(player.usdcBalance).toBeCloseTo(100_000);
      expect(state.positions.has(`p1:${assetId}`)).toBe(false);
    });

    test('rejects selling more shares than owned', () => {
      addTestPlayer('p1', 'alice');
      const createResult = processAction('p1', {
        type: 'create',
        name: 'BTC',
        constituents: [{ feedId: TEST_FEED_BTC, weight: 1.0 }],
      });
      const assetId = (createResult as { ok: true; assetId: string }).assetId;

      processAction('p1', { type: 'buy', assetId, usdcAmount: 1000 });

      const result = processAction('p1', {
        type: 'sell',
        assetId,
        shares: 999,
      });
      expect(result.ok).toBe(false);
    });
  });

  describe('stake / unstake', () => {
    test('moves shares from position to stake', () => {
      addTestPlayer('p1', 'alice');
      const createResult = processAction('p1', {
        type: 'create',
        name: 'BTC',
        constituents: [{ feedId: TEST_FEED_BTC, weight: 1.0 }],
      });
      const assetId = (createResult as { ok: true; assetId: string }).assetId;

      processAction('p1', { type: 'buy', assetId, usdcAmount: 10_000 });
      const posBefore = state.positions.get(`p1:${assetId}`)!;
      const sharesBefore = posBefore.shares;

      processAction('p1', {
        type: 'stake',
        assetId,
        shares: sharesBefore / 2,
      });

      const posAfter = state.positions.get(`p1:${assetId}`);
      expect(posAfter!.shares).toBeCloseTo(sharesBefore / 2);

      const stakeKey = `p1:${assetId}:stake`;
      const stake = state.stakes.get(stakeKey);
      expect(stake).toBeDefined();
      expect(stake!.stakedShares).toBeCloseTo(sharesBefore / 2);
    });

    test('unstake returns shares and collects yield', () => {
      const player = addTestPlayer('p1', 'alice');
      const createResult = processAction('p1', {
        type: 'create',
        name: 'BTC',
        constituents: [{ feedId: TEST_FEED_BTC, weight: 1.0 }],
      });
      const assetId = (createResult as { ok: true; assetId: string }).assetId;

      processAction('p1', { type: 'buy', assetId, usdcAmount: 10_000 });
      const shares = state.positions.get(`p1:${assetId}`)!.shares;
      processAction('p1', { type: 'stake', assetId, shares });

      // Simulate some yield
      const stakeKey = `p1:${assetId}:stake`;
      const stake = state.stakes.get(stakeKey)!;
      stake.accumulatedYield = 100;

      const balanceBefore = player.usdcBalance;
      processAction('p1', { type: 'unstake', assetId, shares });

      // Should have received the yield
      expect(player.usdcBalance).toBeCloseTo(balanceBefore + 100);
      expect(state.stakes.has(stakeKey)).toBe(false);
      expect(state.positions.has(`p1:${assetId}`)).toBe(true);
    });
  });

  describe('clone', () => {
    test('creates clone and increments clone count', () => {
      addTestPlayer('p1', 'alice');
      addTestPlayer('p2', 'bob');

      const createResult = processAction('p1', {
        type: 'create',
        name: 'Alpha Index',
        constituents: [
          { feedId: TEST_FEED_BTC, weight: 0.7 },
          { feedId: TEST_FEED_ETH, weight: 0.3 },
        ],
      });
      const originalId = (createResult as { ok: true; assetId: string }).assetId;

      const cloneResult = processAction('p2', {
        type: 'clone',
        assetId: originalId,
      });
      expect(cloneResult.ok).toBe(true);

      const original = state.assets.get(originalId)!;
      expect(original.cloneCount).toBe(1);

      if (cloneResult.ok) {
        const clone = state.assets.get(cloneResult.assetId!)!;
        expect(clone.clonedFromId).toBe(originalId);
        expect(clone.creatorId).toBe('p2');
      }
    });
  });

  describe('rebalance', () => {
    test('creator can rebalance their own asset', () => {
      addTestPlayer('p1', 'alice');
      const createResult = processAction('p1', {
        type: 'create',
        name: 'BTC-ETH 60/40',
        constituents: [
          { feedId: TEST_FEED_BTC, weight: 0.6 },
          { feedId: TEST_FEED_ETH, weight: 0.4 },
        ],
      });
      const assetId = (createResult as { ok: true; assetId: string }).assetId;

      // Rebalance to 80/20
      const result = processAction('p1', {
        type: 'rebalance',
        assetId,
        constituents: [
          { feedId: TEST_FEED_BTC, weight: 0.8 },
          { feedId: TEST_FEED_ETH, weight: 0.2 },
        ],
      });

      expect(result.ok).toBe(true);
      const asset = state.assets.get(assetId)!;
      expect(asset.constituents).toEqual([
        { feedId: TEST_FEED_BTC, weight: 0.8 },
        { feedId: TEST_FEED_ETH, weight: 0.2 },
      ]);
    });

    test('non-creator cannot rebalance', () => {
      addTestPlayer('p1', 'alice');
      addTestPlayer('p2', 'bob');

      const createResult = processAction('p1', {
        type: 'create',
        name: 'Alice Index',
        constituents: [{ feedId: TEST_FEED_BTC, weight: 1.0 }],
      });
      const assetId = (createResult as { ok: true; assetId: string }).assetId;

      const result = processAction('p2', {
        type: 'rebalance',
        assetId,
        constituents: [{ feedId: TEST_FEED_ETH, weight: 1.0 }],
      });
      expect(result.ok).toBe(false);
    });

    test('rebalance affects all holders transparently', () => {
      addTestPlayer('p1', 'alice');
      addTestPlayer('p2', 'bob');

      // Alice creates 100% BTC index
      const createResult = processAction('p1', {
        type: 'create',
        name: 'Pure BTC',
        constituents: [{ feedId: TEST_FEED_BTC, weight: 1.0 }],
      });
      const assetId = (createResult as { ok: true; assetId: string }).assetId;

      // Bob buys in
      processAction('p2', {
        type: 'buy',
        assetId,
        usdcAmount: 10_000,
      });

      const posBefore = state.positions.get(`p2:${assetId}`)!;
      expect(posBefore.shares).toBeCloseTo(0.2); // 10000/50000

      // Alice rebalances to 100% ETH
      processAction('p1', {
        type: 'rebalance',
        assetId,
        constituents: [{ feedId: TEST_FEED_ETH, weight: 1.0 }],
      });

      // Asset spot price should now be ETH price ($3000)
      // on next spot price recalc — simulate it
      const asset = state.assets.get(assetId)!;
      let newSpot = 0;
      const prices = priceCache.snapshot();
      for (const c of asset.constituents) {
        newSpot += c.weight * (prices.get(c.feedId) ?? 0);
      }
      asset.spotPrice = newSpot;

      // Bob's shares didn't change, but value did
      expect(posBefore.shares).toBeCloseTo(0.2);
      // New value: 0.2 shares × $3000 = $600
      const newValue = posBefore.shares * asset.spotPrice;
      expect(newValue).toBeCloseTo(600);
    });

    test('rejects invalid weights on rebalance', () => {
      addTestPlayer('p1', 'alice');
      const createResult = processAction('p1', {
        type: 'create',
        name: 'Index',
        constituents: [{ feedId: TEST_FEED_BTC, weight: 1.0 }],
      });
      const assetId = (createResult as { ok: true; assetId: string }).assetId;

      const result = processAction('p1', {
        type: 'rebalance',
        assetId,
        constituents: [
          { feedId: TEST_FEED_BTC, weight: 0.5 },
          { feedId: TEST_FEED_ETH, weight: 0.3 },
        ],
      });
      expect(result.ok).toBe(false);
    });
  });

  describe('invariants', () => {
    test('conservation of value through buy/sell cycle', () => {
      const player = addTestPlayer('p1', 'alice');
      const createResult = processAction('p1', {
        type: 'create',
        name: 'BTC',
        constituents: [{ feedId: TEST_FEED_BTC, weight: 1.0 }],
      });
      const assetId = (createResult as { ok: true; assetId: string }).assetId;

      // Buy
      processAction('p1', { type: 'buy', assetId, usdcAmount: 50_000 });
      // Sell all
      const pos = state.positions.get(`p1:${assetId}`)!;
      processAction('p1', { type: 'sell', assetId, shares: pos.shares });

      // Balance should be back to 100k (no price change happened)
      expect(player.usdcBalance).toBeCloseTo(SEASON.startingBalance);
    });

    test('cost basis preserved through stake/unstake cycle', () => {
      const player = addTestPlayer('p1', 'alice');
      const createResult = processAction('p1', {
        type: 'create',
        name: 'BTC',
        constituents: [{ feedId: TEST_FEED_BTC, weight: 1.0 }],
      });
      const assetId = (createResult as { ok: true; assetId: string }).assetId;

      // Buy at $50k
      processAction('p1', { type: 'buy', assetId, usdcAmount: 10_000 });
      const pos = state.positions.get(`p1:${assetId}`)!;
      const originalEntryPrice = pos.entryPrice;
      const originalShares = pos.shares;

      // Stake all
      processAction('p1', { type: 'stake', assetId, shares: originalShares });

      // Price changes to $60k
      priceCache.update(TEST_FEED_BTC, 60_000);
      const asset = state.assets.get(assetId)!;
      asset.spotPrice = 60_000;

      // Unstake all — cost basis should be original, NOT current price
      processAction('p1', { type: 'unstake', assetId, shares: originalShares });

      const restoredPos = state.positions.get(`p1:${assetId}`)!;
      // Entry price should be the ORIGINAL $50k, not the current $60k
      expect(restoredPos.entryPrice).toBeCloseTo(originalEntryPrice);
      expect(restoredPos.entryValue).toBeCloseTo(10_000);
      // But currentValue should reflect the new price
      expect(restoredPos.currentValue).toBeCloseTo(originalShares * 60_000);
      // P&L should show the gain
      expect(restoredPos.unrealizedPnl).toBeCloseTo(
        originalShares * 60_000 - 10_000,
      );
    });

    test('NaN input rejected in buy', () => {
      addTestPlayer('p1', 'alice');
      const createResult = processAction('p1', {
        type: 'create',
        name: 'BTC',
        constituents: [{ feedId: TEST_FEED_BTC, weight: 1.0 }],
      });
      const assetId = (createResult as { ok: true; assetId: string }).assetId;

      const result = processAction('p1', {
        type: 'buy',
        assetId,
        usdcAmount: NaN,
      });
      expect(result.ok).toBe(false);
    });

    test('NaN input rejected in sell', () => {
      addTestPlayer('p1', 'alice');
      const createResult = processAction('p1', {
        type: 'create',
        name: 'BTC',
        constituents: [{ feedId: TEST_FEED_BTC, weight: 1.0 }],
      });
      const assetId = (createResult as { ok: true; assetId: string }).assetId;
      processAction('p1', { type: 'buy', assetId, usdcAmount: 1000 });

      const result = processAction('p1', {
        type: 'sell',
        assetId,
        shares: NaN,
      });
      expect(result.ok).toBe(false);
    });

    test('no negative balance on buy', () => {
      const player = addTestPlayer('p1', 'alice');
      const createResult = processAction('p1', {
        type: 'create',
        name: 'BTC',
        constituents: [{ feedId: TEST_FEED_BTC, weight: 1.0 }],
      });
      const assetId = (createResult as { ok: true; assetId: string }).assetId;

      // Buy exactly all balance
      processAction('p1', {
        type: 'buy',
        assetId,
        usdcAmount: SEASON.startingBalance,
      });
      expect(player.usdcBalance).toBe(0);

      // Try to buy more
      const result = processAction('p1', {
        type: 'buy',
        assetId,
        usdcAmount: 1,
      });
      expect(result.ok).toBe(false);
      expect(player.usdcBalance).toBe(0);
    });

    test('self-clone does not pay royalties', () => {
      const player = addTestPlayer('p1', 'alice');
      const createResult = processAction('p1', {
        type: 'create',
        name: 'My Index',
        constituents: [{ feedId: TEST_FEED_BTC, weight: 1.0 }],
      });
      const originalId = (createResult as { ok: true; assetId: string }).assetId;

      // Self-clone
      const cloneResult = processAction('p1', {
        type: 'clone',
        assetId: originalId,
      });
      const cloneId = (cloneResult as { ok: true; assetId: string }).assetId;

      // Buy clone, then sell (simulating profit)
      processAction('p1', { type: 'buy', assetId: cloneId, usdcAmount: 10_000 });
      // Artificially bump price to create profit
      priceCache.update(TEST_FEED_BTC, 60_000);
      const asset = state.assets.get(cloneId)!;
      asset.spotPrice = 60_000;

      const pos = state.positions.get(`p1:${cloneId}`)!;
      const sellResult = processAction('p1', {
        type: 'sell',
        assetId: cloneId,
        shares: pos.shares,
      });

      expect(sellResult.ok).toBe(true);
      if (sellResult.ok) {
        // No royalty paid to self
        expect(sellResult.royaltyPaid).toBe(0);
      }
    });
  });
});
