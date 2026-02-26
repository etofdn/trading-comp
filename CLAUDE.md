# ETO Trading Challenge

Real-time trading competition engine. 2-second ticks, in-memory state, SQLite persistence.

## Tech Stack
- **Runtime:** Bun (bun:sqlite, native WebSocket)
- **HTTP:** Hono
- **Prices:** Pyth Hermes SSE (crypto, ~400ms) + FRED API (macro, daily)
- **MCP:** @modelcontextprotocol/sdk with WebStandardStreamableHTTPServerTransport
- **Auth:** Twitter OAuth 2.0 via arctic
- **DB:** SQLite (WAL mode, async persistence)

## Commands
```bash
bun run dev          # Watch mode
bun run start        # Production
bun x tsc --noEmit   # Type check
bun test             # Tests
```

## Architecture
Single Bun process. Everything hot-path is in-memory:
- `src/engine/` — tick loop, action processor, leaderboard
- `src/feeds/` — Pyth SSE + FRED polling + price cache
- `src/mcp/` — MCP server (8 tools for AI agents)
- `src/auth/` — Twitter OAuth 2.0 + dev auth
- `src/db/` — SQLite schema, async persistence, crash recovery
- `src/ws/` — WebSocket broadcast hub
- `src/server.ts` — Hono routes
- `src/index.ts` — Boot sequence

## Key Invariants
1. Conservation of value: sum of all balances + positions + stakes = total injected capital + yield
2. Asset weights always sum to 1.0
3. No negative balances
4. Tick completes in <500ms for 1000 players

## API Endpoints
- `POST /api/auth/dev` — Dev auth (body: `{handle}`)
- `GET /api/feeds` — All price feeds
- `POST /api/assets` — Create index token
- `POST /api/trade/buy` / `POST /api/trade/sell` — Trade
- `POST /api/stake` / `POST /api/unstake` — Staking
- `GET /api/leaderboard` — Rankings
- `GET /api/portfolio` — Player portfolio (auth required)
- `ALL /mcp` — MCP streamable HTTP for AI agents

## Environment Variables
See `.env.example`. Bun auto-loads `.env`.
