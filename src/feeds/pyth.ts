// ── Pyth Hermes client — dynamic feed discovery + real-time SSE ──
// Pulls the full feed catalog from Pyth API, filters for relevant
// assets, registers them in the price cache, then streams updates.

import { priceCache } from './cache.ts';
import type { FeedCategory } from '../types.ts';

const HERMES_BASE = 'https://hermes.pyth.network';

// ── Pyth API response types ──
interface PythPriceFeedEntry {
  readonly id: string;
  readonly attributes: {
    readonly asset_type: string;
    readonly base: string;
    readonly quote_currency: string;
    readonly symbol: string;
    readonly description: string;
  };
}

interface PythPriceUpdate {
  readonly id: string;
  readonly price: {
    readonly price: string;
    readonly expo: number;
    readonly conf: string;
  };
}

interface PythStreamMessage {
  readonly parsed: readonly PythPriceUpdate[];
}

// ── Category mapping from Pyth asset_type ──
const ASSET_TYPE_TO_CATEGORY: Record<string, FeedCategory> = {
  Crypto: 'crypto',
  Equity: 'equity',
  FX: 'macro',
  Metal: 'commodity',
  Commodities: 'commodity',
};

// ── State ──
let activeFeedIds: string[] = [];
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY_MS = 30_000;
let abortController: AbortController | null = null;

/**
 * Discover available feeds from Pyth's API, register matching
 * feeds in the price cache, then start streaming.
 */
export async function connectPyth(): Promise<void> {
  // 1. Discover feeds from the Pyth API
  const discovered = await discoverFeeds();

  if (discovered.length === 0) {
    console.warn(
      '[pyth] No feeds discovered — check network connectivity',
    );
    return;
  }

  // 2. Register all discovered feeds in the price cache
  for (const feed of discovered) {
    priceCache.registerFeed(`pyth:${feed.id}`, {
      name: feed.name,
      symbol: feed.symbol,
      category: feed.category,
      source: 'pyth',
      scaleFactor: 1,
      updateFrequency: 400,
    });
  }

  activeFeedIds = discovered.map((f) => f.id);
  console.log(
    `[pyth] Registered ${activeFeedIds.length} feeds from API`,
  );

  // 3. Fetch initial prices via REST
  await fetchInitialPrices(activeFeedIds);

  // 4. Open SSE stream for real-time updates
  openStream(activeFeedIds);
}

interface DiscoveredFeed {
  readonly id: string;
  readonly name: string;
  readonly symbol: string;
  readonly category: FeedCategory;
}

async function discoverFeeds(): Promise<DiscoveredFeed[]> {
  try {
    const resp = await fetch(
      `${HERMES_BASE}/v2/price_feeds`,
    );
    if (!resp.ok) {
      console.error(
        `[pyth] Feed discovery failed: ${resp.status}`,
      );
      return [];
    }

    const feeds = (await resp.json()) as PythPriceFeedEntry[];
    const result: DiscoveredFeed[] = [];
    const seenSymbols = new Set<string>();

    for (const feed of feeds) {
      const attrs = feed.attributes;
      if (!attrs) continue;

      const base = attrs.base?.toUpperCase();
      const quote = attrs.quote_currency?.toUpperCase();

      // Only USD-quoted feeds
      if (quote !== 'USD') continue;
      if (!base) continue;

      // Deduplicate (some feeds have multiple entries)
      if (seenSymbols.has(base)) continue;
      seenSymbols.add(base);

      const category =
        ASSET_TYPE_TO_CATEGORY[attrs.asset_type] ?? 'exotic';

      result.push({
        id: feed.id,
        name: attrs.description || `${base}/USD`,
        symbol: base,
        category,
      });
    }

    return result;
  } catch (err) {
    console.error('[pyth] Feed discovery error:', err);
    return [];
  }
}

async function fetchInitialPrices(
  feedIds: readonly string[],
): Promise<void> {
  // Pyth API limits query size, batch in groups of 50
  const BATCH_SIZE = 50;
  for (let i = 0; i < feedIds.length; i += BATCH_SIZE) {
    const batch = feedIds.slice(i, i + BATCH_SIZE);
    const idsParam = batch.map((id) => `ids[]=${id}`).join('&');
    const url =
      `${HERMES_BASE}/v2/updates/price/latest?${idsParam}`;

    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        console.error(
          `[pyth] Initial price batch failed: ${resp.status}`,
        );
        continue;
      }
      const data = (await resp.json()) as PythStreamMessage;
      processPriceUpdates(data.parsed);
    } catch (err) {
      console.error('[pyth] Initial price batch error:', err);
    }
  }

  console.log(
    `[pyth] Loaded initial prices for ${feedIds.length} feeds`,
  );
}

function openStream(feedIds: readonly string[]): void {
  abortController?.abort();
  abortController = new AbortController();

  const idsParam = feedIds.map((id) => `ids[]=${id}`).join('&');
  const url =
    `${HERMES_BASE}/v2/updates/price/stream?${idsParam}`;

  console.log(
    `[pyth] Opening SSE stream (${feedIds.length} feeds)...`,
  );

  fetch(url, { signal: abortController.signal })
    .then(async (resp) => {
      if (!resp.ok || !resp.body) {
        throw new Error(`Stream response error: ${resp.status}`);
      }

      reconnectAttempts = 0;
      console.log('[pyth] SSE stream connected');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const jsonStr = line.slice(5).trim();
            if (jsonStr) {
              try {
                const msg = JSON.parse(
                  jsonStr,
                ) as PythStreamMessage;
                if (msg.parsed) {
                  processPriceUpdates(msg.parsed);
                }
              } catch {
                // Partial JSON or non-JSON line
              }
            }
          }
        }
      }

      scheduleReconnect(feedIds);
    })
    .catch((err: unknown) => {
      if (
        err instanceof Error &&
        err.name === 'AbortError'
      ) {
        return;
      }
      console.error('[pyth] Stream error:', err);
      scheduleReconnect(feedIds);
    });
}

function processPriceUpdates(
  updates: readonly PythPriceUpdate[],
): void {
  for (const update of updates) {
    const rawPrice = Number(update.price.price);
    const expo = update.price.expo;
    const price = rawPrice * Math.pow(10, expo);
    const confidence =
      Number(update.price.conf) * Math.pow(10, expo);

    priceCache.update(`pyth:${update.id}`, price, confidence);
  }
}

function scheduleReconnect(feedIds: readonly string[]): void {
  reconnectAttempts++;
  const delay = Math.min(
    1000 * Math.pow(2, reconnectAttempts - 1),
    MAX_RECONNECT_DELAY_MS,
  );
  console.log(
    `[pyth] Reconnecting in ${delay}ms ` +
    `(attempt ${reconnectAttempts})`,
  );
  setTimeout(() => openStream(feedIds), delay);
}

export function disconnectPyth(): void {
  abortController?.abort();
  abortController = null;
}

/** Expose discovered feed IDs for external use. */
export function getActiveFeedIds(): readonly string[] {
  return activeFeedIds;
}
