// ── Landing page — server-rendered HTML ──
// No framework, no build step. Just HTML served by Hono.

import { SEASON } from '../config.ts';

/** Escape dynamic values for safe HTML embedding */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function landingPage(stats: {
  readonly players: number;
  readonly assets: number;
  readonly feeds: number;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ETO Trading Challenge</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0a0a0f;
      --surface: #12121a;
      --border: #1e1e2e;
      --text: #e4e4ef;
      --text-muted: #8888a0;
      --accent: #6366f1;
      --accent-hover: #818cf8;
      --green: #22c55e;
      --red: #ef4444;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
        Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .container {
      max-width: 800px;
      width: 100%;
      padding: 2rem;
    }

    .hero {
      text-align: center;
      padding: 4rem 0 3rem;
    }

    .hero h1 {
      font-size: 2.5rem;
      font-weight: 700;
      margin-bottom: 0.75rem;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .hero p {
      color: var(--text-muted);
      font-size: 1.15rem;
      max-width: 540px;
      margin: 0 auto 2rem;
      line-height: 1.6;
    }

    .sign-in-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.875rem 2rem;
      background: #fff;
      color: #000;
      border: none;
      border-radius: 9999px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.15s;
      text-decoration: none;
    }

    .sign-in-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 24px rgba(99, 102, 241, 0.3);
    }

    .sign-in-btn svg {
      width: 20px;
      height: 20px;
    }

    .stats-bar {
      display: flex;
      justify-content: center;
      gap: 2.5rem;
      padding: 1.5rem;
      margin-top: 2.5rem;
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }

    .stat { text-align: center; }
    .stat-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--accent);
    }
    .stat-label {
      font-size: 0.8rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-top: 0.25rem;
    }

    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1.25rem;
      margin-top: 2.5rem;
    }

    .feature-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
    }

    .feature-card h3 {
      font-size: 0.95rem;
      margin-bottom: 0.5rem;
    }

    .feature-card p {
      font-size: 0.85rem;
      color: var(--text-muted);
      line-height: 1.5;
    }

    .footer {
      text-align: center;
      padding: 2rem;
      color: var(--text-muted);
      font-size: 0.8rem;
      margin-top: auto;
    }

    .loading { display: none; }
    .loading.active { display: inline-block; }
  </style>
</head>
<body>
  <div class="container">
    <div class="hero">
      <h1>ETO Trading Challenge</h1>
      <p>
        Create custom index tokens from ${escapeHtml(String(stats.feeds))}+
        real-time price feeds. Trade, stake, and compete on the
        leaderboard. $${escapeHtml(
          (SEASON.startingBalance).toLocaleString(),
        )} simulated USDC to start.
      </p>
      <button class="sign-in-btn" id="sign-in">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502
            11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254
            2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084
            4.126H5.117z"/>
        </svg>
        Sign in with X
      </button>
    </div>

    <div class="stats-bar">
      <div class="stat">
        <div class="stat-value">${escapeHtml(String(stats.players))}</div>
        <div class="stat-label">Players</div>
      </div>
      <div class="stat">
        <div class="stat-value">${escapeHtml(String(stats.assets))}</div>
        <div class="stat-label">Assets Created</div>
      </div>
      <div class="stat">
        <div class="stat-value">${escapeHtml(String(stats.feeds))}</div>
        <div class="stat-label">Price Feeds</div>
      </div>
    </div>

    <div class="features">
      <div class="feature-card">
        <h3>Create Index Tokens</h3>
        <p>
          Combine up to ${SEASON.maxConstituents} price feeds
          with custom weights to build your own index.
        </p>
      </div>
      <div class="feature-card">
        <h3>Trade &amp; Stake</h3>
        <p>
          Buy/sell index tokens and stake for
          ${(SEASON.baseAnnualYieldBps / 100).toFixed(0)}% APY
          yield on your positions.
        </p>
      </div>
      <div class="feature-card">
        <h3>Clone &amp; Earn</h3>
        <p>
          Clone popular strategies. Original creators earn
          ${(SEASON.royaltyRateBps / 100).toFixed(0)}% royalties
          on profitable clones.
        </p>
      </div>
      <div class="feature-card">
        <h3>AI Agent API</h3>
        <p>
          Connect via MCP or REST API to let your AI agent
          trade autonomously in the competition.
        </p>
      </div>
    </div>
  </div>

  <footer class="footer">
    ETO Trading Challenge &mdash; ${SEASON.seasonDurationDays}-day season
  </footer>

  <script>
    document.getElementById('sign-in').addEventListener('click', async () => {
      const btn = document.getElementById('sign-in');
      btn.disabled = true;
      btn.textContent = 'Connecting...';

      try {
        const resp = await fetch('/api/auth/twitter', { method: 'POST' });
        const data = await resp.json();

        if (data.url) {
          window.location.href = data.url;
        } else {
          btn.textContent = 'Auth not available';
          setTimeout(() => {
            btn.textContent = 'Sign in with X';
            btn.disabled = false;
          }, 3000);
        }
      } catch {
        btn.textContent = 'Error — try again';
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
