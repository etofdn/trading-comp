// ── ETO Trading Challenge — Entry Point ──
// Single-process server: REST + WebSocket + MCP + Tick Engine

import { initDb } from './db/connection.ts';
import { rehydrateState } from './db/recover.ts';
import { connectPyth } from './feeds/pyth.ts';
import { registerFredFeeds, pollFred, startFredPolling } from './feeds/fred.ts';
import { initTwitterAuth } from './auth/twitter.ts';
import { startTickEngine } from './engine/tick.ts';
import { app } from './server.ts';
import {
  registerClient,
  removeClient,
  type WsData,
} from './ws/broadcast.ts';
import { verifyToken } from './auth/twitter.ts';

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

async function boot(): Promise<void> {
  console.log('┌─────────────────────────────────────┐');
  console.log('│   ETO Trading Challenge — Booting    │');
  console.log('└─────────────────────────────────────┘');

  // 1. Initialize SQLite
  initDb();

  // 2. Rehydrate state from DB
  rehydrateState();

  // 3. Initialize auth
  initTwitterAuth();

  // 4. Register and connect price feeds
  registerFredFeeds();
  await connectPyth();
  await pollFred();
  startFredPolling();

  // 5. Start tick engine
  startTickEngine();

  // 6. Start HTTP + WebSocket server
  const server = Bun.serve({
    port: PORT,
    fetch: app.fetch,
    websocket: {
      open(ws: import('bun').ServerWebSocket<WsData>) {
        const { playerId } = ws.data;
        if (playerId) {
          registerClient(playerId, ws);
          console.log(`[ws] Client connected: ${playerId}`);
        }
      },
      message(_ws: import('bun').ServerWebSocket<WsData>, _msg: string | Buffer) {
        // Clients don't send messages; actions go via REST/MCP
      },
      close(ws: import('bun').ServerWebSocket<WsData>) {
        const { playerId } = ws.data;
        if (playerId) {
          removeClient(playerId);
        }
      },
    },
  });

  console.log('');
  console.log(`  REST API:    http://localhost:${PORT}/api`);
  console.log(`  WebSocket:   ws://localhost:${PORT}/ws`);
  console.log(`  MCP:         http://localhost:${PORT}/mcp`);
  console.log(`  Health:      http://localhost:${PORT}/`);
  console.log('');
  console.log('  Ready.');
}

boot().catch((err) => {
  console.error('Fatal boot error:', err);
  process.exit(1);
});
