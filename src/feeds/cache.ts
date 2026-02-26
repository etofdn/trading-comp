// ── In-memory price cache — the single source of truth for prices ──

import type { CachedPrice, PriceFeed, FeedCategory, FeedSource } from '../types.ts';

interface FeedMeta {
  readonly name: string;
  readonly symbol: string;
  readonly category: FeedCategory;
  readonly source: FeedSource;
  readonly scaleFactor: number;
  readonly updateFrequency: number;
}

class PriceCache {
  private readonly prices = new Map<string, CachedPrice>();
  private readonly meta = new Map<string, FeedMeta>();

  registerFeed(
    id: string,
    meta: FeedMeta,
  ): void {
    this.meta.set(id, meta);
    if (!this.prices.has(id)) {
      this.prices.set(id, { price: 0, updatedAt: 0 });
    }
  }

  update(
    id: string,
    price: number,
    confidence?: number,
  ): void {
    const entry = this.prices.get(id);
    if (entry) {
      entry.price = price;
      entry.updatedAt = Date.now();
      entry.confidence = confidence;
    } else {
      this.prices.set(id, {
        price,
        updatedAt: Date.now(),
        confidence,
      });
    }
  }

  get(id: string): number {
    return this.prices.get(id)?.price ?? 0;
  }

  has(id: string): boolean {
    return this.prices.has(id) && this.prices.get(id)!.price > 0;
  }

  getEntry(id: string): CachedPrice | undefined {
    return this.prices.get(id);
  }

  getMeta(id: string): FeedMeta | undefined {
    return this.meta.get(id);
  }

  /** Single-copy snapshot of all prices for tick computation. */
  snapshot(): Map<string, number> {
    const snap = new Map<string, number>();
    for (const [k, v] of this.prices) {
      snap.set(k, v.price);
    }
    return snap;
  }

  /** All registered feeds with current prices, for API responses. */
  allFeeds(category?: FeedCategory): PriceFeed[] {
    const result: PriceFeed[] = [];
    for (const [id, m] of this.meta) {
      if (category && category !== 'all' as string && m.category !== category) {
        continue;
      }
      const cached = this.prices.get(id);
      result.push({
        id,
        name: m.name,
        symbol: m.symbol,
        category: m.category,
        price: cached?.price ?? 0,
        scaleFactor: m.scaleFactor,
        updatedAt: cached?.updatedAt ?? 0,
        source: m.source,
        updateFrequency: m.updateFrequency,
      });
    }
    return result;
  }

  get size(): number {
    return this.prices.size;
  }
}

export const priceCache = new PriceCache();
