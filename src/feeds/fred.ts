// ── FRED API poller — macro & commodity data (daily updates) ──

import { priceCache } from './cache.ts';
import { FRED_FEEDS, optionalEnv } from '../config.ts';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function registerFredFeeds(): void {
  for (const feed of FRED_FEEDS) {
    priceCache.registerFeed(`fred:${feed.id}`, {
      name: feed.name,
      symbol: feed.symbol,
      category: feed.category,
      source: 'fred',
      scaleFactor: feed.scaleFactor,
      updateFrequency: POLL_INTERVAL_MS,
    });
  }
}

export async function pollFred(): Promise<void> {
  const apiKey = optionalEnv('FRED_API_KEY', '');
  if (!apiKey) {
    console.warn(
      '[fred] No FRED_API_KEY set — macro feeds will show $0',
    );
    return;
  }

  const results = await Promise.allSettled(
    FRED_FEEDS.map((feed) => fetchFredSeries(feed.id, apiKey)),
  );

  let loaded = 0;
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const feed = FRED_FEEDS[i]!;
    if (result.status === 'fulfilled' && result.value !== null) {
      const scaledPrice = result.value * feed.scaleFactor;
      priceCache.update(`fred:${feed.id}`, scaledPrice);
      loaded++;
    }
  }

  console.log(
    `[fred] Loaded ${loaded}/${FRED_FEEDS.length} macro feeds`,
  );
}

async function fetchFredSeries(
  seriesId: string,
  apiKey: string,
): Promise<number | null> {
  const params = new URLSearchParams({
    series_id: seriesId,
    sort_order: 'desc',
    limit: '1',
    api_key: apiKey,
    file_type: 'json',
  });

  try {
    const resp = await fetch(`${FRED_BASE}?${params}`);
    if (!resp.ok) {
      console.error(
        `[fred] ${seriesId} fetch failed: ${resp.status}`,
      );
      return null;
    }

    const data = (await resp.json()) as {
      observations: Array<{ value: string }>;
    };

    const raw = data.observations[0]?.value;
    if (!raw || raw === '.') return null;

    return parseFloat(raw);
  } catch (err) {
    console.error(`[fred] ${seriesId} error:`, err);
    return null;
  }
}

export function startFredPolling(): void {
  pollTimer = setInterval(() => {
    pollFred().catch((err) => {
      console.error('[fred] Poll cycle error:', err);
    });
  }, POLL_INTERVAL_MS);
}

export function stopFredPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
