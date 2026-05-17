const express = require('express');
const app = express();
app.use(express.json());

let devices = {};
let pendingCommands = {};
let desiredRelays = {};
let history = {};

const TIMEZONE = 'America/New_York';
const STALE_MS = 10 * 60 * 1000;

function get5minSlot(date) {
  const str = date.toLocaleString('en-US', {
    timeZone: TIMEZONE,
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false
  });
  const [h, m] = str.split(':').map(Number);
  const mSlot = Math.floor(m / 5) * 5;
  return `${String(h).padStart(2,'0')}:${String(mSlot).padStart(2,'0')}`;
}

function nowET() {
  return new Date().toLocaleString('en-US', { timeZone: TIMEZONE });
}

function updateHistory(name, temperature, power) {
  if (temperature == null && power == null) return;
  if (!history[name]) history[name] = [];

  const slot = get5minSlot(new Date());
  const arr  = history[name];

  const existing = arr.find(e => e.slot === slot);
  if (existing) {
    if (temperature != null) {
      existing.tempReadings.push(temperature);
      existing.temperature = existing.tempReadings.reduce((a, b) => a + b, 0) / existing.tempReadings.length;
    }
    if (power != null) {
      existing.powerReadings.push(power);
      existing.power = existing.powerReadings.reduce((a, b) => a + b, 0) / existing.powerReadings.length;
    }
  } else {
    arr.push({
      slot,
      tempReadings:  temperature != null ? [temperature] : [],
      temperature:   temperature,
      powerReadings: power != null ? [power] : [],
      power:         power
    });
    if (arr.length > 288) arr.shift();
  }
}

app.post('/data', (req, res) => {
  const name = req.body.name || 'unknown';
  console.log(`Received from ${name}:`, req.body);

  devices[name] = {
    temperature: req.body.temperature ?? null,
    humidity:    req.body.humidity    ?? null,
    power:       req.body.power       ?? null,
    energy:      req.body.energy      ?? null,
    relay:       req.body.relay       ?? null,
    timestamp:   nowET(),
    lastSeen:    Date.now()
  };

  updateHistory(name, req.body.temperature ?? null, req.body.power ?? null);

  if (desiredRelays[name] !== null && desiredRelays[name] !== undefined) {
    if (devices[name].relay === desiredRelays[name]) {
      desiredRelays[name] = null;
    }
  }

  const cmd = pendingCommands[name] || null;
  pendingCommands[name] = null;
  res.json({ command: cmd });
});

app.post('/command/:name', (req, res) => {
  const { name } = req.params;
  const { state } = req.body;
  if (state === 'on' || state === 'off') {
    pendingCommands[name] = state;
    desiredRelays[name] = state === 'on';
    res.json({ ok: true, pending: state });
  } else {
    res.status(400).json({ error: 'state must be on or off' });
  }
});

function renderChart(name) {
  const arr = history[name];
  if (!arr || arr.length < 2) {
    return `<div class="chart-card"><div style="font-size:0.75rem;color:#bbb;padding:10px 0;">Waiting for data...</div></div>`;
  }

  const W = 280, H = 80;
  const padL = 36, padR = 8, padT = 8, padB = 20;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  function buildSVG(values, color) {
    const valid = values.filter(v => v != null);
    if (valid.length < 2) return null;

    const minV   = Math.min(...valid);
    const maxV   = Math.max(...valid);
    const rangeV = maxV - minV || 1;
    const xStep  = chartW / (values.length - 1);

    const points = values.map((v, i) => {
      if (v == null) return null;
      const x = padL + i * xStep;
      const y = padT + chartH - ((v - minV) / rangeV) * chartH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).filter(Boolean).join(' ');

    const firstSlot = arr[0].slot;
    const lastSlot  = arr[arr.length - 1].slot;
    const tMid      = ((minV + maxV) / 2).toFixed(1);

    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block;">
      <line x1="${padL}" y1="${padT}" x2="${W-padR}" y2="${padT}" stroke="#e0e0e0" stroke-width="1"/>
      <line x1="${padL}" y1="${padT+chartH/2}" x2="${W-padR}" y2="${padT+chartH/2}" stroke="#e0e0e0" stroke-width="1" stroke-dasharray="3,3"/>
      <line x1="${padL}" y1="${padT+chartH}" x2="${W-padR}" y2="${padT+chartH}" stroke="#e0e0e0" stroke-width="1"/>
      <text x="${padL-4}" y="${padT+4}" text-anchor="end" font-size="9" fill="#999">${maxV.toFixed(1)}</text>
      <text x="${padL-4}" y="${padT+chartH/2+3}" text-anchor="end" font-size="9" fill="#999">${tMid}</text>
      <text x="${padL-4}" y="${padT+chartH}" text-anchor="end" font-size="9" fill="#999">${minV.toFixed(1)}</text>
      <text x="${padL}" y="${H-2}" text-anchor="middle" font-size="9" fill="#999">${firstSlot}</text>
      <text x="${W-padR}" y="${H-2}" text-anchor="middle" font-size="9" fill="#999">${lastSlot}</text>
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${values.map((v, i) => {
        if (v == null) return '';
        const x = padL + i * xStep;
        const y = padT + chartH - ((v - minV) / rangeV) * chartH;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="${color}"/>`;
      }).join('')}
    </svg>`;
  }

  const tempValues  = arr.map(e => e.temperature);
  const powerValues = arr.map(e => e.power);
  const tempSVG     = buildSVG(tempValues,  '#4CAF50');
  const powerSVG    = buildSVG(powerValues, '#2196F3');
  const hasTemp     = tempSVG !== null;
  const hasPower    = powerSVG !== null;

  // Default to whichever has data; prefer temp if both available
  const defaultView = hasTemp ? 'temp' : 'power';

  const safeId = name.replace(/[^a-zA-Z0-9]/g, '_');

  // Button styles
  const btnActive   = (color) => `font-size:11px;padding:3px 10px;border-radius:4px;border:1px solid ${color};background:${color};color:white;cursor:pointer;font-weight:500;`;
  const btnInactive = `font-size:11px;padding:3px 10px;border-radius:4px;border:1px solid #ccc;background:transparent;color:#666;cursor:pointer;font-weight:400;`;

  const tempBtnStyle  = defaultView === 'temp' ? btnActive('#4CAF50') : btnInactive;
  const powerBtnStyle = defaultView === 'power' ? btnActive('#2196F3') : btnInactive;

  const defaultLabel  = defaultView === 'temp' ? 'Temp \u00b0C \u2014 last 24h' : 'Power W \u2014 last 24h';

  return `
  <div id="chart-${safeId}" class="chart-card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <span id="chart-label-${safeId}" style="font-size:11px;color:#666;">${defaultLabel}</span>
      <div style="display:flex;gap:5px;">
        ${hasTemp  ? `<button onclick="switchChart('${safeId}','temp')"  id="btn-temp-${safeId}"  style="${tempBtnStyle}">Temp</button>`  : ''}
        ${hasPower ? `<button onclick="switchChart('${safeId}','power')" id="btn-power-${safeId}" style="${powerBtnStyle}">Power</button>` : ''}
      </div>
    </div>
    <div id="chart-temp-${safeId}"  style="display:${defaultView === 'temp'  ? '' : 'none'};">${tempSVG  || ''}</div>
    <div id="chart-power-${safeId}" style="display:${defaultView === 'power' ? '' : 'none'};">${powerSVG || ''}</div>
  </div>`;
}

function renderRow(name) {
  const d          = devices[name] || {};
  const temp       = d.temperature != null ? d.temperature.toFixed(1) : '—';
  const humidity   = d.humidity    != null ? d.humidity.toFixed(1)    : '—';
  const power      = d.power       != null ? d.power.toFixed(1)       : '—';
  const energy     = d.energy      != null ? (d.energy / 1000).toFixed(1) : '—';
  const time       = d.timestamp   ?? 'No data yet';
  const desired    = desiredRelays[name];
  const relay      = (desired !== null && desired !== undefined) ? desired : d.relay;
  const relayLabel = relay === true ? 'ON' : relay === false ? 'OFF' : '—';
  const checked    = relay === true ? 'checked' : '';
  const pending    = pendingCommands[name]
    ? `<span class="pending">Pending: turn ${pendingCommands[name]}...</span>` : '';

  return `
  <div class="device-row">
    <div class="col-name device-name">${name}</div>

    <div class="col-relay relay-card">
      <div class="relay-label">Relay</div>
      <label class="switch">
        <input type="checkbox" ${checked} onchange="sendCommand('${name}', this.checked)">
        <span class="slider"></span>
      </label>
      <div class="relay-state">${relayLabel}</div>
      ${pending}
    </div>

    <div class="col-temp card">
      <div class="label">Temperature</div>
      <div class="value">${temp}<span class="unit">°C</span></div>
    </div>

    <div class="col-humidity card">
      <div class="label">Humidity</div>
      <div class="value">${humidity}<span class="unit">%</span></div>
    </div>

    <div class="col-power card">
      <div class="label">Power</div>
      <div class="value">${power}<span class="unit">W</span></div>
    </div>

    <div class="col-energy card">
      <div class="label">Energy</div>
      <div class="value">${energy}<span class="unit">kWh</span></div>
    </div>

    <div class="col-chart">
      ${renderChart(name)}
    </div>

    <div class="col-timestamp timestamp">${time}</div>
  </div>`;
}

app.get('/', (req, res) => {
  const now        = Date.now();
  const allDevices = Object.keys(devices).filter(name =>
    devices[name].lastSeen && (now - devices[name].lastSeen) < STALE_MS
  );

  const rows = allDevices.length > 0
    ? allDevices.map(renderRow).join('')
    : '<p style="color:#999;font-size:0.9rem;">Waiting for devices to report in...</p>';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="30">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dashboard</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: sans-serif; max-width: 1300px; margin: 40px auto; padding: 0 20px; color: #222; }
    h1 { font-size: 1.4rem; font-weight: 500; margin-bottom: 0.4rem; }
    .subtitle { font-size: 0.85rem; color: #999; margin-bottom: 2rem; }

    .device-row {
      display: grid;
      grid-template-columns:
        [name]      minmax(100px, max-content)
        [relay]     90px
        [temp]      100px
        [humidity]  100px
        [power]     100px
        [energy]    100px
        [chart]     minmax(260px, 1fr)
        [timestamp] minmax(80px, max-content);
      gap: 12px;
      align-items: stretch;
      margin-bottom: 12px;
    }
    .device-row + .device-row {
      padding-top: 12px;
      border-top: 1px solid #e5e5e5;
    }

    .col-name      { grid-column: name; }
    .col-relay     { grid-column: relay; }
    .col-temp      { grid-column: temp; }
    .col-humidity  { grid-column: humidity; }
    .col-power     { grid-column: power; }
    .col-energy    { grid-column: energy; }
    .col-chart     { grid-column: chart; }
    .col-timestamp { grid-column: timestamp; }

    .device-name {
      font-size: 0.9rem;
      font-weight: 600;
      color: #444;
      display: flex;
      align-items: center;
    }

    .relay-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #f5f5f5;
      border-radius: 10px;
      padding: 10px 12px;
      gap: 5px;
    }
    .relay-label { font-size: 0.72rem; color: #666; }
    .relay-state { font-size: 0.9rem; font-weight: 600; }

    .card {
      background: #f5f5f5;
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .chart-card {
      background: #f5f5f5;
      border-radius: 10px;
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .label { font-size: 0.72rem; color: #666; margin-bottom: 2px; }
    .value { font-size: 1.4rem; font-weight: 600; line-height: 1.1; }
    .unit  { font-size: 0.75rem; color: #888; margin-left: 2px; }

    .timestamp {
      font-size: 0.7rem;
      color: #bbb;
      display: flex;
      align-items: center;
    }

    .switch { position: relative; display: inline-block; width: 44px; height: 24px; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: #ccc; border-radius: 24px; transition: .3s; }
    .slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 4px; bottom: 4px; background: white; border-radius: 50%; transition: .3s; }
    input:checked + .slider { background: #4CAF50; }
    input:checked + .slider:before { transform: translateX(20px); }

    .pending { font-size: 0.65rem; color: #e67e00; text-align: center; }
    .footer  { font-size: 0.8rem; color: #999; margin-top: 24px; }

    @media (max-width: 900px) {
      .device-row { grid-template-columns: 1fr 1fr; }
      .col-chart     { grid-column: 1 / -1; }
      .col-timestamp { display: none; }
    }
  </style>
</head>
<body>
  <h1>Dashboard</h1>
  <p class="subtitle">Refreshes every 30s &mdash; Eastern Time</p>

  ${rows}

  <p class="footer">Page last rendered: ${nowET()} ET</p>

  <script>
    function switchChart(safeId, type) {
      const tempDiv  = document.getElementById('chart-temp-'  + safeId);
      const powerDiv = document.getElementById('chart-power-' + safeId);
      const btnTemp  = document.getElementById('btn-temp-'    + safeId);
      const btnPower = document.getElementById('btn-power-'   + safeId);
      const label    = document.getElementById('chart-label-' + safeId);

      if (type === 'temp') {
        if (tempDiv)  tempDiv.style.display  = '';
        if (powerDiv) powerDiv.style.display = 'none';
        if (btnTemp)  { btnTemp.style.background  = '#4CAF50';     btnTemp.style.color  = 'white'; btnTemp.style.borderColor  = '#4CAF50';  btnTemp.style.fontWeight  = '500'; }
        if (btnPower) { btnPower.style.background = 'transparent'; btnPower.style.color = '#666';  btnPower.style.borderColor = '#ccc';     btnPower.style.fontWeight = '400'; }
        if (label) label.textContent = 'Temp \u00b0C \u2014 last 24h';
      } else {
        if (tempDiv)  tempDiv.style.display  = 'none';
        if (powerDiv) powerDiv.style.display = '';
        if (btnPower) { btnPower.style.background = '#2196F3';     btnPower.style.color = 'white'; btnPower.style.borderColor = '#2196F3';  btnPower.style.fontWeight = '500'; }
        if (btnTemp)  { btnTemp.style.background  = 'transparent'; btnTemp.style.color  = '#666';  btnTemp.style.borderColor  = '#ccc';     btnTemp.style.fontWeight  = '400'; }
        if (label) label.textContent = 'Power W \u2014 last 24h';
      }
    }

    function sendCommand(name, isOn) {
      fetch('/command/' + encodeURIComponent(name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: isOn ? 'on' : 'off' })
      }).then(r => r.json()).then(d => {
        if (d.ok) {
          document.querySelector('.footer').textContent =
            'Command sent to ' + name + ' \u2014 Shelly will update within 60s';
        }
      });
    }
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
