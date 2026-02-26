-- ETO Trading Challenge — SQLite Schema
-- WAL mode for concurrent reads during async writes

PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  twitter_id TEXT UNIQUE NOT NULL,
  twitter_handle TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  usdc_balance REAL NOT NULL DEFAULT 100000,
  referral_code TEXT UNIQUE NOT NULL,
  referred_by TEXT,
  bonus_capital REAL NOT NULL DEFAULT 0,
  has_made_first_trade INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  creator_id TEXT NOT NULL REFERENCES players(id),
  cloned_from_id TEXT,
  constituents TEXT NOT NULL,  -- JSON array of {feedId, weight}
  clone_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,           -- "playerId:assetId"
  player_id TEXT NOT NULL REFERENCES players(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  shares REAL NOT NULL,
  entry_price REAL NOT NULL,
  entry_value REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS stakes (
  id TEXT PRIMARY KEY,           -- "playerId:assetId:stake"
  player_id TEXT NOT NULL REFERENCES players(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  staked_shares REAL NOT NULL,
  cost_basis REAL NOT NULL DEFAULT 0,
  staked_at INTEGER NOT NULL,
  accumulated_yield REAL NOT NULL DEFAULT 0,
  last_yield_tick INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL REFERENCES players(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  shares REAL NOT NULL,
  usdc_amount REAL NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  data TEXT NOT NULL  -- JSON leaderboard
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL REFERENCES players(id),
  timestamp INTEGER NOT NULL,
  total_value REAL NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_trades_player ON trades(player_id);
CREATE INDEX IF NOT EXISTS idx_trades_asset ON trades(asset_id);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
CREATE INDEX IF NOT EXISTS idx_positions_player ON positions(player_id);
CREATE INDEX IF NOT EXISTS idx_stakes_player ON stakes(player_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_ts ON leaderboard_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_portfolio_snap ON portfolio_snapshots(player_id, timestamp);
