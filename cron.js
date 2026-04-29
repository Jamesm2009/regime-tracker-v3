#!/usr/bin/env node
// cron.js — Macro Regime Tracker nightly data refresh
// Run via crontab: 0 1 * * 1-5 /usr/bin/node /var/www/regime-tracker/cron.js >> /var/log/regime-cron.log 2>&1
//
// Config — edit these values:
var TIINGO_API_KEY   = '59ef52629eeae58175e43bc4cc4402344e8a484f';
var RESEND_API_KEY   = 're_NQdu5rNw_7CneNf51Rbs5hPdDAH9tcZz5';
var FROM_EMAIL       = 'alerts@market-dashboards.com';
var DATA_FILE        = '/var/www/regime-tracker/data.json';
var SUBS_FILE        = '/var/www/regime-tracker/subscribers.json';
var STATE_FILE       = '/var/www/regime-tracker/state.json';

var https   = require('https');
var fs      = require('fs');
var path    = require('path');

var log = function(msg){ console.log('['+new Date().toISOString()+'] '+msg); };

// ── Tiingo fetch ──────────────────────────────────────────────────────────────
function fetchTiingo(ticker, startDate) {
  return new Promise(function(resolve, reject) {
    var url = 'https://api.tiingo.com/tiingo/daily/'+ticker+'/prices'
            + '?startDate='+startDate+'&token='+TIINGO_API_KEY;
    var opts = {
      hostname: 'api.tiingo.com',
      path: '/tiingo/daily/'+ticker+'/prices?startDate='+startDate+'&token='+TIINGO_API_KEY,
      headers: { 'Content-Type': 'application/json' }
    };
    var req = https.get(opts, function(res) {
      var data = '';
      res.on('data', function(chunk){ data += chunk; });
      res.on('end', function(){
        if(res.statusCode !== 200){
          return reject(new Error(ticker+' HTTP '+res.statusCode));
        }
        try {
          var json = JSON.parse(data);
          // Tiingo returns array of {date, close, ...}
          var result = json.map(function(row){
            return {
              d: row.date.slice(0,10),
              c: row.adjClose || row.close
            };
          }).filter(function(x){ return x.c != null; });
          resolve(result);
        } catch(e){ reject(new Error(ticker+' parse error: '+e.message)); }
      });
    });
    req.on('error', function(e){ reject(e); });
    req.end();
  });
}

// ── Signal calculation (matches index.html logic exactly) ────────────────────
function retVal(arr, i, k) {
  if(i < k || !arr[i] || !arr[i-k] || !arr[i-k].c) return null;
  return (arr[i].c - arr[i-k].c) / arr[i-k].c;
}

function calcSignals(spy, dbc, gld, dba) {
  var n = spy.length;
  if(n < 64) return null;

  var dbcMap={}, gldMap={}, dbaMap={};
  dbc.forEach(function(x,i){ dbcMap[x.d]=i; });
  gld.forEach(function(x,i){ gldMap[x.d]=i; });
  dba.forEach(function(x,i){ dbaMap[x.d]=i; });

  var latest = spy[n-1];
  var g20    = retVal(spy, n-1, 20);
  var di     = dbcMap[latest.d] !== undefined ? dbcMap[latest.d] : -1;
  var gi     = gldMap[latest.d] !== undefined ? gldMap[latest.d] : -1;
  var ai     = dbaMap[latest.d] !== undefined ? dbaMap[latest.d] : -1;

  var d20    = di >= 20 ? retVal(dbc, di, 20) : null;
  var a20    = ai >= 20 ? retVal(dba, ai, 20) : null;
  var g20g   = gi >= 20 ? retVal(gld, gi, 20) : null;
  var d63    = di >= 63 ? retVal(dbc, di, 63) : null;
  var a63    = ai >= 63 ? retVal(dba, ai, 63) : null;
  var g63    = gi >= 63 ? retVal(gld, gi, 63) : null;

  var ep       = (d20 != null && a20 != null) ? d20 - a20 : null;
  var usingDBA = ep != null && ep > 0.06;
  var ic20     = usingDBA ? a20 : d20;
  var ic63     = (d63 != null && a63 != null && (d63-a63) > 0.06) ? a63 : d63;
  var i20      = (ic20 != null && g20g != null) ? (ic20 + g20g) / 2 : null;
  var ig63     = (ic63 != null && g63  != null) ? (ic63 + g63)  / 2 : null;

  return {
    date:          latest.d,
    spyClose:      latest.c,
    g:             g20,
    i:             i20,
    ig:            ig63,
    energyPremium: ep,
    usingDBA:      usingDBA
  };
}

function rawQ(g, i) {
  if(g == null || i == null) return null;
  if(g >= 0 && i < 0) return 1;
  if(g >= 0 && i >= 0) return 2;
  if(g < 0 && i >= 0) return 3;
  return 4;
}

// ── Email ─────────────────────────────────────────────────────────────────────
var QNAMES  = {1:'Goldilocks',2:'Overheating',3:'Stagflation',4:'Deflation'};
var QARROWS = {1:'Growth \u2191  Inflation \u2193',2:'Growth \u2191  Inflation \u2191',3:'Growth \u2193  Inflation \u2191',4:'Growth \u2193  Inflation \u2193'};
var RECS    = {1:['QQQ','IWF','MGK','SMH','XLK','XLY','XHB','IWM'],2:['XLE','XLB','SLV','DBC','GLD','XLI','SMH','XHB'],3:['GLD','SLV','USO','XLE','SHY','XLK'],4:['XLU','XLP','XLV','IEF','IEI','SHY']};
var SHORTS  = {1:['XLE','EEM','TLT','EWU'],2:['TLT','HYG','FXY','FXE'],3:['TLT','IEF','EMB','FXY'],4:['USO','DBC','VNM','XLE']};
var QCOL    = {1:'#00c896',2:'#f59e0b',3:'#ef4444',4:'#60a5fa'};

function pct(v){ return v == null ? '-' : (v >= 0 ? '+' : '') + (v*100).toFixed(2)+'%'; }

function buildEmailHtml(prevQ, newQ, sig) {
  var col = QCOL[newQ];
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
    + '<body style="margin:0;padding:0;background:#0f1923;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + '<div style="max-width:560px;margin:0 auto;padding:32px 24px;">'
    + '<p style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#5a7080;">MACRO REGIME TRACKER</p>'
    + '<div style="border:1.5px solid '+col+';border-radius:10px;padding:24px;margin:16px 0;background:rgba(15,25,35,.8);">'
    + '<p style="font-size:11px;color:#5a7080;margin:0 0 6px;font-weight:700;letter-spacing:.1em;">⚡ CONFIRMED REGIME CHANGE</p>'
    + '<p style="font-size:12px;color:#8fa3b8;margin:0 0 8px;">Q'+prevQ+' '+QNAMES[prevQ]+' → Q'+newQ+' '+QNAMES[newQ]+'</p>'
    + '<p style="font-size:34px;font-weight:700;color:'+col+';margin:0 0 4px;line-height:1;">Q'+newQ+' '+QNAMES[newQ]+'</p>'
    + '<p style="font-size:14px;color:#8fa3b8;margin:0;">'+QARROWS[newQ]+'</p>'
    + '</div>'
    + '<div style="background:#162030;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:20px;margin-bottom:14px;">'
    + '<p style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#5a7080;margin:0 0 12px;">SIGNALS — '+sig.date+'</p>'
    + '<table style="border-collapse:collapse;"><tr>'
    + '<td style="padding-right:28px;"><p style="font-size:10px;color:#5a7080;margin:0 0 4px;">Growth (SPY 20d)</p><p style="font-family:monospace;font-size:22px;font-weight:600;color:'+(sig.g>=0?'#00c896':'#ef4444')+';margin:0;">'+pct(sig.g)+'</p></td>'
    + '<td style="padding-right:28px;"><p style="font-size:10px;color:#5a7080;margin:0 0 4px;">Inflation (20d)</p><p style="font-family:monospace;font-size:22px;font-weight:600;color:'+(sig.i>=0?'#f59e0b':'#60a5fa')+';margin:0;">'+pct(sig.i)+'</p></td>'
    + '<td><p style="font-size:10px;color:#5a7080;margin:0 0 4px;">Gate (63d)</p><p style="font-family:monospace;font-size:22px;font-weight:600;color:'+(sig.ig>=0?'#f59e0b':'#00c896')+';margin:0;">'+pct(sig.ig)+'</p></td>'
    + '</tr></table>'
    + (sig.usingDBA ? '<p style="font-size:11px;color:#5a7080;font-family:monospace;margin:12px 0 0;">⚠ DBA active — energy premium '+pct(sig.energyPremium)+'</p>' : '')
    + '</div>'
    + '<div style="background:#162030;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:20px;margin-bottom:14px;">'
    + '<p style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#5a7080;margin:0 0 8px;">LONG ETFs</p>'
    + '<p style="font-family:monospace;font-size:14px;color:'+col+';margin:0 0 14px;">'+RECS[newQ].join(' · ')+'</p>'
    + '<p style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#5a7080;margin:0 0 8px;">SHORT CANDIDATES</p>'
    + '<p style="font-family:monospace;font-size:14px;color:#ef4444;margin:0;">'+SHORTS[newQ].join(' · ')+'</p>'
    + '</div>'
    + '<p style="font-size:11px;color:#3a5060;line-height:1.8;border-top:1px solid rgba(255,255,255,.06);padding-top:16px;">'
    + '<strong style="color:#5a7080;">⚠ NOT INVESTMENT ADVICE.</strong> For informational purposes only. '
    + 'Past performance does not guarantee future results. Consult a qualified financial advisor.</p>'
    + '</div></body></html>';
}

function sendEmail(subscribers, prevQ, newQ, sig) {
  return new Promise(function(resolve, reject) {
    if(!subscribers.length || !RESEND_API_KEY || RESEND_API_KEY === 'YOUR_RESEND_API_KEY_HERE') {
      log('Email skipped — no subscribers or no API key');
      return resolve(0);
    }
    var html    = buildEmailHtml(prevQ, newQ, sig);
    var subject = 'Regime Change: Q'+prevQ+' to Q'+newQ+' '+QNAMES[newQ]+' ['+sig.date+']';
    var body    = JSON.stringify({
      from:    FROM_EMAIL,
      to:      subscribers,
      subject: subject,
      html:    html
    });
    var opts = {
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers: {
        'Authorization': 'Bearer '+RESEND_API_KEY,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    var req = https.request(opts, function(res) {
      var data = '';
      res.on('data', function(c){ data += c; });
      res.on('end', function(){
        if(res.statusCode === 200 || res.statusCode === 201){
          log('Emails sent: '+subscribers.length);
          resolve(subscribers.length);
        } else {
          reject(new Error('Resend '+res.statusCode+': '+data));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Read/write helpers ────────────────────────────────────────────────────────
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file,'utf8')); }
  catch(e) { return fallback; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log('=== Macro Regime Cron START ===');

  // Date 300 days ago for Tiingo start
  var startDate = new Date();
  startDate.setDate(startDate.getDate()-300);
  var start = startDate.toISOString().slice(0,10);
  log('Fetching data from '+start);

  var spy, dbc, gld, dba;
  try {
    spy = await fetchTiingo('SPY', start);
    log('SPY: '+spy.length+' days');
    dbc = await fetchTiingo('DBC', start);
    log('DBC: '+dbc.length+' days');
    gld = await fetchTiingo('GLD', start);
    log('GLD: '+gld.length+' days');
    try {
      dba = await fetchTiingo('DBA', start);
      log('DBA: '+dba.length+' days');
    } catch(e) {
      log('DBA fetch failed ('+e.message+') — using empty array');
      dba = [];
    }
  } catch(e) {
    log('FATAL: data fetch failed — '+e.message);
    process.exit(1);
  }

  var sig = calcSignals(spy, dbc, gld, dba);
  if(!sig){ log('FATAL: not enough history'); process.exit(1); }
  log('Signals: g='+pct(sig.g)+' i='+pct(sig.i)+' ig='+pct(sig.ig)+' date='+sig.date);

  // Load previous state
  var state    = readJson(STATE_FILE, {q:null, history:[]});
  var prevQ    = state.q;
  var prevHist = state.history || [];

  // Today's entry
  var rq = rawQ(sig.g, sig.i);
  // Q4 gate
  var gatedQ = (rq === 4 && sig.ig != null && sig.ig > 0) ? (prevQ || 3) : rq;
  var todayEntry = {date:sig.date, spyClose:sig.spyClose, rawQ:gatedQ, g:sig.g, i:sig.i, ig:sig.ig};
  var history = prevHist.slice(-4).concat([todayEntry]);

  // 3-day confirmation
  var confirmedQ = prevQ || 2;
  if(history.length >= 3){
    var last3 = history.slice(-3);
    if(last3.every(function(h){ return h.rawQ === last3[0].rawQ; })){
      confirmedQ = last3[0].rawQ;
    }
  }
  log('Raw Q'+gatedQ+' -> Confirmed Q'+confirmedQ+' (prev Q'+prevQ+')');

  // Write data.json (read by dashboard on load)
  var output = {
    q:             confirmedQ,
    rawQ:          gatedQ,
    date:          sig.date,
    spyClose:      sig.spyClose,
    g:             sig.g,
    i:             sig.i,
    ig:            sig.ig,
    energyPremium: sig.energyPremium,
    usingDBA:      sig.usingDBA,
    history:       history,
    updatedAt:     new Date().toISOString()
  };
  writeJson(DATA_FILE, output);
  log('Wrote '+DATA_FILE);

  // Update state
  writeJson(STATE_FILE, {q:confirmedQ, history:history, updatedAt:output.updatedAt});

  // Email on confirmed regime change
  if(prevQ !== null && confirmedQ !== prevQ){
    log('REGIME CHANGE: Q'+prevQ+' -> Q'+confirmedQ);
    var subs = readJson(SUBS_FILE, []);
    log('Subscribers: '+subs.length);
    try { await sendEmail(subs, prevQ, confirmedQ, sig); }
    catch(e){ log('Email error: '+e.message); }
  } else {
    log('No regime change — Q'+confirmedQ+' maintained');
  }

  log('=== Macro Regime Cron DONE ===');
}

main().catch(function(e){
  log('Uncaught error: '+e.message);
  process.exit(1);
});
