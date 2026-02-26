// ── Shared type definitions for the ETO Trading Challenge ──

// ── Season Configuration ──
export interface SeasonConfig {
  readonly startingBalance: number;
  readonly seasonDurationDays: number;
  readonly baseAnnualYieldBps: number;
  readonly royaltyRateBps: number;
  readonly maxConstituents: number;
  readonly tickIntervalMs: number;
  readonly referralBonuses: readonly number[];
  readonly leaderboardSize: number;
}

// ── Price Feed Categories ──
export type FeedCategory =
  | 'crypto'
  | 'equity'
  | 'commodity'
  | 'macro'
  | 'exotic';

export type FeedSource = 'pyth' | 'fred' | 'chainlink' | 'custom';

export interface PriceFeed {
  readonly id: string;
  readonly name: string;
  readonly symbol: string;
  readonly category: FeedCategory;
  price: number;
  readonly scaleFactor: number;
  updatedAt: number;
  readonly source: FeedSource;
  readonly updateFrequency: number;
}

// ── Cached Price Entry ──
export interface CachedPrice {
  price: number;
  updatedAt: number;
  confidence?: number;
}

// ── Asset (Index Token) ──
export interface Constituent {
  readonly feedId: string;
  readonly weight: number;
}

export interface Asset {
  readonly id: string;
  name: string;
  readonly creatorId: string;
  readonly clonedFromId: string | null;
  constituents: Constituent[];
  readonly createdAt: number;
  cloneCount: number;
  spotPrice: number;
  spotPriceHistory: number[];
}

// ── Player ──
export interface Player {
  readonly id: string;
  readonly twitterId: string;
  readonly twitterHandle: string;
  displayName: string;
  avatarUrl: string;
  usdcBalance: number;
  readonly referralCode: string;
  readonly referredBy: string | null;
  bonusCapital: number;
  readonly createdAt: number;
  hasMadeFirstTrade: boolean;
}

// ── Position ──
export interface Position {
  readonly id: string;
  readonly playerId: string;
  readonly assetId: string;
  shares: number;
  entryPrice: number;
  entryValue: number;
  currentValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
}

// ── Stake ──
export interface StakePosition {
  readonly id: string;
  readonly playerId: string;
  readonly assetId: string;
  stakedShares: number;
  costBasis: number;
  readonly stakedAt: number;
  accumulatedYield: number;
  lastYieldTick: number;
}

// ── Leaderboard ──
export interface LeaderboardEntry {
  readonly playerId: string;
  readonly twitterHandle: string;
  readonly avatarUrl: string;
  totalReturnPct: number;
  rank: number;
  rankDelta: number;
  totalValue: number;
}

// ── Actions ──
export type Action =
  | CreateAction
  | CloneAction
  | BuyAction
  | SellAction
  | StakeAction
  | UnstakeAction
  | RebalanceAction;

export interface CreateAction {
  readonly type: 'create';
  readonly name: string;
  readonly constituents: readonly Constituent[];
}

export interface CloneAction {
  readonly type: 'clone';
  readonly assetId: string;
}

export interface BuyAction {
  readonly type: 'buy';
  readonly assetId: string;
  readonly usdcAmount: number;
}

export interface SellAction {
  readonly type: 'sell';
  readonly assetId: string;
  readonly shares: number;
}

export interface StakeAction {
  readonly type: 'stake';
  readonly assetId: string;
  readonly shares: number;
}

export interface UnstakeAction {
  readonly type: 'unstake';
  readonly assetId: string;
  readonly shares: number;
}

export interface RebalanceAction {
  readonly type: 'rebalance';
  readonly assetId: string;
  readonly constituents: readonly Constituent[];
}

// ── Action Results ──
export type ActionResult =
  | ActionSuccess
  | ActionFailure;

export interface ActionSuccess {
  readonly ok: true;
  readonly assetId?: string;
  readonly shares?: number;
  readonly proceeds?: number;
  readonly realizedPnl?: number;
  readonly royaltyPaid?: number;
  readonly stakedShares?: number;
  readonly unstakedShares?: number;
  readonly yieldCollected?: number;
}

export interface ActionFailure {
  readonly ok: false;
  readonly error: string;
}

// ── Trade Record ──
export type TradeSide = 'buy' | 'sell';

export interface TradeRecord {
  readonly playerId: string;
  readonly assetId: string;
  readonly shares: number;
  readonly usdcAmount: number;
  readonly side: TradeSide;
  readonly timestamp: number;
}

// ── Tick Broadcast ──
export interface TickBroadcast {
  readonly timestamp: number;
  readonly leaderboard: readonly LeaderboardEntry[];
  readonly tickMs: number;
}

// ── Portfolio Update (per-player WS message) ──
export interface PortfolioPositionView {
  readonly assetId: string;
  readonly assetName: string;
  readonly shares: number;
  readonly currentValue: number;
  readonly pnl: number;
  readonly pnlPct: number;
}

export interface PortfolioStakeView {
  readonly assetId: string;
  readonly assetName: string;
  readonly stakedShares: number;
  readonly value: number;
  readonly yield: number;
}

export interface PortfolioUpdate {
  readonly usdcBalance: number;
  readonly totalValue: number;
  readonly returnPct: number;
  readonly positions: readonly PortfolioPositionView[];
  readonly stakes: readonly PortfolioStakeView[];
}

// ── WebSocket Message Types ──
export type WsOutgoingMessage =
  | { readonly type: 'tick'; readonly data: TickBroadcast }
  | { readonly type: 'portfolio'; readonly data: PortfolioUpdate }
  | { readonly type: 'action_result'; readonly data: ActionResult }
  | { readonly type: 'error'; readonly data: { readonly message: string } };

// ── Game State (in-memory store) ──
export interface GameState {
  readonly players: Map<string, Player>;
  readonly assets: Map<string, Asset>;
  readonly positions: Map<string, Position>;
  readonly stakes: Map<string, StakePosition>;
  readonly trades: TradeRecord[];
  readonly dirtyPlayers: Set<string>;
  readonly dirtyPositions: Set<string>;
  readonly dirtyAssets: Set<string>;
  readonly dirtyStakes: Set<string>;
  previousRanks: Map<string, number>;
}
