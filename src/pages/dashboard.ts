// ── Dashboard page — post-login player view ──
// Uses only safe DOM methods (createElement, textContent).
// No innerHTML anywhere.

export function dashboardPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Dashboard — ETO Trading Challenge</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0a0a0f;
      --surface: #12121a;
      --border: #1e1e2e;
      --text: #e4e4ef;
      --text-muted: #8888a0;
      --accent: #6366f1;
      --green: #22c55e;
      --red: #ef4444;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
        Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }

    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 2rem;
      border-bottom: 1px solid var(--border);
    }

    .topbar h1 {
      font-size: 1rem;
      font-weight: 600;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .user-info {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .user-info img {
      width: 32px;
      height: 32px;
      border-radius: 50%;
    }

    .user-info span { font-size: 0.9rem; color: var(--text-muted); }

    .logout-btn {
      background: none;
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 0.4rem 0.8rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.8rem;
    }

    .logout-btn:hover { border-color: var(--red); color: var(--red); }

    .container {
      max-width: 960px;
      margin: 0 auto;
      padding: 2rem;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.25rem;
    }

    .card-label {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .card-value {
      font-size: 1.5rem;
      font-weight: 700;
      margin-top: 0.25rem;
    }

    .positive { color: var(--green); }
    .negative { color: var(--red); }

    .section-title {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }

    th {
      text-align: left;
      padding: 0.5rem 0.75rem;
      color: var(--text-muted);
      font-weight: 500;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    td {
      padding: 0.5rem 0.75rem;
      border-top: 1px solid var(--border);
    }

    .empty-state {
      text-align: center;
      padding: 2rem;
      color: var(--text-muted);
    }

    .referral-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.25rem;
      margin-top: 2rem;
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .referral-code {
      font-family: monospace;
      font-size: 1.1rem;
      background: var(--bg);
      padding: 0.5rem 1rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      user-select: all;
    }

    .copy-btn {
      background: var(--accent);
      border: none;
      color: #fff;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
    }

    .loading-overlay {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 60vh;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="topbar">
    <h1>ETO Trading Challenge</h1>
    <div class="user-info" id="user-info" style="display:none">
      <img id="avatar" src="" alt="" />
      <span id="handle"></span>
      <button class="logout-btn" id="logout">Logout</button>
    </div>
  </div>

  <div class="container">
    <div id="loading" class="loading-overlay">Loading...</div>

    <div id="dashboard" style="display:none">
      <div class="grid">
        <div class="card">
          <div class="card-label">Total Value</div>
          <div class="card-value" id="total-value"></div>
        </div>
        <div class="card">
          <div class="card-label">USDC Balance</div>
          <div class="card-value" id="usdc-balance"></div>
        </div>
        <div class="card">
          <div class="card-label">Return</div>
          <div class="card-value" id="return-pct"></div>
        </div>
      </div>

      <h2 class="section-title">Positions</h2>
      <div id="positions-container">
        <div class="empty-state">No positions yet</div>
      </div>

      <h2 class="section-title" style="margin-top:2rem">Stakes</h2>
      <div id="stakes-container">
        <div class="empty-state">No stakes yet</div>
      </div>

      <h2 class="section-title" style="margin-top:2rem">
        Leaderboard
      </h2>
      <div id="leaderboard-container">
        <div class="empty-state">Loading...</div>
      </div>

      <div class="referral-box" id="referral-box" style="display:none">
        <div>
          <div class="card-label">Your Referral Code</div>
          <div class="referral-code" id="referral-code"></div>
        </div>
        <button class="copy-btn" id="copy-referral">Copy</button>
      </div>
    </div>
  </div>

  <script>
    var token = localStorage.getItem('eto_token');

    // Check URL fragment for token from OAuth callback
    var hashStr = window.location.hash;
    if (hashStr.indexOf('#token=') === 0) {
      token = decodeURIComponent(hashStr.slice(7));
      localStorage.setItem('eto_token', token);
      history.replaceState(null, '', '/dashboard');
    }

    if (!token) {
      window.location.href = '/';
    } else {
      init();
    }

    function apiFetch(path) {
      return fetch(path, {
        headers: { 'Authorization': 'Bearer ' + token },
      }).then(function(resp) {
        if (resp.status === 401) {
          localStorage.removeItem('eto_token');
          window.location.href = '/';
          return null;
        }
        return resp.json();
      });
    }

    function formatUsd(n) {
      return '$' + Number(n).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }

    function formatPct(n) {
      var sign = n >= 0 ? '+' : '';
      return sign + n.toFixed(2) + '%';
    }

    function pctClass(n) {
      return n >= 0 ? 'positive' : 'negative';
    }

    // Safe DOM helpers — no innerHTML
    function el(tag, attrs, children) {
      var node = document.createElement(tag);
      if (attrs) {
        for (var k in attrs) {
          if (k === 'className') node.className = attrs[k];
          else if (k === 'style') node.style.cssText = attrs[k];
          else if (k === 'textContent') node.textContent = attrs[k];
          else node.setAttribute(k, attrs[k]);
        }
      }
      if (children) {
        for (var i = 0; i < children.length; i++) {
          node.appendChild(children[i]);
        }
      }
      return node;
    }

    function text(tag, content, cls) {
      var node = document.createElement(tag);
      node.textContent = content;
      if (cls) node.className = cls;
      return node;
    }

    function buildTable(headers, rows) {
      var thead = el('thead', null, [
        el('tr', null, headers.map(function(h) {
          return text('th', h);
        })),
      ]);
      var tbody = document.createElement('tbody');
      for (var i = 0; i < rows.length; i++) {
        tbody.appendChild(rows[i]);
      }
      return el('table', null, [thead, tbody]);
    }

    function replaceContents(containerId, newChild) {
      var container = document.getElementById(containerId);
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
      container.appendChild(newChild);
    }

    function init() {
      Promise.all([
        apiFetch('/api/me'),
        apiFetch('/api/portfolio'),
        apiFetch('/api/leaderboard?limit=20'),
      ]).then(function(results) {
        var me = results[0];
        var portfolio = results[1];
        var leaderboard = results[2];

        if (!me || !portfolio) return;

        // User info bar
        var userInfo = document.getElementById('user-info');
        var avatar = document.getElementById('avatar');
        var handle = document.getElementById('handle');
        userInfo.style.display = 'flex';
        if (me.avatarUrl) {
          avatar.src = me.avatarUrl;
          avatar.alt = me.handle;
        } else {
          avatar.style.display = 'none';
        }
        handle.textContent = '@' + me.handle;

        // Summary cards
        document.getElementById('total-value').textContent =
          formatUsd(portfolio.totalValue);
        document.getElementById('usdc-balance').textContent =
          formatUsd(portfolio.usdcBalance);
        var retEl = document.getElementById('return-pct');
        retEl.textContent = formatPct(portfolio.returnPct);
        retEl.className = 'card-value ' + pctClass(portfolio.returnPct);

        // Positions table (safe DOM)
        if (portfolio.positions && portfolio.positions.length > 0) {
          var posRows = portfolio.positions.map(function(p) {
            return el('tr', null, [
              text('td', p.assetName),
              text('td', Number(p.shares).toFixed(4)),
              text('td', formatUsd(p.currentValue)),
              text('td', formatPct(p.pnlPct), pctClass(p.pnlPct)),
            ]);
          });
          replaceContents('positions-container',
            buildTable(['Asset', 'Shares', 'Value', 'P&L'], posRows));
        }

        // Stakes table (safe DOM)
        if (portfolio.stakes && portfolio.stakes.length > 0) {
          var stakeRows = portfolio.stakes.map(function(s) {
            return el('tr', null, [
              text('td', s.assetName),
              text('td', Number(s.stakedShares).toFixed(4)),
              text('td', formatUsd(s.value)),
              text('td', formatUsd(s.yield), 'positive'),
            ]);
          });
          replaceContents('stakes-container',
            buildTable(
              ['Asset', 'Staked', 'Value', 'Yield'], stakeRows));
        }

        // Leaderboard (safe DOM)
        if (leaderboard && leaderboard.length > 0) {
          var lbRows = leaderboard.map(function(e) {
            var row = el('tr', null, [
              text('td', String(e.rank)),
              text('td', '@' + e.handle),
              text('td', formatPct(e.returnPct),
                pctClass(e.returnPct)),
            ]);
            if (e.handle === me.handle) {
              row.style.color = 'var(--accent)';
            }
            return row;
          });
          replaceContents('leaderboard-container',
            buildTable(['#', 'Player', 'Return'], lbRows));
        }

        // Referral code
        if (me.referralCode) {
          document.getElementById('referral-box').style.display =
            'flex';
          document.getElementById('referral-code').textContent =
            me.referralCode;
        }

        // Show dashboard, hide loading
        document.getElementById('loading').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
      }).catch(function() {
        document.getElementById('loading').textContent =
          'Failed to load dashboard';
      });
    }

    document.getElementById('logout')
      .addEventListener('click', function() {
        localStorage.removeItem('eto_token');
        window.location.href = '/';
      });

    document.getElementById('copy-referral')
      .addEventListener('click', function() {
        var code =
          document.getElementById('referral-code').textContent;
        navigator.clipboard.writeText(code);
        var btn = document.getElementById('copy-referral');
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
      });
  </script>
</body>
</html>`;
}
