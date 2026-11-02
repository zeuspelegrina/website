# Volume Society Macro Space

A transparent, cool-black macro cockpit for US rates, the curve, real yields,
financial conditions, volatility, liquidity and the week's economic calendar.

It is a small standalone web app: one Python file serves the UI and proxies two
free public data feeds so the browser never has to deal with CORS.

> Original design and code. Not affiliated with, endorsed by, or copied from
> DataFirst Trading or any other commercial terminal.

## Quick start

```bash
cd flowtradez-macro-space
python3 server.py
```

Then open **http://127.0.0.1:8787**.

On macOS you can also double-click **`run.command`**, which starts the server if
it is not already running and opens the dashboard.

Requirements: Python 3.9+ and `curl`. No npm, Node, or API key needed. An
optional `GEMINI_API_KEY` enables the Gemini macro agent; without it the agent
runs a local fallback.

## Deploying on Netlify

The site deploys to Netlify as-is. The static files are served from the
repo root, and `netlify/functions/api.mjs` provides the same `/api/*`
endpoints as `server.py` as a Netlify Function. On Netlify the macro agent
uses Gemini through Netlify AI Gateway, so it needs no API key. FRED and
calendar responses are cached at the CDN (10 and 30 minutes).

## What is on the dashboard

| Section | What it shows |
| --- | --- |
| Regime engine | A 5-signal risk posture score: 3m10y curve, NFCI, VIX, HY OAS, S&P 500 vs its 200-day average |
| Key metrics | 10Y, 2Y, 2s10s, 10Y real, 10Y breakeven, NFCI, VIX, HY OAS with 1M change and 90-day sparkline |
| Treasury curve | Par yields from 1M to 30Y, with optional 1M-ago / 1Y-ago overlay |
| Yield board | 1D / 1W / 1M / 1Y changes in basis points for ten tenors |
| Real rates | 10Y nominal vs TIPS real vs breakeven, plus 5y5y forward |
| NFCI | 3-year path and the leverage / credit / risk subcomponents |
| Volatility | VIX level, 1-year percentile, range and HY OAS percentile |
| Policy & liquidity | EFFR, SOFR, IORB, target range, Fed balance sheet and reverse repo |
| Macro sentiment | Auto-generated macro brief plus Bullish / Neutral / Bearish scores for Nasdaq and BTC across intraday, daily and long-term horizons |
| Economic calendar | This week's releases, US-only or global, with a next-event countdown |

### Macro sentiment model

The sentiment panel is a transparent, rule-based read — not an AI news feed and
not investment advice. It turns the live macro data into a short brief and a
bias for each asset/horizon:

- **Score:** weighted average of normalized inputs, mapped to a −5 to +5 scale.
  Hover any pill to see its exact score. Labels are `BULLISH`, `LEAN BULLISH`,
  `NEUTRAL`, `LEAN BEARISH`, `BEARISH`.
- **Horizons:** *Intraday* weights volatility, credit and liquidity. *Daily*
  adds trend, real yields and conditions. *Long-term* emphasises real yields,
  the curve, liquidity and policy direction.
- **Asset lens:** Nasdaq weights real yields and duration sensitivity; BTC
  weights liquidity (Fed balance sheet, RRP), NFCI and risk beta more heavily.
- **Brief:** one auto-written sentence combining the dominant rate, credit,
  conditions and volatility signals, followed by a net verdict. It rewrites on
  every refresh as the inputs change.

## Data sources

- **FRED — Federal Reserve Bank of St. Louis** (`fred.stlouisfed.org`)
  - Nominal curve: `DGS1MO` … `DGS30`
  - Curve spreads: `T10Y2Y`, `T10Y3M`, `T5YIFR`
  - Real yields / inflation: `DFII5`, `DFII10`, `DFII30`, `T5YIE`, `T10YIE`
  - Policy / money market: `DFF`, `EFFR`, `SOFR`, `IORB`, `DFEDTARU`, `DFEDTARL`
  - Conditions / credit: `NFCI`, `NFCILEVERAGE`, `NFCICREDIT`, `NFCIRISK`, `BAMLH0A0HYM2`, `BAMLC0A0CM`
  - Risk: `VIXCLS`, `SP500`
  - Macro backdrop / liquidity: `CPIAUCSL`, `CPILFESL`, `PCEPILFE`, `UNRATE`, `PAYEMS`, `GDPC1`, `WALCL`, `RRPONTSYD`, `MORTGAGE30US`, `DTWEXBGS`, `DCOILWTICO`

  The server uses FRED's public CSV endpoint, which does not require an API key
  for these series. Series are fetched individually in parallel and merged into
  a single JSON payload.

- **ForexFactory weekly calendar** (`nfs.faireconomy.media/ff_calendar_thisweek.json`)
  for scheduled releases, forecasts, previous values and impact levels.

### Data providers & coverage

The dashboard reports its live data stack via `GET /api/providers`.

| Provider | Role | Status |
| --- | --- | --- |
| FRED — Federal Reserve Bank of St. Louis | Macro · rates · credit | `LIVE` |
| ForexFactory | Economic calendar | `LIVE` |
| Tradier | Real-time SIP quotes · options chains · Greeks · IV | `KEY REQUIRED` |
| Tiingo & IEX | Supplementary market data feeds | `KEY REQUIRED` |
| SEC EDGAR | Fundamentals · filings · financials · 13F | `FREE API` |
| Finviz & FinanceDatabase | Screening · ETF indexing | `ATTRIBUTION` |

Statuses are derived from the environment: `TRADIER_TOKEN` / `TIINGO_TOKEN` /
`IEX_TOKEN` unlock the key-gated vendors, `SEC_USER_AGENT` tunes SEC EDGAR, and
`FINVIZ_API_KEY` (FinanceDatabase is an optional Python package) gates Finviz-style
screening.

### AI macro agent (Gemini)

A small floating **Gemini · Macro Agent** bubble lives bottom-right on the
dashboard.

```bash
export GEMINI_API_KEY="your-key"        # optional — enables the live Gemini agent
export GEMINI_MODEL="gemini-2.5-flash" # optional — defaults to gemini-2.5-flash
python3 server.py
```

- Without a key the agent answers from a local, rule-based fallback and shows
  `LOCAL MODE`.
- With a key it calls the Gemini `generateContent` API server-side. The browser
  sends only the question plus a trimmed macro snapshot — never the key.
- API: `POST /api/agent` with `{ "message": "...", "context": {...} }`.

### Caching

`server.py` caches raw responses in `cache/`:

- FRED series: 10 minutes
- Calendar feed: 30 minutes

Delete the `cache/` folder to force a clean fetch.

## Files

```
flowtradez-macro-space/
├── server.py          # static server + FRED/calendar/providers/agent proxy + cache
├── index.html         # dashboard markup
├── run.command        # macOS launcher
├── assets/
│   ├── styles.css     # transparent cool-black glass theme, responsive layout
│   └── app.js         # data loading, regime model, SVG charts, interactions
└── data/
    └── calendar.json  # fallback calendar payload ({"ok": false, "events": []})
```

## API (local)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Liveness and server time |
| `GET /api/macro?series=DGS10,DGS2&years=6` | Whitelisted FRED series, merged JSON |
| `GET /api/calendar` | Normalized weekly economic calendar |
| `GET /api/providers` | Live status of the data stack |
| `POST /api/agent` | Gemini macro agent — question + trimmed context |

Only series in `ALLOWED_SERIES` can be requested, so the proxy cannot be used as
an open fetch service.

## Notes and troubleshooting

- **Data is delayed / historical.** FRED series update on their own schedules
  (daily, weekly, quarterly); some observations lag by a few days. This is a
  context tool, not a real-time tick feed.
- **HTTP/2 errors from FRED.** The proxy deliberately uses
  `curl --http1.1`. If requests still fail, check your network or delete
  `cache/` and retry.
- **Different port:** `python3 server.py --port 9000`.
- **LAN access:** `python3 server.py --host 0.0.0.0` (only do this on a network
  you trust).
- **Calendar unavailable:** macro panels keep working; the calendar panel shows
  an explicit empty state instead of stale events.

## Disclaimer

For information and research only. Not investment advice, a recommendation, or
an offer to buy or sell any instrument. Verify all data against the primary
source before using it for decisions.
