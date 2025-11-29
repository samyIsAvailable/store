const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'orders.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const validTokens = new Set();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_POSTS = 100; // max POST /api/orders per IP per window
const rateStore = new Map(); // ip -> { windowStart, count }

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Do NOT serve the whole project directory; expose only needed static paths
app.use('/images', express.static(path.join(__dirname, 'images')));
// Explicitly serve HTML entry points
app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/thank-you.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'thank-you.html'));
});
// Block direct access to data folder
app.use('/data', (req, res) => {
  res.status(404).send('Not found');
});

function readOrders(){
  try{
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  }catch(e){
    return [];
  }
}
function writeOrders(orders){
  fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));
}
function genId(){
  return Math.floor(Date.now() / 1000).toString(36) + '-' + Math.random().toString(36).slice(2,6);
}
function sanitizeStatus(s){
  const allowed = ['pending','processing','shipped','delivered','cancelled'];
  return allowed.includes(s) ? s : 'pending';
}

function shippingFee(wilaya){
  const SOUTH = new Set([
    '01 - Adrar','11 - Tamanrasset','33 - Illizi','37 - Tindouf','49 - Timimoun',
    '50 - Bordj Badji Mokhtar','53 - In Salah','54 - In Guezzam','56 - Djanet',
    '30 - Ouargla','55 - Touggourt','57 - El M’Ghair','58 - El Menia','47 - Ghardaïa','32 - El Bayadh'
  ]);
  const ALGIERS = '16 - Alger';
  if(!wilaya) return 0;
  if(wilaya === ALGIERS) return 400;
  if(SOUTH.has(wilaya)) return 900;
  return 600;
}

function ipFromReq(req){
  return (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown').trim();
}

function rateLimitPost(req, res){
  const ip = ipFromReq(req);
  const now = Date.now();
  const entry = rateStore.get(ip);
  if(!entry || (now - entry.windowStart) > RATE_LIMIT_WINDOW_MS){
    rateStore.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  if(entry.count >= RATE_LIMIT_MAX_POSTS){
    res.status(429).json({ error: 'Too many requests. Please try later.' });
    return false;
  }
  entry.count += 1;
  return true;
}

function validateOrderPayload(body){
  const errors = [];
  const isStr = v => typeof v === 'string';
  const clean = v => (isStr(v) ? v.trim() : '');
  const maxLen = (v, n) => (v.length <= n);
  const phoneOk = v => /^(0[567]\d{8}|(\+?213)[567]\d{8})$/.test(v.replace(/\s+/g,''));
  const colorSet = new Set(['Black','White','Red','Blue','Green']);
  const sizeSet = new Set(['S','M','L','XL','XXL']);

  const name = clean(body.name);
  const phone = clean(body.phone);
  const wilaya = clean(body.wilaya);
  const address = clean(body.address);
  const color = clean(body.color);
  const size = clean(body.size);
  const qty = Math.max(1, parseInt(body.qty || 1, 10));
  const notes = clean(body.notes || '');

  if(!name) errors.push('name required');
  if(!phone || !phoneOk(phone)) errors.push('invalid phone');
  if(!wilaya) errors.push('wilaya required');
  if(!address) errors.push('address required');
  if(!color || !colorSet.has(color)) errors.push('invalid color');
  if(!size || !sizeSet.has(size)) errors.push('invalid size');
  if(!(qty >= 1 && qty <= 20)) errors.push('invalid qty');
  if(!maxLen(name, 120)) errors.push('name too long');
  if(!maxLen(address, 200)) errors.push('address too long');
  if(!maxLen(notes, 400)) errors.push('notes too long');

  return { ok: errors.length === 0, errors, data: { name, phone, wilaya, address, color, size, qty, notes } };
}

function getTokenFromReq(req){
  const auth = req.headers['authorization'] || '';
  if(auth.startsWith('Bearer ')){
    return auth.slice('Bearer '.length).trim();
  }
  const cookie = req.headers['cookie'] || '';
  const match = cookie.match(/(?:^|;\s*)admin_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function requireAdmin(req, res){
  const token = getTokenFromReq(req);
  if(!token || !validTokens.has(token)){
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if(!password || password !== ADMIN_PASSWORD){
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = genId() + '-adm';
  validTokens.add(token);
  // Set cookie for convenience; clients may also use Authorization header
  res.cookie('admin_token', token, { httpOnly: true, sameSite: 'lax', path: '/' });
  res.json({ token });
});

// GET all orders
app.get('/api/orders', (req, res) => {
  if(!requireAdmin(req, res)) return;
  const orders = readOrders();
  orders.sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0));
  res.json(orders);
});

// GET one order
app.get('/api/orders/:id', (req, res) => {
  const orders = readOrders();
  const order = orders.find(o => o.id === req.params.id);
  if(!order) return res.status(404).json({ error: 'Not found' });
  res.json(order);
});

// Create order (accepts frontend minimal payload or full order object)
app.post('/api/orders', (req, res) => {
  if(!rateLimitPost(req, res)) return;
  const body = req.body || {};
  const orders = readOrders();

  let order = null;
  if(body.items && Array.isArray(body.items)){
    // Assume full order shape provided
    const total = typeof body.total === 'number' ? body.total : body.items.reduce((s,i)=> s + (i.price||0)*(i.qty||1), 0);
    order = {
      id: genId(),
      customerName: body.customerName || body.name || '—',
      email: body.email || '',
      phone: body.phone || '',
      address: body.address || { street: '', city: '' },
      items: body.items,
      total,
      notes: body.notes || '',
      status: sanitizeStatus(body.status || 'pending'),
      createdAt: new Date().toISOString(),
    };
  } else {
    // Transform minimal payload from index.html
    const check = validateOrderPayload(body);
    if(!check.ok){
      return res.status(400).json({ error: 'Validation failed', details: check.errors });
    }
    const d = check.data;
    const BASE_PRICE = 2990;
    const wilaya = d.wilaya || '';
    const street = d.address || '';
    const city = (typeof wilaya === 'string' && wilaya.includes(' - ')) ? wilaya.split(' - ').slice(1).join(' - ') : wilaya;
    const qty = d.qty;
    const sub = BASE_PRICE * qty;
    const ship = shippingFee(wilaya);
    const total = sub + ship;
    const itemName = `Premium Hoodie (${d.color}, ${d.size})`;

    order = {
      id: genId(),
      customerName: d.name || '—',
      email: body.email || '',
      phone: d.phone || '',
      address: { street, city },
      items: [{ name: itemName, qty, price: BASE_PRICE }],
      total,
      notes: d.notes || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  }

  orders.push(order);
  writeOrders(orders);
  res.status(201).json(order);
});

// Update order status
app.patch('/api/orders/:id', (req, res) => {
  if(!requireAdmin(req, res)) return;
  const { status } = req.body || {};
  const orders = readOrders();
  const i = orders.findIndex(o => o.id === req.params.id);
  if(i < 0) return res.status(404).json({ error: 'Not found' });
  orders[i].status = sanitizeStatus(status);
  writeOrders(orders);
  res.json(orders[i]);
});

// Delete order
app.delete('/api/orders/:id', (req, res) => {
  if(!requireAdmin(req, res)) return;
  const orders = readOrders();
  const i = orders.findIndex(o => o.id === req.params.id);
  if(i < 0) return res.status(404).json({ error: 'Not found' });
  const removed = orders.splice(i,1)[0];
  writeOrders(orders);
  res.json({ ok: true, id: removed.id });
});

app.listen(PORT, () => {
  console.log(`My Algerian Store server running at https://www.boutiquedz.tech`);
});

