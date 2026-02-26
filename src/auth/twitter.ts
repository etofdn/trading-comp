// ── Twitter/X OAuth 2.0 authentication ──

import { Twitter } from 'arctic';
import { nanoid } from 'nanoid';
import { state } from '../engine/state.ts';
import { SEASON } from '../config.ts';
import type { Player } from '../types.ts';

interface TwitterUserResponse {
  readonly data: {
    readonly id: string;
    readonly username: string;
    readonly name: string;
    readonly profile_image_url: string;
  };
}

// JWT-like signed token (using Bun's crypto)
const JWT_SECRET = process.env['JWT_SECRET'] ?? 'dev-secret-change-me';
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Twitter credentials (set once at boot)
let twitterClientId: string | null = null;
let twitterClientSecret: string | null = null;

// Store pending OAuth states (code_verifier + redirect_uri + state)
const pendingAuth = new Map<
  string,
  {
    codeVerifier: string;
    redirectUri: string;
    createdAt: number;
  }
>();

export function initTwitterAuth(): void {
  twitterClientId = process.env['TWITTER_CLIENT_ID'] ?? null;
  twitterClientSecret = process.env['TWITTER_CLIENT_SECRET'] ?? null;

  if (!twitterClientId || !twitterClientSecret) {
    console.warn(
      '[auth] TWITTER_CLIENT_ID or TWITTER_CLIENT_SECRET not set — auth disabled',
    );
    return;
  }

  console.log('[auth] Twitter OAuth initialized');
}

/**
 * Build the auth URL using the request's own host so the
 * callback always points to the correct IP / domain.
 */
export function getAuthUrl(requestUrl: string): {
  url: string;
  state: string;
} | null {
  if (!twitterClientId || !twitterClientSecret) return null;

  // Derive callback URL from the incoming request's origin
  const origin = new URL(requestUrl).origin;
  const redirectUri = `${origin}/api/auth/twitter/callback`;

  const client = new Twitter(
    twitterClientId,
    twitterClientSecret,
    redirectUri,
  );

  const authState = nanoid(32);
  const codeVerifier = nanoid(64);
  const scopes = ['tweet.read', 'users.read'];
  const url = client.createAuthorizationURL(
    authState,
    codeVerifier,
    scopes,
  );

  pendingAuth.set(authState, {
    codeVerifier,
    redirectUri,
    createdAt: Date.now(),
  });

  // Clean up old pending auths (>10 min)
  for (const [key, val] of pendingAuth) {
    if (Date.now() - val.createdAt > 10 * 60 * 1000) {
      pendingAuth.delete(key);
    }
  }

  return { url: url.toString(), state: authState };
}

export async function handleCallback(
  code: string,
  authState: string,
): Promise<{ token: string; player: Player } | null> {
  if (!twitterClientId || !twitterClientSecret) return null;

  const pending = pendingAuth.get(authState);
  if (!pending) return null;
  pendingAuth.delete(authState);

  try {
    // Recreate client with the same redirect_uri used for the auth URL
    const client = new Twitter(
      twitterClientId,
      twitterClientSecret,
      pending.redirectUri,
    );
    const tokens = await client.validateAuthorizationCode(
      code,
      pending.codeVerifier,
    );

    // Fetch user profile from Twitter API
    const userResp = await fetch(
      'https://api.twitter.com/2/users/me?user.fields=profile_image_url',
      {
        headers: {
          Authorization: `Bearer ${tokens.accessToken()}`,
        },
      },
    );

    if (!userResp.ok) {
      console.error(
        `[auth] Twitter user fetch failed: ${userResp.status}`,
      );
      return null;
    }

    const userData = (await userResp.json()) as TwitterUserResponse;
    const twitterUser = userData.data;

    // Find or create player
    let player = findPlayerByTwitterId(twitterUser.id);

    if (!player) {
      player = {
        id: nanoid(12),
        twitterId: twitterUser.id,
        twitterHandle: twitterUser.username,
        displayName: twitterUser.name,
        avatarUrl: twitterUser.profile_image_url ?? '',
        usdcBalance: SEASON.startingBalance,
        referralCode: nanoid(8).toUpperCase(),
        referredBy: null,
        bonusCapital: 0,
        hasMadeFirstTrade: false,
        createdAt: Date.now(),
      };
      state.players.set(player.id, player);
      state.dirtyPlayers.add(player.id);
      console.log(
        `[auth] New player: @${player.twitterHandle} (${player.id})`,
      );
    } else {
      // Update profile data on login
      player.displayName = twitterUser.name;
      player.avatarUrl = twitterUser.profile_image_url ?? '';
      state.dirtyPlayers.add(player.id);
    }

    const token = await signToken(player.id);
    return { token, player };
  } catch (err) {
    console.error('[auth] OAuth callback error:', err);
    return null;
  }
}

export async function verifyToken(
  token: string,
): Promise<string | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, sigB64] = parts as [string, string];

    const key = await getCryptoKey();
    const data = new TextEncoder().encode(payloadB64);
    const signature = base64UrlDecode(sigB64);

    const sigBuffer = new ArrayBuffer(signature.byteLength);
    new Uint8Array(sigBuffer).set(signature);
    const dataBuffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(dataBuffer).set(data);

    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBuffer,
      dataBuffer,
    );

    if (!valid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payloadB64)),
    ) as { sub: string; exp: number };

    if (Date.now() > payload.exp) return null;

    return payload.sub;
  } catch {
    return null;
  }
}

// ── Dev mode: create a test player without Twitter OAuth ──
export function createDevPlayer(handle: string): Player {
  const existing = findPlayerByTwitterHandle(handle);
  if (existing) return existing;

  const player: Player = {
    id: nanoid(12),
    twitterId: `dev-${nanoid(8)}`,
    twitterHandle: handle,
    displayName: handle,
    avatarUrl: '',
    usdcBalance: SEASON.startingBalance,
    referralCode: nanoid(8).toUpperCase(),
    referredBy: null,
    bonusCapital: 0,
    hasMadeFirstTrade: false,
    createdAt: Date.now(),
  };
  state.players.set(player.id, player);
  state.dirtyPlayers.add(player.id);
  return player;
}

export async function signDevToken(
  playerId: string,
): Promise<string> {
  return signToken(playerId);
}

// ── Helpers ──
function findPlayerByTwitterId(
  twitterId: string,
): Player | undefined {
  for (const player of state.players.values()) {
    if (player.twitterId === twitterId) return player;
  }
  return undefined;
}

function findPlayerByTwitterHandle(
  handle: string,
): Player | undefined {
  for (const player of state.players.values()) {
    if (player.twitterHandle === handle) return player;
  }
  return undefined;
}

let cachedKey: CryptoKey | null = null;

async function getCryptoKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  cachedKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return cachedKey;
}

async function signToken(playerId: string): Promise<string> {
  const payload = {
    sub: playerId,
    exp: Date.now() + TOKEN_EXPIRY_MS,
  };
  const payloadB64 = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const key = await getCryptoKey();
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payloadB64),
  );
  const sigB64 = base64UrlEncode(new Uint8Array(signature));
  return `${payloadB64}.${sigB64}`;
}

function base64UrlEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(str.length + ((4 - (str.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
