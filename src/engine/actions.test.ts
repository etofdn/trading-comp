// ── Core engine tests — invariant verification ──

import { describe, test, expect, beforeEach } from 'bun:test';
import { state } from './state.ts';
import { processAction } from './actions.ts';
import { priceCache } from '../feeds/cache.ts';
import { SEASON } from '../config.ts';
import type { Player } from '../types.ts';

const TEST_FEED_BTC = 'test:BTC';
const TEST_FEED_ETH = 'test:ETH';
const TEST_FEED_SOL = 'test:SOL';
const TEST_FEED_LINK = 'test:LINK';
const TEST_FEED_DOGE = 'test:DOGE';

// Default 5-constituent composition (meets minConstituents)
const DEFAULT_CONSTITUENTS = [
  { feedId: TEST_FEED_BTC, weight: 0.4 },
  { feedId: TEST_FEED_ETH, weight: 0.2 },
  { feedId: TEST_FEED_SOL, weight: 0.2 },
  { feedId: TEST_FEED_LINK, weight: 0.1 },
  { feedId: TEST_FEED_DOGE, weight: 0.1 },
];

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
  state.portfolioSnapshots.clear();
  state.portfolioSnapshotsDirty = false;
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
  const feeds = [
    { id: TEST_FEED_BTC, name: 'Bitcoin', symbol: 'BTC', price: 50_000 },
    { id: TEST_FEED_ETH, name: 'Ethereum', symbol: 'ETH', price: 3_000 },
    { id: TEST_FEED_SOL, name: 'Solana', symbol: 'SOL', price: 150 },
    { id: TEST_FEED_LINK, name: 'Chainlink', symbol: 'LINK', price: 15 },
    { id: TEST_FEED_DOGE, name: 'Dogecoin', symbol: 'DOGE', price: 0.15 },
  ];
  for (const f of feeds) {
    priceCache.registerFeed(f.id, {
      name: f.name,
      symbol: f.symbol,
      category: 'crypto',
      source: 'pyth',
      scaleFactor: 1,
      updateFrequency: 400,
    });
    priceCache.update(f.id, f.price);
  }
}

/** Helper: create a valid test asset (meets min 5 constituents) */
function createTestAsset(playerId: string, name: string): string {
  const result = processAction(playerId, {
    type: 'create',
    name,
    constituents: DEFAULT_CONSTITUENTS,
  });
  expect(result.ok).toBe(true);
  return (result as { ok: true; assetId: string }).assetId;
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
        name: 'Multi Index',
        constituents: DEFAULT_CONSTITUENTS,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.assetId).toBeDefined();
        const asset = state.assets.get(result.assetId!);
        expect(asset).toBeDefined();
        // spotPrice = 0.4*50000 + 0.2*3000 + 0.2*150 + 0.1*15 + 0.1*0.15
        expect(asset!.spotPrice).toBeCloseTo(20_631.515);
      }
    });

    test('rejects weights not summing to 1', () => {
      addTestPlayer('p1', 'alice');
      const result = processAction('p1', {
        type: 'create',
        name: 'Bad',
        constituents: [
          { feedId: TEST_FEED_BTC, weight: 0.3 },
          { feedId: TEST_FEED_ETH, weight: 0.1 },
          { feedId: TEST_FEED_SOL, weight: 0.1 },
          { feedId: TEST_FEED_LINK, weight: 0.1 },
          { feedId: TEST_FEED_DOGE, weight: 0.1 },
        ],
      });
      expect(result.ok).toBe(false);
    });

    test('rejects unknown feed ID', () => {
      addTestPlayer('p1', 'alice');
      const result = processAction('p1', {
        type: 'create',
        name: 'Bad',
        constituents: [
          { feedId: 'fake:NOPE', weight: 0.2 },
          { feedId: TEST_FEED_ETH, weight: 0.2 },
          { feedId: TEST_FEED_SOL, weight: 0.2 },
          { feedId: TEST_FEED_LINK, weight: 0.2 },
          { feedId: TEST_FEED_DOGE, weight: 0.2 },
        ],
      });
      expect(result.ok).toBe(false);
    });

    test('rejects too few constituents', () => {
      addTestPlayer('p1', 'alice');
      const result = processAction('p1', {
        type: 'create',
        name: 'TooFew',
        constituents: [
          { feedId: TEST_FEED_BTC, weight: 0.5 },
          { feedId: TEST_FEED_ETH, weight: 0.5 },
        ],
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
    test('deducts USDC and creates position with fee + slippage', () => {
      const player = addTestPlayer('p1', 'alice');
      const assetId = createTestAsset('p1', 'Test Index');

      const result = processAction('p1', {
        type: 'buy',
        assetId,
        usdcAmount: 10_000,
      });

      expect(result.ok).toBe(true);
      // Full amount deducted (fee is taken from the trade, not extra)
      expect(player.usdcBalance).toBe(SEASON.startingBalance - 10_000);

      if (result.ok) {
        expect(result.fee).toBeDefined();
        expect(result.fee!).toBeGreaterThan(0);
        expect(result.slippageBps).toBeDefined();
        expect(result.executionPrice).toBeDefined();
        // Shares should be less than usdcAmount / spotPrice due to fee + slippage
        expect(result.shares!).toBeLessThan(10_000 / state.assets.get(assetId)!.spotPrice);
      }
    });

    test('rejects insufficient balance', () => {
      addTestPlayer('p1', 'alice');
      const assetId = createTestAsset('p1', 'Test');

      const result = processAction('p1', {
        type: 'buy',
        assetId,
        usdcAmount: 200_000,
      });
      expect(result.ok).toBe(false);
    });

    test('averages into existing position', () => {
      addTestPlayer('p1', 'alice');
      const assetId = createTestAsset('p1', 'Test');

      processAction('p1', { type: 'buy', assetId, usdcAmount: 10_000 });
      processAction('p1', { type: 'buy', assetId, usdcAmount: 10_000 });

      const pos = state.positions.get(`p1:${assetId}`);
      expect(pos).toBeDefined();
      expect(pos!.shares).toBeGreaterThan(0);
      // Two buys should result in more shares than one
    });
  });

  describe('sell', () => {
    test('returns proceeds minus fees and removes position', () => {
      const player = addTestPlayer('p1', 'alice');
      const assetId = createTestAsset('p1', 'Test');

      processAction('p1', { type: 'buy', assetId, usdcAmount: 10_000 });

      const pos = state.positions.get(`p1:${assetId}`)!;
      const sellResult = processAction('p1', {
        type: 'sell',
        assetId,
        shares: pos.shares,
      });

      expect(sellResult.ok).toBe(true);
      if (sellResult.ok) {
        expect(sellResult.fee).toBeDefined();
        expect(sellResult.fee!).toBeGreaterThan(0);
      }
      // Balance should be less than starting due to round-trip fees
      expect(player.usdcBalance).toBeLessThan(SEASON.startingBalance);
      expect(state.positions.has(`p1:${assetId}`)).toBe(false);
    });

    test('rejects selling more shares than owned', () => {
      addTestPlayer('p1', 'alice');
      const assetId = createTestAsset('p1', 'Test');

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
      const assetId = createTestAsset('p1', 'Test');

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
      const assetId = createTestAsset('p1', 'Test');

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

      const originalId = createTestAsset('p1', 'Alpha Index');

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
      const assetId = createTestAsset('p1', 'Multi Index');

      // Rebalance to different weights
      const result = processAction('p1', {
        type: 'rebalance',
        assetId,
        constituents: [
          { feedId: TEST_FEED_BTC, weight: 0.5 },
          { feedId: TEST_FEED_ETH, weight: 0.2 },
          { feedId: TEST_FEED_SOL, weight: 0.1 },
          { feedId: TEST_FEED_LINK, weight: 0.1 },
          { feedId: TEST_FEED_DOGE, weight: 0.1 },
        ],
      });

      expect(result.ok).toBe(true);
      const asset = state.assets.get(assetId)!;
      expect(asset.constituents[0]!.weight).toBe(0.5);
    });

    test('non-creator cannot rebalance', () => {
      addTestPlayer('p1', 'alice');
      addTestPlayer('p2', 'bob');

      const assetId = createTestAsset('p1', 'Alice Index');

      const result = processAction('p2', {
        type: 'rebalance',
        assetId,
        constituents: DEFAULT_CONSTITUENTS,
      });
      expect(result.ok).toBe(false);
    });

    test('rejects too few constituents on rebalance', () => {
      addTestPlayer('p1', 'alice');
      const assetId = createTestAsset('p1', 'Index');

      const result = processAction('p1', {
        type: 'rebalance',
        assetId,
        constituents: [
          { feedId: TEST_FEED_BTC, weight: 0.5 },
          { feedId: TEST_FEED_ETH, weight: 0.5 },
        ],
      });
      expect(result.ok).toBe(false);
    });
  });

  describe('invariants', () => {
    test('buy/sell round-trip loses money to fees (no free lunch)', () => {
      const player = addTestPlayer('p1', 'alice');
      const assetId = createTestAsset('p1', 'Test');

      // Buy
      processAction('p1', { type: 'buy', assetId, usdcAmount: 50_000 });
      // Sell all
      const pos = state.positions.get(`p1:${assetId}`)!;
      processAction('p1', { type: 'sell', assetId, shares: pos.shares });

      // Balance should be LESS than starting due to fees + slippage
      expect(player.usdcBalance).toBeLessThan(SEASON.startingBalance);
      // But not drastically less — fees (0.30% x2) + slippage (~2.5% x2 for $50K/$1M)
      // Total round-trip cost is ~2.7% for a $50K trade against $1M liquidity
      expect(player.usdcBalance).toBeGreaterThan(SEASON.startingBalance * 0.95);
    });

    test('cost basis preserved through stake/unstake cycle', () => {
      const player = addTestPlayer('p1', 'alice');
      const assetId = createTestAsset('p1', 'Test');

      processAction('p1', { type: 'buy', assetId, usdcAmount: 10_000 });
      const pos = state.positions.get(`p1:${assetId}`)!;
      const originalEntryPrice = pos.entryPrice;
      const originalShares = pos.shares;

      // Stake all
      processAction('p1', { type: 'stake', assetId, shares: originalShares });

      // Price changes
      priceCache.update(TEST_FEED_BTC, 60_000);
      const asset = state.assets.get(assetId)!;
      // Recompute spot price with new BTC price
      let newSpot = 0;
      for (const c of asset.constituents) {
        newSpot += c.weight * (priceCache.snapshot().get(c.feedId) ?? 0);
      }
      asset.spotPrice = newSpot;

      // Unstake all — cost basis should be original, NOT current price
      processAction('p1', { type: 'unstake', assetId, shares: originalShares });

      const restoredPos = state.positions.get(`p1:${assetId}`)!;
      expect(restoredPos.entryPrice).toBeCloseTo(originalEntryPrice);
    });

    test('NaN input rejected in buy', () => {
      addTestPlayer('p1', 'alice');
      const assetId = createTestAsset('p1', 'Test');

      const result = processAction('p1', {
        type: 'buy',
        assetId,
        usdcAmount: NaN,
      });
      expect(result.ok).toBe(false);
    });

    test('NaN input rejected in sell', () => {
      addTestPlayer('p1', 'alice');
      const assetId = createTestAsset('p1', 'Test');
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
      const assetId = createTestAsset('p1', 'Test');

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
      const originalId = createTestAsset('p1', 'My Index');

      // Self-clone
      const cloneResult = processAction('p1', {
        type: 'clone',
        assetId: originalId,
      });
      const cloneId = (cloneResult as { ok: true; assetId: string }).assetId;

      // Buy clone, then sell (simulating profit)
      processAction('p1', { type: 'buy', assetId: cloneId, usdcAmount: 10_000 });
      // Artificially bump BTC price to create profit
      priceCache.update(TEST_FEED_BTC, 60_000);
      const asset = state.assets.get(cloneId)!;
      let newSpot = 0;
      for (const c of asset.constituents) {
        newSpot += c.weight * (priceCache.snapshot().get(c.feedId) ?? 0);
      }
      asset.spotPrice = newSpot;

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
