const express = require('express');
const app = express();
app.use(express.json());

let devices = {};
let pendingCommands = {};
let desiredRelays = {};
let history = {};
// history[name] = [ { slot: "14:35", tempReadings: [], temperature: 21.4, powerReadings: [], power: 142.3 }, ... ]
// max 288 entries (24hrs x 12 slots/hr)

function get5minSlot(date) {
  const h = date.getHours();
  const m = Math.floor(date.getMinutes() / 5) * 5;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
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

// Shelly posts sensor data and picks up any pending command
app.post('/data', (req, res) => {
  const name = req.body.name || 'unknown';
  console.log(`Received from ${name}:`, req.body);

  devices[name] = {
    temperature: req.body.temperature ?? null,
    humidity:    req.body.humidity    ?? null,
    power:       req.body.power       ?? null,
    energy:      req.body.energy      ?? null,
    relay:       req.body.relay       ?? null,
    timestamp:   new Date().toLocaleString()
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

// Dashboard toggle posts here
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
  if (!arr || arr.length < 2) return '<div style="font-size:0.75rem;color:#bbb;padding:10px 0;">Waiting for data...</div>';

  const W = 280, H = 80;
  const padL = 36, padR = 8, padT = 8, padB = 20;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  function buildSVG(values, color, unit) {
    const valid = values.filter(v => v != null);
    if (valid.length < 2) return '<div style="font-size:0.75rem;color:#bbb;padding:10px 0;">No data</div>';

    const minV   = Math.min(...valid);
    const maxV   = Math.max(...valid);
    const rangeV = maxV - minV || 1;
    const xStep  = chartW / (values.length - 1);

    const points = values.map((v, i) => {
      const x = padL + i * xStep;
      const y = v != null
        ? padT + chartH - ((v - minV) / rangeV) * chartH
        : null;
      return y != null ? `${x.toFixed(1)},${y.toFixed(1)}` : null;
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
  const tempSVG     = buildSVG(tempValues,  '#4CAF50', '°C');
  const powerSVG    = buildSVG(powerValues, '#2196F3', 'W');

  const hastemp  = tempValues.some(v => v != null);
  const haspower = powerValues.some(v => v != null);

  return `
  <div id="chart-${name}" style="background:var(--color-background-secondary);border-radius:var(--border-radius-md);padding:10px 14px;border:0.5px solid var(--color-border-tertiary);display:flex;flex-direction:column;min-width:260px;justify-content:center;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <span id="chart-label-${name}" style="font-size:11px;color:var(--color-text-secondary);">Temp °C — last 24h</span>
      <div style="display:flex;gap:4px;">
        ${hastemp ? `<button onclick="switchChart('${name}','temp')" id="btn-temp-${name}"
          style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid #4CAF50;background:#4CAF50;color:white;cursor:pointer;">Temp</button>` : ''}
        ${haspower ? `<button onclick="switchChart('${name}','power')" id="btn-power-${name}"
          style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid #ccc;background:transparent;color:var(--color-text-secondary);cursor:pointer;">Power</button>` : ''}
      </div>
    </div>
    <div id="chart-temp-${name}">${tempSVG}</div>
    <div id="chart-power-${name}" style="display:none;">${powerSVG}</div>
  </div>`;
}

function renderRow(name) {
  const d = devices[name] || {};

  const temp     = d.temperature != null ? d.temperature.toFixed(1) : '—';
  const humidity = d.humidity    != null ? d.humidity.toFixed(1)    : '—';
  const power    = d.power       != null ? d.power.toFixed(1)       : '—';
  const energy   = d.energy      != null ? (d.energy / 1000).toFixed(1) : '—';
  const time     = d.timestamp   ?? 'No data yet';

  const desired    = desiredRelays[name];
  const relay      = (desired !== null && desired !== undefined) ? desired : d.relay;
  const relayLabel = relay === true ? 'ON' : relay === false ? 'OFF' : '—';
  const checked    = relay === true ? 'checked' : '';
  const pending    = pendingCommands[name]
    ? `<span class="pending">Pending: turn ${pendingCommands[name]}...</span>` : '';

  return `
  <div class="device-row">
    <div class="device-name">${name}</div>

    <div class="relay-card">
      <div class="relay-label">Relay</div>
      <label class="switch">
        <input type="checkbox" ${checked} onchange="sendCommand('${name}', this.checked)">
        <span class="slider"></span>
      </label>
      <div class="relay-state">${relayLabel}</div>
      ${pending}
    </div>

    <div class="tiles">
      <div class="card">
        <div class="label">Temperature</div>
        <div class="value">${temp}<span class="unit">°C</span></div>
      </div>
      <div class="card">
        <div class="label">Humidity</div>
        <div class="value">${humidity}<span class="unit">%</span></div>
      </div>
      <div class="card">
        <div class="label">Power</div>
        <div class="value">${power}<span class="unit">W</span></div>
      </div>
      <div class="card">
        <div class="label">Energy</div>
        <div class="value">${energy}<span class="unit">kWh</span></div>
      </div>
    </div>

    ${renderChart(name)}

    <div class="timestamp">${time}</div>
  </div>`;
}

// Public dashboard
app.get('/', (req, res) => {
  const knownDevices = ['shelly1', 'shelly2', 'shelly3'];
  const activeDevices = Object.keys(devices).filter(n => !knownDevices.includes(n));
  const allDevices = [...knownDevices, ...activeDevices];

  const rows = allDevices.map(renderRow).join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="30">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shelly Dashboard</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: sans-serif; max-width: 1200px; margin: 40px auto; padding: 0 20px; color: #222; }
    h1 { font-size: 1.4rem; font-weight: 500; margin-bottom: 0.4rem; }
    .subtitle { font-size: 0.85rem; color: #999; margin-bottom: 2rem; }

    .device-row {
      display: flex;
      align-items: stretch;
      gap: 16px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .device-row + .device-row {
      padding-top: 16px;
      border-top: 1px solid #e5e5e5;
    }

    .device-name {
      font-size: 0.95rem;
      font-weight: 600;
      min-width: 80px;
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
      padding: 12px 16px;
      min-width: 90px;
      gap: 6px;
    }
    .relay-label { font-size: 0.75rem; color: #666; }
    .relay-state { font-size: 1rem; font-weight: 600; }

    .tiles {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      flex: 1;
      min-width: 260px;
    }
    .card {
      background: #f5f5f5;
      border-radius: 10px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .label { font-size: 0.75rem; color: #666; margin-bottom: 2px; }
    .value { font-size: 1.6rem; font-weight: 600; line-height: 1.1; }
    .unit  { font-size: 0.8rem; color: #888; margin-left: 2px; }

    .timestamp {
      font-size: 0.72rem;
      color: #bbb;
      min-width: 90px;
      display: flex;
      align-items: center;
    }

    .switch { position: relative; display: inline-block; width: 48px; height: 26px; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: #ccc; border-radius: 26px; transition: .3s; }
    .slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 4px; bottom: 4px; background: white; border-radius: 50%; transition: .3s; }
    input:checked + .slider { background: #4CAF50; }
    input:checked + .slider:before { transform: translateX(22px); }

    .pending { font-size: 0.7rem; color: #e67e00; text-align: center; }
    .footer  { font-size: 0.8rem; color: #999; margin-top: 24px; }

    @media (max-width: 600px) {
      .tiles { grid-template-columns: repeat(2, 1fr); }
      .timestamp { display: none; }
    }
  </style>
</head>
<body>
  <h1>Shelly Dashboard</h1>
  <p class="subtitle">Refreshes every 30s</p>

  ${rows}

  <p class="footer">Page last rendered: ${new Date().toLocaleString()}</p>

  <script>
    function switchChart(name, type) {
      const tempDiv   = document.getElementById('chart-temp-'  + name);
      const powerDiv  = document.getElementById('chart-power-' + name);
      const btnTemp   = document.getElementById('btn-temp-'    + name);
      const btnPower  = document.getElementById('btn-power-'   + name);
      const label     = document.getElementById('chart-label-' + name);

      if (type === 'temp') {
        tempDiv.style.display  = '';
        powerDiv.style.display = 'none';
        if (btnTemp)  { btnTemp.style.background  = '#4CAF50'; btnTemp.style.color  = 'white'; btnTemp.style.borderColor  = '#4CAF50'; }
        if (btnPower) { btnPower.style.background = 'transparent'; btnPower.style.color = 'var(--color-text-secondary,#666)'; btnPower.style.borderColor = '#ccc'; }
        if (label) label.textContent = 'Temp \u00b0C \u2014 last 24h';
      } else {
        tempDiv.style.display  = 'none';
        powerDiv.style.display = '';
        if (btnPower) { btnPower.style.background = '#2196F3'; btnPower.style.color = 'white'; btnPower.style.borderColor = '#2196F3'; }
        if (btnTemp)  { btnTemp.style.background  = 'transparent'; btnTemp.style.color = 'var(--color-text-secondary,#666)'; btnTemp.style.borderColor  = '#ccc'; }
        if (label) label.textContent = 'Power W \u2014 last 24h';
      }
    }

    function sendCommand(name, isOn) {
      fetch('/command/' + name, {
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
