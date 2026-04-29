# Macro Regime Tracker — DigitalOcean Setup Guide
# Run these commands on your droplet via SSH

# ── Step 1: Create the web directory ─────────────────────────────────────────
sudo mkdir -p /var/www/regime-tracker
sudo chown -R $USER:$USER /var/www/regime-tracker

# ── Step 2: Copy files ────────────────────────────────────────────────────────
# Upload index.html, cron.js, subscribe-server.js to /var/www/regime-tracker/
# You can use scp from your local machine:
#   scp index.html cron.js subscribe-server.js root@YOUR_DROPLET_IP:/var/www/regime-tracker/

# Create empty data files
echo "[]" > /var/www/regime-tracker/subscribers.json
echo "{}" > /var/www/regime-tracker/state.json
echo "{}" > /var/www/regime-tracker/data.json

# ── Step 3: Edit cron.js config values ───────────────────────────────────────
# Open cron.js and set your actual values at the top of the file:
#   TIINGO_API_KEY  — your Tiingo API key
#   RESEND_API_KEY  — your Resend API key
#   FROM_EMAIL      — alerts@market-dashboards.com (must be verified in Resend)
nano /var/www/regime-tracker/cron.js

# ── Step 4: Test the cron script manually ────────────────────────────────────
node /var/www/regime-tracker/cron.js
# Should print signal values and write data.json
# Check the output:
cat /var/www/regime-tracker/data.json

# ── Step 5: Install PM2 and start subscribe server ───────────────────────────
sudo npm install -g pm2
pm2 start /var/www/regime-tracker/subscribe-server.js --name regime-subscribe
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot

# ── Step 6: Set up daily cron job ────────────────────────────────────────────
crontab -e
# Add this line (runs at 1am CT = 7am UTC on weekdays):
# 0 7 * * 1-5 /usr/bin/node /var/www/regime-tracker/cron.js >> /var/log/regime-cron.log 2>&1

# Check cron log after first run:
# tail -50 /var/log/regime-cron.log

# ── Step 7: Configure Nginx ───────────────────────────────────────────────────
sudo cp /var/www/regime-tracker/regime-tracker.conf /etc/nginx/sites-available/regime-tracker
sudo ln -s /etc/nginx/sites-available/regime-tracker /etc/nginx/sites-enabled/
sudo nginx -t          # test config — should say "syntax is ok"
sudo systemctl reload nginx

# ── Step 8: Add DNS record ────────────────────────────────────────────────────
# In your DNS provider (DigitalOcean or wherever market-dashboards.com is managed):
# Add an A record:
#   Type:  A
#   Name:  regime-tracker
#   Value: YOUR_DROPLET_IP
#   TTL:   3600

# ── Step 9: SSL certificate ──────────────────────────────────────────────────
# Wait for DNS to propagate (5-15 minutes), then:
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d regime-tracker.market-dashboards.com
# Follow the prompts — certbot auto-configures Nginx for HTTPS

# ── Step 10: Verify everything ────────────────────────────────────────────────
# 1. Dashboard: https://regime-tracker.market-dashboards.com
# 2. Data file: https://regime-tracker.market-dashboards.com/data.json
# 3. Subscribe: https://regime-tracker.market-dashboards.com/api/subscribe
# 4. Cron log:  tail -f /var/log/regime-cron.log

# ── Useful maintenance commands ───────────────────────────────────────────────
# Manually trigger data refresh:
#   node /var/www/regime-tracker/cron.js
#
# View subscribe server status:
#   pm2 status
#   pm2 logs regime-subscribe
#
# Restart subscribe server:
#   pm2 restart regime-subscribe
#
# View subscribers:
#   cat /var/www/regime-tracker/subscribers.json
#
# View current regime state:
#   cat /var/www/regime-tracker/state.json
