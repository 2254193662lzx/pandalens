/* =============================================================================
 * gen-data.js — deterministic generator for the three synthetic datasets that
 * ship with PandaLens (retail orders, air quality, stock prices).
 *   node tools/gen-data.js
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'web', 'data');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20241009);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + rand() * (b - a);
const gauss = (mu = 0, sd = 1) => {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pad = (n, w = 2) => String(n).padStart(w, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const round = (v, d = 2) => Number(v.toFixed(d));
const csv = (header, rows) => header.join(',') + '\n' + rows.map((r) => r.join(',')).join('\n') + '\n';
const q = (s) => (String(s).includes(',') ? `"${s}"` : String(s));

/* ----------------------------------------------------------- 1. retail orders */
(function sales() {
  const regions = ['East', 'West', 'North', 'South'];
  const channels = ['Online', 'Retail', 'Partner'];
  const products = {
    Furniture: ['Desk Lamp', 'Office Chair', 'Bookshelf', 'Side Table', 'Filing Cabinet'],
    Technology: ['Wireless Mouse', '27-inch Monitor', 'Mechanical Keyboard', 'USB-C Dock', 'Webcam'],
    'Office Supplies': ['A4 Paper (500)', 'Gel Pen Pack', 'Stapler', 'Sticky Notes', 'Binder Clips'],
  };
  const cats = Object.keys(products);
  const regionBias = { East: 1.12, West: 1.05, North: 0.92, South: 0.98 };
  const rows = [];
  const start = new Date(2021, 0, 1).getTime();
  const span = 3 * 365 * 86400000;
  for (let i = 0; i < 1200; i++) {
    const t = start + Math.floor(rand() * span);
    const d = new Date(t);
    const region = pick(regions);
    const channel = rand() < 0.42 ? 'Online' : pick(channels);
    const category = pick(cats);
    const product = pick(products[category]);
    const base = { Furniture: between(120, 460), Technology: between(45, 620), 'Office Supplies': between(6, 48) }[category];
    const units = Math.max(1, Math.round(Math.abs(gauss(6, 5))) + 1);
    const unit_price = round(base * regionBias[region], 2);
    const discount = rand() < 0.55 ? round(between(0, 0.3), 2) : (rand() < 0.04 ? '' : 0);
    const disc = discount === '' ? 0 : discount;
    const revenue = round(units * unit_price * (1 - disc), 2);
    const cost = round(revenue * between(0.55, 0.82), 2);
    const profit = round(revenue - cost, 2);
    const age = rand() < 0.94 ? Math.round(between(18, 74)) : '';
    const sat = rand() < 0.05 ? '' : Math.min(5, Math.max(1, Math.round(gauss(4.1, 0.85))));
    const returned = rand() < 0.07 ? 1 : 0;
    rows.push([
      `SO-${d.getFullYear()}-${pad(i + 1, 4)}`, iso(d), d.getFullYear(), d.getMonth() + 1,
      q(region), q(channel), q(category), q(product), units, unit_price, discount, revenue, cost, profit, age, sat, returned,
    ]);
  }
  fs.writeFileSync(path.join(OUT, 'sales.csv'), csv(
    ['order_id', 'order_date', 'year', 'month', 'region', 'channel', 'category', 'product', 'units', 'unit_price', 'discount', 'revenue', 'cost', 'profit', 'customer_age', 'satisfaction', 'returned'],
    rows));
  console.log('sales.csv', rows.length, 'rows');
})();

/* ---------------------------------------------------------- 2. air quality */
(function air() {
  const stations = ['Central', 'Riverside', 'Harbour'];
  const rows = [];
  const days = 730;
  for (let k = 0; k < stations.length; k++) {
    const station = stations[k];
    const bias = [1.0, 0.82, 1.24][k];
    for (let i = 0; i < days; i++) {
      const d = new Date(2022, 0, 1 + i);
      const doy = i % 365;
      const winter = Math.cos((2 * Math.PI * doy) / 365) * 0.5 + 0.5;       // 1 in Jan, 0 in Jul
      const pm25 = Math.max(3, gauss(26 + 22 * winter, 9) * bias);
      const pm10 = Math.max(6, pm25 * between(1.35, 2.1) + gauss(0, 5));
      const no2 = Math.max(4, (pm25 * 0.72 + 8) * between(0.85, 1.2));
      const o3 = Math.max(6, gauss(52 - 18 * winter, 13));
      const temperature = round(14 + 13 * (1 - winter) + gauss(0, 3.4), 1);
      const humidity = Math.min(99, Math.max(18, gauss(66 + 12 * winter, 11)));
      const wind = Math.max(0.2, gauss(3.4 - 1.2 * winter, 1.4));
      // sensor faults + spikes: blocky gaps and occasional absurd readings
      const dropPm25 = rand() < 0.11 || (doy > 120 && doy < 132);
      const spike = rand() < 0.012;
      const pm25v = dropPm25 ? '' : round(spike ? pm25 * between(4, 9) : pm25, 1);
      const pm10v = rand() < 0.075 ? '' : round(spike ? pm10 * between(2.5, 5) : pm10, 1);
      const no2v = rand() < 0.06 ? '' : round(no2, 1);
      const o3v = rand() < 0.1 ? '' : round(o3, 1);
      const tempv = rand() < 0.02 ? '' : temperature;
      const grade = pm25v === '' ? '' : pm25v <= 12 ? 'Good' : pm25v <= 35 ? 'Moderate' : pm25v <= 55 ? 'Unhealthy (sensitive)' : 'Unhealthy';
      rows.push([iso(d), d.getFullYear(), d.getMonth() + 1, q(station), pm25v, pm10v, no2v, o3v, tempv, round(humidity, 1), round(wind, 2), q(grade)]);
    }
  }
  fs.writeFileSync(path.join(OUT, 'airquality.csv'), csv(
    ['date', 'year', 'month', 'station', 'pm25', 'pm10', 'no2', 'o3', 'temperature', 'humidity', 'wind_speed', 'aqi_grade'],
    rows));
  console.log('airquality.csv', rows.length, 'rows');
})();

/* -------------------------------------------------------- 3. stock prices */
(function stocks() {
  const tickers = [
    { code: 'ALPHA', start: 128, drift: 0.00062, vol: 0.0165 },
    { code: 'BOREAL', start: 74, drift: 0.00018, vol: 0.0122 },
    { code: 'CIRRUS', start: 246, drift: -0.00024, vol: 0.0208 },
  ];
  const rows = [];
  const tradingDays = [];
  const d = new Date(2023, 0, 2);
  while (tradingDays.length < 500) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) tradingDays.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  for (const tk of tickers) {
    let price = tk.start;
    for (const day of tradingDays) {
      const shock = gauss(0, 1);
      const ret = tk.drift + shock * tk.vol + (rand() < 0.02 ? gauss(0, 0.03) : 0);
      const open = price;
      price = Math.max(3, price * (1 + ret));
      const close = price;
      const high = Math.max(open, close) * (1 + Math.abs(gauss(0, 0.004)));
      const low = Math.min(open, close) * (1 - Math.abs(gauss(0, 0.004)));
      const volume = Math.round(Math.abs(gauss(1.9e6, 6.5e5)) * (1 + Math.abs(ret) * 22));
      rows.push([iso(day), q(tk.code), round(open, 2), round(high, 2), round(low, 2), round(close, 2), volume]);
    }
  }
  fs.writeFileSync(path.join(OUT, 'stocks.csv'), csv(['date', 'ticker', 'open', 'high', 'low', 'close', 'volume'], rows));
  console.log('stocks.csv', rows.length, 'rows');
})();
