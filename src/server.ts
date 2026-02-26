// ── Hono server — REST + WebSocket + MCP ──

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { state } from './engine/state.ts';
import { processAction } from './engine/actions.ts';
import { priceCache } from './feeds/cache.ts';
import {
  initTwitterAuth,
  getAuthUrl,
  handleCallback,
  verifyToken,
  createDevPlayer,
  signDevToken,
} from './auth/twitter.ts';
import { handleMcpRequest } from './mcp/server.ts';
import { getCachedLeaderboard } from './engine/leaderboard.ts';
import { getDb } from './db/connection.ts';
import {
  registerClient,
  removeClient,
  type WsData,
} from './ws/broadcast.ts';
import { SEASON, MAX_ACTIONS_PER_SECOND } from './config.ts';
import { landingPage } from './pages/landing.ts';
import { dashboardPage } from './pages/dashboard.ts';
import type { Context } from 'hono';
import type { Action, Player } from './types.ts';

const app = new Hono();

// ── Middleware ──
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

// ── Pagination helper ──
const MAX_PAGE_SIZE = 100;
const HISTORY_MAX_SIZE = 1000;

function parseLimit(
  raw: string | undefined,
  defaultVal: number,
  maxVal: number = MAX_PAGE_SIZE,
): number {
  const parsed = parseInt(raw ?? String(defaultVal), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return Math.min(defaultVal, maxVal);
  return Math.min(parsed, maxVal);
}

// ── Rate limiter (in-memory, per-player) ──
const rateLimits = new Map<
  string,
  { count: number; resetAt: number }
>();

function checkRateLimit(playerId: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(playerId);

  if (!entry || now > entry.resetAt) {
    rateLimits.set(playerId, {
      count: 1,
      resetAt: now + 1000,
    });
    return true;
  }

  if (entry.count >= MAX_ACTIONS_PER_SECOND) return false;
  entry.count++;
  return true;
}

// ── Auth middleware ──
async function getPlayer(c: Context): Promise<Player | null> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const playerId = await verifyToken(token);
  if (!playerId) return null;

  return state.players.get(playerId) ?? null;
}

// ── Health (JSON) ──
app.get('/api/health', (c) =>
  c.json({
    name: 'ETO Trading Challenge',
    version: '1.0.0',
    players: state.players.size,
    assets: state.assets.size,
    feeds: priceCache.size,
  }),
);

// ── Pages ──
app.get('/', (c) =>
  c.html(
    landingPage({
      players: state.players.size,
      assets: state.assets.size,
      feeds: priceCache.size,
    }),
  ),
);

app.get('/dashboard', (c) => c.html(dashboardPage()));

// ── Auth Routes ──
app.post('/api/auth/twitter', (c) => {
  const result = getAuthUrl(c.req.url);
  if (!result) {
    return c.json({ error: 'Twitter auth not configured' }, 503);
  }
  return c.json(result);
});

app.get('/api/auth/twitter/callback', async (c) => {
  const code = c.req.query('code');
  const authState = c.req.query('state');

  if (!code || !authState) {
    return c.json({ error: 'Missing code or state' }, 400);
  }

  const result = await handleCallback(code, authState);
  if (!result) {
    return c.json({ error: 'Authentication failed' }, 401);
  }

  // Redirect to dashboard with token in URL fragment
  // (fragments are never sent to the server, safer than query params)
  const encodedToken = encodeURIComponent(result.token);
  return c.redirect(`/dashboard#token=${encodedToken}`);
});

// Dev auth (testing only — disabled in production)
app.post('/api/auth/dev', async (c) => {
  if (process.env['NODE_ENV'] === 'production') {
    return c.json({ error: 'Not found' }, 404);
  }

  const body = await c.req.json<{ handle: string }>();
  if (!body.handle) {
    return c.json({ error: 'handle required' }, 400);
  }

  const player = createDevPlayer(body.handle);
  const token = await signDevToken(player.id);

  return c.json({
    token,
    player: {
      id: player.id,
      handle: player.twitterHandle,
      displayName: player.displayName,
      usdcBalance: player.usdcBalance,
    },
  });
});

// ── Player Routes ──
app.get('/api/me', async (c) => {
  const player = await getPlayer(c);
  if (!player) return c.json({ error: 'Unauthorized' }, 401);

  return c.json({
    id: player.id,
    handle: player.twitterHandle,
    displayName: player.displayName,
    avatarUrl: player.avatarUrl,
    usdcBalance: player.usdcBalance,
    referralCode: player.referralCode,
    bonusCapital: player.bonusCapital,
    createdAt: player.createdAt,
  });
});

// ── Feed Routes ──
app.get('/api/feeds', (c) => {
  const category = c.req.query('category');
  const feeds = priceCache.allFeeds(
    category as Parameters<typeof priceCache.allFeeds>[0],
  );
  return c.json(feeds);
});

// ── Asset Routes ──
app.post('/api/assets', async (c) => {
  const player = await getPlayer(c);
  if (!player) return c.json({ error: 'Unauthorized' }, 401);

  if (!checkRateLimit(player.id)) {
    return c.json({ error: 'Rate limited' }, 429);
  }

  const body = await c.req.json<{
    name: string;
    constituents: Array<{ feedId: string; weight: number }>;
  }>();

  const result = processAction(player.id, {
    type: 'create',
    name: body.name,
    constituents: body.constituents,
  });

  return c.json(result, result.ok ? 200 : 400);
});

app.post('/api/assets/:id/clone', async (c) => {
  const player = await getPlayer(c);
  if (!player) return c.json({ error: 'Unauthorized' }, 401);

  if (!checkRateLimit(player.id)) {
    return c.json({ error: 'Rate limited' }, 429);
  }

  const result = processAction(player.id, {
    type: 'clone',
    assetId: c.req.param('id'),
  });

  return c.json(result, result.ok ? 200 : 400);
});

app.get('/api/assets', (c) => {
  const sortBy = c.req.query('sort') ?? 'clones';
  const limit = parseLimit(c.req.query('limit'), 20);

  const assetList = [...state.assets.values()].map((a) => {
    const history = a.spotPriceHistory;
    const oldest = history.length > 0 ? history[0]! : a.spotPrice;
    const return24h =
      oldest > 0
        ? ((a.spotPrice - oldest) / oldest) * 100
        : 0;

    const creator = state.players.get(a.creatorId);

    return {
      id: a.id,
      name: a.name,
      creator: creator?.twitterHandle ?? 'unknown',
      spotPrice: a.spotPrice,
      cloneCount: a.cloneCount,
      return24h,
      constituents: a.constituents,
      createdAt: a.createdAt,
    };
  });

  switch (sortBy) {
    case 'clones':
      assetList.sort((a, b) => b.cloneCount - a.cloneCount);
      break;
    case 'return_24h':
      assetList.sort((a, b) => b.return24h - a.return24h);
      break;
    case 'newest':
      assetList.sort((a, b) => b.createdAt - a.createdAt);
      break;
  }

  return c.json(assetList.slice(0, limit));
});

app.get('/api/assets/:id', (c) => {
  const asset = state.assets.get(c.req.param('id'));
  if (!asset) return c.json({ error: 'Asset not found' }, 404);

  const creator = state.players.get(asset.creatorId);

  return c.json({
    id: asset.id,
    name: asset.name,
    creator: creator?.twitterHandle ?? 'unknown',
    creatorId: asset.creatorId,
    clonedFromId: asset.clonedFromId,
    constituents: asset.constituents,
    spotPrice: asset.spotPrice,
    cloneCount: asset.cloneCount,
    priceHistory: asset.spotPriceHistory.slice(-500),
    createdAt: asset.createdAt,
  });
});

// ── Trade Routes ──
app.post('/api/trade/buy', async (c) => {
  const player = await getPlayer(c);
  if (!player) return c.json({ error: 'Unauthorized' }, 401);

  if (!checkRateLimit(player.id)) {
    return c.json({ error: 'Rate limited' }, 429);
  }

  const body = await c.req.json<{
    assetId: string;
    usdcAmount: number;
  }>();

  const result = processAction(player.id, {
    type: 'buy',
    assetId: body.assetId,
    usdcAmount: body.usdcAmount,
  });

  return c.json(result, result.ok ? 200 : 400);
});

app.post('/api/trade/sell', async (c) => {
  const player = await getPlayer(c);
  if (!player) return c.json({ error: 'Unauthorized' }, 401);

  if (!checkRateLimit(player.id)) {
    return c.json({ error: 'Rate limited' }, 429);
  }

  const body = await c.req.json<{
    assetId: string;
    shares: number;
  }>();

  const result = processAction(player.id, {
    type: 'sell',
    assetId: body.assetId,
    shares: body.shares,
  });

  return c.json(result, result.ok ? 200 : 400);
});

app.post('/api/stake', async (c) => {
  const player = await getPlayer(c);
  if (!player) return c.json({ error: 'Unauthorized' }, 401);

  if (!checkRateLimit(player.id)) {
    return c.json({ error: 'Rate limited' }, 429);
  }

  const body = await c.req.json<{
    assetId: string;
    shares: number;
  }>();

  const result = processAction(player.id, {
    type: 'stake',
    assetId: body.assetId,
    shares: body.shares,
  });

  return c.json(result, result.ok ? 200 : 400);
});

app.post('/api/assets/:id/rebalance', async (c) => {
  const player = await getPlayer(c);
  if (!player) return c.json({ error: 'Unauthorized' }, 401);

  if (!checkRateLimit(player.id)) {
    return c.json({ error: 'Rate limited' }, 429);
  }

  const body = await c.req.json<{
    constituents: Array<{ feedId: string; weight: number }>;
  }>();

  const result = processAction(player.id, {
    type: 'rebalance',
    assetId: c.req.param('id'),
    constituents: body.constituents,
  });

  return c.json(result, result.ok ? 200 : 400);
});

app.post('/api/unstake', async (c) => {
  const player = await getPlayer(c);
  if (!player) return c.json({ error: 'Unauthorized' }, 401);

  if (!checkRateLimit(player.id)) {
    return c.json({ error: 'Rate limited' }, 429);
  }

  const body = await c.req.json<{
    assetId: string;
    shares: number;
  }>();

  const result = processAction(player.id, {
    type: 'unstake',
    assetId: body.assetId,
    shares: body.shares,
  });

  return c.json(result, result.ok ? 200 : 400);
});

// ── Leaderboard ──
app.get('/api/leaderboard', (c) => {
  const limit = parseLimit(c.req.query('limit'), 100);
  const window = c.req.query('window') ?? 'overall';

  const windowed = getCachedLeaderboard();

  type WindowKey = 'overall' | '24h' | '7d';
  const validWindows: WindowKey[] = ['overall', '24h', '7d'];
  const selectedWindow: WindowKey = validWindows.includes(window as WindowKey)
    ? (window as WindowKey)
    : 'overall';

  const entries = windowed[selectedWindow].slice(0, limit).map((e) => ({
    playerId: e.playerId,
    handle: e.twitterHandle,
    avatarUrl: e.avatarUrl,
    returnPct: e.totalReturnPct,
    rank: e.rank,
    rankDelta: e.rankDelta,
  }));

  return c.json(entries);
});

// ── Portfolio ──
app.get('/api/portfolio', async (c) => {
  const player = await getPlayer(c);
  if (!player) return c.json({ error: 'Unauthorized' }, 401);

  const positions = [];
  let positionsValue = 0;

  for (const pos of state.positions.values()) {
    if (pos.playerId !== player.id) continue;
    positionsValue += pos.currentValue;
    const asset = state.assets.get(pos.assetId);
    positions.push({
      assetId: pos.assetId,
      assetName: asset?.name ?? 'Unknown',
      shares: pos.shares,
      entryPrice: pos.entryPrice,
      currentValue: pos.currentValue,
      pnl: pos.unrealizedPnl,
      pnlPct: pos.unrealizedPnlPct * 100,
    });
  }

  let stakesValue = 0;
  const stakes = [];

  for (const stake of state.stakes.values()) {
    if (stake.playerId !== player.id) continue;
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

  return c.json({
    usdcBalance: player.usdcBalance,
    totalValue,
    returnPct:
      ((totalValue - startingCapital) / startingCapital) * 100,
    positions,
    stakes,
  });
});

// ── Referral ──
app.get('/api/referral/code', async (c) => {
  const player = await getPlayer(c);
  if (!player) return c.json({ error: 'Unauthorized' }, 401);

  let referralCount = 0;
  for (const p of state.players.values()) {
    if (p.referredBy === player.id && p.hasMadeFirstTrade) {
      referralCount++;
    }
  }

  return c.json({
    code: player.referralCode,
    referralCount,
    bonusCapital: player.bonusCapital,
  });
});

app.post('/api/referral/apply', async (c) => {
  const player = await getPlayer(c);
  if (!player) return c.json({ error: 'Unauthorized' }, 401);

  if (player.referredBy) {
    return c.json({ error: 'Already has a referrer' }, 400);
  }

  const body = await c.req.json<{ code: string }>();

  // Find the referrer by code
  let referrer: Player | undefined;
  for (const p of state.players.values()) {
    if (p.referralCode === body.code) {
      referrer = p;
      break;
    }
  }

  if (!referrer) {
    return c.json({ error: 'Invalid referral code' }, 400);
  }

  if (referrer.id === player.id) {
    return c.json({ error: 'Cannot refer yourself' }, 400);
  }

  // Mutate player's referredBy (cast away readonly for this mutation)
  (player as { referredBy: string | null }).referredBy =
    referrer.id;
  state.dirtyPlayers.add(player.id);

  return c.json({ ok: true, referredBy: referrer.twitterHandle });
});

// ── Price History ──
app.get('/api/assets/:id/history', (c) => {
  const assetId = c.req.param('id');
  const asset = state.assets.get(assetId);
  if (!asset) return c.json({ error: 'Asset not found' }, 404);

  const limit = parseLimit(c.req.query('limit'), HISTORY_MAX_SIZE, HISTORY_MAX_SIZE);
  const since = parseInt(c.req.query('since') ?? '0', 10);
  const db = getDb();

  const rows = since > 0
    ? db.query(
        'SELECT spot_price, timestamp FROM price_history WHERE asset_id = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT ?',
      ).all(assetId, since, limit) as { spot_price: number; timestamp: number }[]
    : db.query(
        'SELECT spot_price, timestamp FROM price_history WHERE asset_id = ? ORDER BY timestamp DESC LIMIT ?',
      ).all(assetId, limit) as { spot_price: number; timestamp: number }[];

  // Return in chronological order
  return c.json(
    rows.reverse().map((r) => ({
      price: r.spot_price,
      timestamp: r.timestamp,
    })),
  );
});

app.get('/api/feeds/:id/history', (c) => {
  const feedId = c.req.param('id');
  const limit = parseLimit(c.req.query('limit'), HISTORY_MAX_SIZE, HISTORY_MAX_SIZE);
  const since = parseInt(c.req.query('since') ?? '0', 10);
  const db = getDb();

  const rows = since > 0
    ? db.query(
        'SELECT price, timestamp FROM feed_price_history WHERE feed_id = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT ?',
      ).all(feedId, since, limit) as { price: number; timestamp: number }[]
    : db.query(
        'SELECT price, timestamp FROM feed_price_history WHERE feed_id = ? ORDER BY timestamp DESC LIMIT ?',
      ).all(feedId, limit) as { price: number; timestamp: number }[];

  return c.json(
    rows.reverse().map((r) => ({
      price: r.price,
      timestamp: r.timestamp,
    })),
  );
});

// ── MCP Streamable HTTP endpoint ──
// Requires MCP_API_KEY in production; open in dev mode.
app.all('/mcp', async (c) => {
  const mcpKey = process.env['MCP_API_KEY'];
  if (mcpKey) {
    const authHeader = c.req.header('Authorization');
    if (authHeader !== `Bearer ${mcpKey}`) {
      return c.json({ error: 'Invalid MCP API key' }, 401);
    }
  } else if (process.env['NODE_ENV'] === 'production') {
    return c.json(
      { error: 'MCP_API_KEY not configured' },
      503,
    );
  }
  return handleMcpRequest(c.req.raw);
});

export { app };
