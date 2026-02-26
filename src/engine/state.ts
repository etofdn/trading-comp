// ── In-memory game state — the single mutable store ──

import type { GameState } from '../types.ts';

export const state: GameState = {
  players: new Map(),
  assets: new Map(),
  positions: new Map(),
  stakes: new Map(),
  trades: [],
  dirtyPlayers: new Set(),
  dirtyPositions: new Set(),
  dirtyAssets: new Set(),
  dirtyStakes: new Set(),
  previousRanks: new Map(),
  portfolioSnapshots: new Map(),
  portfolioSnapshotsDirty: false,
};
