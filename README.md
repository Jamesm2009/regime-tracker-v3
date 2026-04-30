# Macro Regime Tracker

> **Live dashboard:** [regime-tracker.market-dashboards.com](https://regime-tracker.market-dashboards.com)

A fully automated macro regime classification dashboard that identifies the current market environment, surfaces historically outperforming ETF baskets, and delivers email alerts on confirmed regime changes.

---

## What It Does

The Macro Regime Tracker classifies the current market into one of four quadrants based on rolling momentum signals from SPY, commodity prices, and gold. It then surfaces the ETF categories that have historically outperformed in each regime over 15 years of data, and sends email alerts when a confirmed regime change is detected.

---

## The Four Regimes

| Quadrant | Condition | Favoured Assets |
|---|---|---|
| **Q1 Goldilocks** | Growth ↑ Inflation ↓ | Tech, Growth equities |
| **Q2 Overheating** | Growth ↑ Inflation ↑ | Commodities, Cyclicals |
| **Q3 Stagflation** | Growth ↓ Inflation ↑ | Gold, Energy, Short bonds |
| **Q4 Deflation** | Growth ↓ Inflation ↓ | Defensives, Mid bonds |

---

## How the Model Works

### Signals (calculated daily)
- **Growth proxy** — SPY rolling 20-day return
- **Inflation proxy** — DBC + GLD rolling 20-day average (hybrid: swaps DBC→DBA if energy premium >6pp to filter geopolitical supply shocks)
- **Inflation gate** — DBC + GLD rolling 63-day return (used only to filter false Q4 signals)

### Filters
- **3-day confirmation filter** — a regime change only fires if the same quadrant holds for 3 consecutive days. Reduces false signals from 38% to 13%.
- **Q4 inflation gate** — Q4 only activates when the 63-day commodity momentum is negative (CPI truly rolling over). Lifts Q4 hit rate from 32% to 50%.

---

## Backtest Results (15 Years · Jan 2010–Apr 2026)

| Quadrant | Hit Rate | Top-10 Hit | False Signal | Avg Fwd 20d |
|---|---|---|---|---|
| Q1 Goldilocks | 62% | 55% | 13% | +1.03% |
| Q2 Overheating | 55% | 80% | 11% | +1.46% |
| Q3 Stagflation | 51% | 63% | 20% | +0.36% |
| Q4 Deflation (filtered) | 50% | 55% | 17% | +0.43% |

**Dataset:** 68 ETFs · 4,082 trading days · 263 confirmed regime changes · Hybrid DBC/DBA inflation proxy tested against 4 alternatives.

> **Note:** A 55–62% hit rate means roughly 4 out of 10 signals will be wrong. This is a directional signal tool, not a trade recommendation system. Size positions accordingly.

---

## ETF Baskets

| Quadrant | Long | Short |
|---|---|---|
| Q1 | QQQ, IWF, MGK, SMH, XLK, XLY, XHB, IWM | XLE, EEM, TLT, EWU |
| Q2 | XLE, XLB, SLV, DBC, GLD, XLI, SMH, XHB | TLT, HYG, FXY, FXE |
| Q3 | GLD, SLV, USO, XLE, SHY, XLK | TLT, IEF, EMB, FXY |
| Q4 | XLU, XLP, XLV, IEF, IEI, SHY | USO, DBC, VNM, XLE |

**Crypto (IBIT):** Opportunistic satellite in Q1 (+7.2% avg, std 12.5%) and Q3 (+6.4% avg). Avoid in Q2 and Q4.

---

## Dashboard Features

### Live Regime Tab
- Regime card with quadrant colour, days active, backtest hit rate, avg forward return
- 3-day confirmation status, inflation gate level, Q4 filter status
- Three signal gauges (Growth / Inflation / Gate)
- Long ETF tiles with live 20-day and 5-day market returns
- Short candidate tiles with live 20-day returns
- Crypto note per quadrant
- Last 5 days track record
- Email alert subscription

### History Tab
- SPY price chart with colour-coded quadrant background bands
- 3M / 6M / 1Y range toggle
- Signal strength chart (Growth / Inflation / Gate) with zero reference line

### Backtest Stats Tab
- Per-quadrant stat cards (highlights current regime)
- Configuration comparison bar chart (5yr raw → 15yr hybrid)

### How It Works Tab
- Signal calculation methodology
- Quadrant assignment and filter explanations
- Style factor framework per quadrant

### How To Use Tab
- Plain-language guide for interpreting regime signals
- Realistic expectation-setting
- Step-by-step guidance on what to do when a regime change fires

---

## Technical Stack

| Component | Technology |
|---|---|
| Hosting | DigitalOcean Droplet (Ubuntu) |
| Web server | Nginx with SSL (Let's Encrypt) |
| Data source | Tiingo API (nightly fetch) |
| Cron job | Node.js (`cron.js`) via crontab — runs 1am CT weekdays |
| Process manager | PM2 (`subscribe-server.js`) |
| Email alerts | Resend API |
| Subscriptions | Flat file (`subscribers.json`) |
| Frontend | Vanilla JS, Chart.js 4.4.1, IBM Plex fonts |
| Live ETF data | Yahoo Finance via corsproxy.io (client-side) |

---

## File Structure

```
/
├── index.html              # Dashboard (single file, no build step)
├── cron.js                 # Nightly data refresh — Tiingo fetch + signal calc
├── subscribe-server.js     # Email subscription API (port 3001, managed by PM2)
├── regime-tracker.conf     # Nginx config
├── SETUP.md                # Full deployment guide
├── data.json               # Written by cron nightly — read by dashboard on load
├── subscribers.json        # Email subscriber list
├── state.json              # Previous regime state for change detection
└── api/                    # Legacy Vercel serverless functions (not used on DO)
```

---

## How Data Flows

```
Tiingo API
    ↓  (nightly at 1am CT via cron.js)
data.json  ←──────────────────────────────────────────┐
    ↓  (read on page load)                             │
Dashboard renders instantly from cache                 │
    ↓  (then fetches live ETF returns from Yahoo)      │
ETF tiles update with live 20d / 5d returns            │
                                                       │
On confirmed regime change:                            │
  cron.js → Resend API → email to subscribers ─────────┘
```

---

## Deployment

See [SETUP.md](./SETUP.md) for the full step-by-step deployment guide.

**Quick summary:**
1. Clone repo to `/var/www/regime-tracker` on your droplet
2. Add Tiingo and Resend API keys to `cron.js`
3. Run `node cron.js` once to populate `data.json`
4. Start subscribe server with PM2
5. Configure Nginx and SSL with certbot
6. Add cron job: `0 7 * * 1-5 /usr/bin/node /var/www/regime-tracker/cron.js`

---

## Disclaimer

This dashboard is for **informational and educational purposes only** and does not constitute investment advice, a recommendation to buy or sell any security, or an offer to provide investment advisory services. Past regime accuracy does not guarantee future results. All backtested results are hypothetical and do not reflect actual trading or the impact of transaction costs, taxes, or fees. **Conduct your own research and consult a qualified financial advisor before making any investment decisions.**
