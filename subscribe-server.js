#!/usr/bin/env node
// subscribe-server.js — tiny HTTP server for email subscription
// Runs on port 3001. Nginx proxies /api/subscribe to this.
// Start: node subscribe-server.js
// Production: use PM2 — pm2 start subscribe-server.js --name regime-subscribe

var http  = require('http');
var fs    = require('fs');
var path  = require('path');

var SUBS_FILE = '/var/www/regime-tracker/subscribers.json';
var PORT      = 3001;

function readSubs() {
  try { return JSON.parse(fs.readFileSync(SUBS_FILE,'utf8')); }
  catch(e) { return []; }
}
function writeSubs(subs) {
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2), 'utf8');
}
function isValidEmail(e) {
  return typeof e === 'string' && e.length >= 6 && e.indexOf('@') > 0 && e.indexOf('.') > e.indexOf('@');
}

var server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if(req.method === 'OPTIONS'){ res.writeHead(200); res.end(); return; }

  if(req.method === 'GET'){
    var subs = readSubs();
    res.writeHead(200);
    res.end(JSON.stringify({ok:true, subscriberCount:subs.length, message:'Subscribe server running'}));
    return;
  }

  if(req.method === 'POST'){
    var body = '';
    req.on('data', function(chunk){ body += chunk; });
    req.on('end', function(){
      var data;
      try { data = JSON.parse(body); } catch(e){ res.writeHead(400); res.end(JSON.stringify({ok:false,error:'Bad JSON'})); return; }
      var email = ((data.email || '').trim()).toLowerCase();
      if(!isValidEmail(email)){ res.writeHead(400); res.end(JSON.stringify({ok:false,error:'Invalid email'})); return; }
      var subs = readSubs();
      if(subs.indexOf(email) >= 0){
        res.writeHead(200); res.end(JSON.stringify({ok:true,email:email,added:false,message:'Already subscribed'}));
      } else {
        subs.push(email);
        writeSubs(subs);
        res.writeHead(200); res.end(JSON.stringify({ok:true,email:email,added:true,message:'Subscribed successfully'}));
      }
    });
    return;
  }

  if(req.method === 'DELETE'){
    var body2 = '';
    req.on('data', function(chunk){ body2 += chunk; });
    req.on('end', function(){
      var data2;
      try { data2 = JSON.parse(body2); } catch(e){ res.writeHead(400); res.end(JSON.stringify({ok:false,error:'Bad JSON'})); return; }
      var email2 = ((data2.email || '').trim()).toLowerCase();
      var subs2 = readSubs().filter(function(e){ return e !== email2; });
      writeSubs(subs2);
      res.writeHead(200); res.end(JSON.stringify({ok:true,email:email2,message:'Unsubscribed'}));
    });
    return;
  }

  res.writeHead(405); res.end(JSON.stringify({ok:false,error:'Method not allowed'}));
});
