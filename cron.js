const fs = require('fs');
const https = require('https');

const TIINGO_TOKEN = process.env.TIINGO_API_KEY || '59ef52629eeae58175e43bc4cc4402344e8a484f';

// Transition probabilities from 16-year backtest
const TRANS_PROBS = {
  1: {1: 0.929, 2: 0.046, 3: 0.003, 4: 0.022},
  2: {1: 0.036, 2: 0.946, 3: 0.012, 4: 0.007},
  3: {1: 0.012, 2: 0.046, 3: 0.922, 4: 0.021},
  4: {1: 0.034, 2: 0.017, 3: 0.015, 4: 0.934}
};

const AVG_DURATIONS = {1: 14, 2: 18, 3: 13, 4: 15};

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function fetchTiingo(ticker, days) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const url = `https://api.tiingo.com/tiingo/daily/${ticker}/prices?startDate=${startDate.toISOString().slice(0,10)}&token=${TIINGO_TOKEN}`;
  
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.detail) {
            reject(new Error(`${ticker} ${res.statusCode} ${parsed.detail}`));
          } else {
            const cleaned = parsed.map(d => ({
              date: d.date.slice(0, 10),
              close: d.close
            }));
            resolve(cleaned);
          }
        } catch (e) {
          reject(new Error(`${ticker} parse error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function calcReturn(data, idx, days) {
  if (idx < days || !data[idx] || !data[idx - days]) return null;
  const current = data[idx].close;
  const past = data[idx - days].close;
  return past !== 0 ? (current - past) / past : null;
}

function getRegime(growth, inflation) {
  if (growth === null || inflation === null) return null;
  if (growth >= 0 && inflation < 0) return 1;
  if (growth >= 0 && inflation >= 0) return 2;
  if (growth < 0 && inflation >= 0) return 3;
  return 4;
}

async function main() {
  log('=== Macro Regime Cron START ===');
  
  try {
    // Fetch market data (270 days to have enough for confirmation + gate)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 270);
    log(`Fetching data from ${startDate.toISOString().slice(0,10)}`);
    
    const [spy, dbc, gld, dba] = await Promise.all([
      fetchTiingo('SPY', 270),
      fetchTiingo('DBC', 270),
      fetchTiingo('GLD', 270),
      fetchTiingo('DBA', 270)
    ]);
    
    log(`SPY: ${spy.length} days`);
    log(`DBC: ${dbc.length} days`);
    log(`GLD: ${gld.length} days`);
    log(`DBA: ${dba.length} days`);
    
    // Build date maps
    const dbcMap = {};
    dbc.forEach((d, i) => dbcMap[d.date] = i);
    const gldMap = {};
    gld.forEach((d, i) => gldMap[d.date] = i);
    const dbaMap = {};
    dba.forEach((d, i) => dbaMap[d.date] = i);
    
    // Calculate regime history with confirmation
    const regimes = spy.map((row, i) => {
      const g20 = calcReturn(spy, i, 20);
      
      const di = dbcMap[row.date] !== undefined ? dbcMap[row.date] : -1;
      const gi = gldMap[row.date] !== undefined ? gldMap[row.date] : -1;
      const ai = dbaMap[row.date] !== undefined ? dbaMap[row.date] : -1;
      
      const d20 = di >= 20 ? calcReturn(dbc, di, 20) : null;
      const a20 = ai >= 20 ? calcReturn(dba, ai, 20) : null;
      const g20g = gi >= 20 ? calcReturn(gld, gi, 20) : null;
      
      const d63 = di >= 63 ? calcReturn(dbc, di, 63) : null;
      const g63 = gi >= 63 ? calcReturn(gld, gi, 63) : null;
      
      // Hybrid: swap DBC->DBA if energy premium >6pp
      const ic20 = (d20 !== null && a20 !== null && (d20 - a20) > 0.06) ? a20 : d20;
      const i20 = (ic20 !== null && g20g !== null) ? (ic20 + g20g) / 2 : null;
      
      const ic63 = (d63 !== null && a20 !== null && (d63 - a20) > 0.06) ? a20 : d63;
      const ig63 = (ic63 !== null && g63 !== null) ? (ic63 + g63) / 2 : null;
      
      return {
        date: row.date,
        growth: g20,
        inflation: i20,
        gate: ig63,
        raw_regime: getRegime(g20, i20),
        confirmed_regime: null
      };
    });
    
    // Apply 3-day confirmation
    for (let i = 2; i < regimes.length; i++) {
      const curr = regimes[i];
      const prev = regimes[i-1];
      
      if (curr.raw_regime === null) {
        curr.confirmed_regime = prev.confirmed_regime;
        continue;
      }
      
      if (prev.confirmed_regime === null) {
        curr.confirmed_regime = curr.raw_regime;
      } else if (curr.raw_regime !== prev.confirmed_regime) {
        // Check if next 2 days confirm
        if (i + 2 < regimes.length &&
            regimes[i+1].raw_regime === curr.raw_regime &&
            regimes[i+2].raw_regime === curr.raw_regime) {
          curr.confirmed_regime = curr.raw_regime;
        } else {
          curr.confirmed_regime = prev.confirmed_regime;
        }
      } else {
        curr.confirmed_regime = curr.raw_regime;
      }
    }
    
    // Apply Q4 gate filter
    for (let i = 1; i < regimes.length; i++) {
      const curr = regimes[i];
      const prev = regimes[i-1];
      
      if (curr.confirmed_regime === 4 && curr.gate !== null && curr.gate > 0) {
        curr.confirmed_regime = prev.confirmed_regime;
      }
    }
    
    // Get latest confirmed regime
    const latest = regimes[regimes.length - 1];
    const prevQ = regimes.length > 1 ? regimes[regimes.length - 2].confirmed_regime : null;
    
    log(`Signals: g=${(latest.growth*100).toFixed(2)}% i=${(latest.inflation*100).toFixed(2)}% ig=${(latest.gate*100).toFixed(2)}% date=${latest.date}`);
    log(`Raw Q${latest.raw_regime} -> Confirmed Q${latest.confirmed_regime} (prev Q${prevQ})`);
    
    // Calculate days in current regime
    let daysActive = 0;
    for (let k = regimes.length - 1; k >= 0; k--) {
      if (regimes[k].confirmed_regime === latest.confirmed_regime) {
        daysActive++;
      } else {
        break;
      }
    }
    
    // Get transition probabilities for current regime
    const transitions = TRANS_PROBS[latest.confirmed_regime] || {};
    
    // Prepare data.json
    const outputData = {
      date: latest.date,
      regime: latest.confirmed_regime,
      signals: {
        growth: latest.growth,
        inflation: latest.inflation,
        gate: latest.gate
      },
      days_active: daysActive,
      avg_duration: AVG_DURATIONS[latest.confirmed_regime],
      transitions: transitions,
      last_updated: new Date().toISOString()
    };
    
    const outputPath = '/var/www/regime-tracker/data.json';
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
    log(`Wrote ${outputPath}`);
    
    // Append to regime history log
    const historyPath = '/var/www/regime-tracker/regime_history.json';
    let history = [];
    
    if (fs.existsSync(historyPath)) {
      try {
        history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      } catch (e) {
        log(`History parse error, starting fresh: ${e.message}`);
        history = [];
      }
    }
    
    // Check if today already exists
    const existingIdx = history.findIndex(h => h.date === latest.date);
    const historyEntry = {
      date: latest.date,
      regime: latest.confirmed_regime,
      growth: Math.round(latest.growth * 10000) / 10000,
      inflation: Math.round(latest.inflation * 10000) / 10000,
      gate: Math.round(latest.gate * 10000) / 10000,
      spy_close: spy[spy.length - 1].close
    };
    
    if (existingIdx >= 0) {
      history[existingIdx] = historyEntry;
      log(`Updated existing entry for ${latest.date}`);
    } else {
      history.push(historyEntry);
      log(`Appended new entry for ${latest.date}`);
    }
    
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
    log(`Wrote ${historyPath} (${history.length} total days)`);
    
    // Check for regime change and send email alerts
    if (prevQ !== null && prevQ !== latest.confirmed_regime) {
      log(`⚠️  REGIME CHANGE: Q${prevQ} → Q${latest.confirmed_regime}`);
      // TODO: Send email via Resend API if configured
      // This is where you'd integrate with Resend
    } else {
      log(`No regime change — Q${latest.confirmed_regime} maintained`);
    }
    
    log('=== Macro Regime Cron DONE ===');
    
  } catch (err) {
    log(`FATAL: data fetch failed — ${err.message}`);
    process.exit(1);
  }
}

main();
