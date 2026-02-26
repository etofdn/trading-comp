// ── MCP Server — AI agent interface via Streamable HTTP ──
// Uses WebStandardStreamableHTTPServerTransport for Bun/Hono compat.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { processAction } from '../engine/actions.ts';
import { state } from '../engine/state.ts';
import { priceCache } from '../feeds/cache.ts';
import { createDevPlayer } from '../auth/twitter.ts';
import type { Constituent } from '../types.ts';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'eto-trading-challenge',
    version: '1.0.0',
  });

  // ── get_feeds ──
  server.tool(
    'get_feeds',
    'List all available price feeds with current prices',
    {
      category: z.enum([
        'crypto', 'equity', 'commodity', 'macro', 'exotic', 'all',
      ]).optional().default('all'),
    },
    async ({ category }) => {
      const feeds = priceCache.allFeeds(
        category === 'all' ? undefined : category,
      );
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(feeds, null, 2),
        }],
      };
    },
  );

  // ── get_portfolio ──
  server.tool(
    'get_portfolio',
    'Get current portfolio, positions, stakes, and P&L for an agent',
    {
      agentName: z.string().describe(
        'Unique name for this AI agent (used as player identity)',
      ),
    },
    async ({ agentName }) => {
      const player = ensureAgentPlayer(agentName);
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
      const returnPct =
        ((totalValue - 100_000) / 100_000) * 100;

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            playerId: player.id,
            handle: player.twitterHandle,
            usdcBalance: player.usdcBalance,
            totalValue,
            returnPct,
            positions,
            stakes,
          }, null, 2),
        }],
      };
    },
  );

  // ── create_asset ──
  server.tool(
    'create_asset',
    'Create a new index token from price feed constituents. Weights must sum to 1.0.',
    {
      agentName: z.string().describe('Unique agent name'),
      name: z.string().describe('Name for the index token'),
      constituents: z.array(z.object({
        feedId: z.string(),
        weight: z.number().min(0.01).max(1),
      })).describe('Array of {feedId, weight} objects'),
    },
    async ({ agentName, name, constituents }) => {
      const player = ensureAgentPlayer(agentName);
      const result = processAction(player.id, {
        type: 'create',
        name,
        constituents: constituents as Constituent[],
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result),
        }],
      };
    },
  );

  // ── trade ──
  server.tool(
    'trade',
    'Buy or sell shares of an asset',
    {
      agentName: z.string().describe('Unique agent name'),
      action: z.enum(['buy', 'sell']),
      assetId: z.string(),
      amount: z.number().positive().describe(
        'USDC amount for buy, share count for sell',
      ),
    },
    async ({ agentName, action, assetId, amount }) => {
      const player = ensureAgentPlayer(agentName);
      const result = action === 'buy'
        ? processAction(player.id, {
            type: 'buy',
            assetId,
            usdcAmount: amount,
          })
        : processAction(player.id, {
            type: 'sell',
            assetId,
            shares: amount,
          });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result),
        }],
      };
    },
  );

  // ── manage_stake ──
  server.tool(
    'manage_stake',
    'Stake or unstake shares of an asset to earn yield',
    {
      agentName: z.string().describe('Unique agent name'),
      action: z.enum(['stake', 'unstake']),
      assetId: z.string(),
      shares: z.number().positive(),
    },
    async ({ agentName, action, assetId, shares }) => {
      const player = ensureAgentPlayer(agentName);
      const result = processAction(player.id, {
        type: action,
        assetId,
        shares,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result),
        }],
      };
    },
  );

  // ── get_leaderboard ──
  server.tool(
    'get_leaderboard',
    'Get current leaderboard rankings',
    {
      limit: z.number().optional().default(20),
    },
    async ({ limit }) => {
      const entries = [];
      for (const player of state.players.values()) {
        let totalValue = player.usdcBalance;
        for (const pos of state.positions.values()) {
          if (pos.playerId === player.id) {
            totalValue += pos.currentValue;
          }
        }
        for (const stake of state.stakes.values()) {
          if (stake.playerId === player.id) {
            const asset = state.assets.get(stake.assetId);
            if (asset) {
              totalValue +=
                stake.stakedShares * asset.spotPrice +
                stake.accumulatedYield;
            }
          }
        }
        entries.push({
          handle: player.twitterHandle,
          returnPct:
            ((totalValue - 100_000 - player.bonusCapital) /
              (100_000 + player.bonusCapital)) * 100,
        });
      }
      entries.sort((a, b) => b.returnPct - a.returnPct);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(entries.slice(0, limit), null, 2),
        }],
      };
    },
  );

  // ── get_asset ──
  server.tool(
    'get_asset',
    'Get details and price history for a specific asset',
    { assetId: z.string() },
    async ({ assetId }) => {
      const asset = state.assets.get(assetId);
      if (!asset) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Asset not found' }),
          }],
        };
      }

      const creator = state.players.get(asset.creatorId);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            id: asset.id,
            name: asset.name,
            creator: creator?.twitterHandle ?? 'unknown',
            constituents: asset.constituents,
            spotPrice: asset.spotPrice,
            cloneCount: asset.cloneCount,
            priceHistory: asset.spotPriceHistory.slice(-100),
            createdAt: asset.createdAt,
          }, null, 2),
        }],
      };
    },
  );

  // ── browse_assets ──
  server.tool(
    'browse_assets',
    'Browse the asset gallery — all created index tokens',
    {
      sortBy: z.enum(['clones', 'return_24h', 'newest'])
        .optional()
        .default('clones'),
      limit: z.number().optional().default(20),
    },
    async ({ sortBy, limit }) => {
      const assetList = [...state.assets.values()].map((a) => {
        const history = a.spotPriceHistory;
        const oldest =
          history.length > 0 ? history[0]! : a.spotPrice;
        const return24h =
          oldest > 0
            ? ((a.spotPrice - oldest) / oldest) * 100
            : 0;

        return {
          id: a.id,
          name: a.name,
          spotPrice: a.spotPrice,
          cloneCount: a.cloneCount,
          return24h,
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

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(
            assetList.slice(0, limit),
            null,
            2,
          ),
        }],
      };
    },
  );

  // ── rebalance_asset ──
  server.tool(
    'rebalance_asset',
    'Rebalance an index token you created — change the constituent weights. All holders get the new composition.',
    {
      agentName: z.string().describe('Unique agent name'),
      assetId: z.string().describe('ID of the asset to rebalance'),
      constituents: z.array(z.object({
        feedId: z.string(),
        weight: z.number().min(0.01).max(1),
      })).describe(
        'New constituents with weights summing to 1.0',
      ),
    },
    async ({ agentName, assetId, constituents }) => {
      const player = ensureAgentPlayer(agentName);
      const result = processAction(player.id, {
        type: 'rebalance',
        assetId,
        constituents: constituents as Constituent[],
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result),
        }],
      };
    },
  );

  return server;
}

// ── Transport + session management ──
// Each session gets its own McpServer + transport pair because
// McpServer.connect() binds 1:1 to a transport instance.
interface McpSession {
  readonly server: McpServer;
  readonly transport: WebStandardStreamableHTTPServerTransport;
}

const sessions = new Map<string, McpSession>();

export async function handleMcpRequest(
  req: Request,
): Promise<Response> {
  const sessionId = req.headers.get('mcp-session-id');

  // Existing session — route through its transport
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    return session.transport.handleRequest(req);
  }

  // New session — fresh server + transport pair
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { server, transport });
      console.log(`[mcp] Session started: ${id}`);
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId);
      console.log(
        `[mcp] Session closed: ${transport.sessionId}`,
      );
    }
  };

  await server.connect(transport);
  return transport.handleRequest(req);
}

// ── Agent player management ──
function ensureAgentPlayer(
  agentName: string,
): ReturnType<typeof createDevPlayer> {
  return createDevPlayer(`agent:${agentName}`);
}
