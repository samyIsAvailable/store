# My Algerian Store — Local Setup

This repo serves the storefront (`index.html`) and the admin panel (`admin.html`) from a single local Express server and exposes a simple JSON API for orders.

## Requirements
- Node.js 18+ (includes npm). Download from https://nodejs.org

## Install & Run (PowerShell)
```powershell
Push-Location "c:\Users\hp\Desktop\work\programs\my-algerian-store"
npm install
npm start
```
Server runs at `http://localhost:3000`.

## API
- `GET /api/orders` → list all orders
- `POST /api/orders` → create order (accepts minimal payload from `index.html`)
- `PATCH /api/orders/:id` → update status (`pending|processing|shipped|delivered|cancelled`)
- `DELETE /api/orders/:id` → delete order

Data persists to `data/orders.json`.

## Try It
1. Open `http://localhost:3000/index.html`
2. Fill the form and click "Commander" (opens preview and sends order)
3. Open `http://localhost:3000/admin.html` and click "Refresh" (or enable Auto-refresh)

## Notes
- Admin panel expects same-origin `/api`; the server serves both static files and API.
- Wilaya parsing stores the city portion after `NN - City` in the `address.city` field.
- Base price and shipping are mirrored to compute `total` on the server too.

## Deploy to VPS (Ubuntu) with Nginx + HTTPS
1. Point DNS `A` records for `boutiquedz.tech` and `www.boutiquedz.tech` to your server IP.
2. Copy this repo to the server and start with PM2:
```bash
cd ~/my-algerian-store
npm install
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```
3. Install Nginx + Certbot and use config in `nginx.my-store.conf`:
```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp ~/my-algerian-store/nginx.my-store.conf /etc/nginx/sites-available/my-store
sudo ln -s /etc/nginx/sites-available/my-store /etc/nginx/sites-enabled/my-store
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d boutiquedz.tech -d www.boutiquedz.tech
```
This config:
- Blocks `/data/` from public access
- Adds security headers (CSP, frame/permissions/referrer policies)
- Proxies to Node on `127.0.0.1:3000`
- Enables gzip

4. Update admin password securely:
```bash
pm2 set pm2:my-store:ADMIN_PASSWORD "StrongPass123"
pm2 restart my-store
```
Or edit `ecosystem.config.js` on the server and `pm2 restart my-store`.

5. Verify
- `https://boutiquedz.tech/index.html` (order)
- `https://boutiquedz.tech/thank-you.html` (summary)
- `https://boutiquedz.tech/admin.html` (login required)
