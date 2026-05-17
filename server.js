const express = require('express');
const app = express();
app.use(express.json());

// Keyed by device name
let devices = {};
// { shelly1: { temperature, humidity, power, energy, relay, timestamp },  ... }

let pendingCommands = {};
// { shelly1: 'on' | 'off' | null, ... }

let desiredRelays = {};
// { shelly1: true | false | null, ... }

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

  // Clear desiredRelay if Shelly confirms the state
  if (desiredRelays[name] !== null && desiredRelays[name] !== undefined) {
    if (devices[name].relay === desiredRelays[name]) {
      desiredRelays[name] = null;
    }
  }

  const cmd = pendingCommands[name] || null;
  pendingCommands[name] = null;
  res.json({ command: cmd });
});

// Dashboard toggle posts here — include device name in URL
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

function renderRow(name) {
  const d = devices[name] || {};
  const temp     = d.temperature ?? '—';
  const humidity = d.humidity    ?? '—';
  const power    = d.power       ?? '—';
  const energy   = d.energy      ?? '—';
  const time     = d.timestamp   ?? 'No data yet';

  const desired  = desiredRelays[name];
  const relay    = (desired !== null && desired !== undefined) ? desired : d.relay;
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
        <div class="value">${energy}<span class="unit">Wh</span></div>
      </div>
    </div>

    <div class="timestamp">${time}</div>
  </div>`;
}

// Public dashboard
app.get('/', (req, res) => {
  // Always show at least shelly1, plus any others that have reported in
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
    body { font-family: sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #222; }
    h1 { font-size: 1.4rem; font-weight: 500; margin-bottom: 0.4rem; }
    .subtitle { font-size: 0.85rem; color: #999; margin-bottom: 2rem; }

    /* One row per device */
    .device-row {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .device-row + .device-row {
      padding-top: 16px;
      border-top: 1px solid #e5e5e5;
    }

    /* Device name label */
    .device-name {
      font-size: 0.95rem;
      font-weight: 600;
      min-width: 80px;
      color: #444;
    }

    /* Toggle card */
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

    /* Sensor tiles */
    .tiles {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      flex: 1;
    }
    .card { background: #f5f5f5; border-radius: 10px; padding: 12px 14px; }
    .label { font-size: 0.75rem; color: #666; margin-bottom: 2px; }
    .value { font-size: 1.6rem; font-weight: 600; line-height: 1.1; }
    .unit  { font-size: 0.8rem; color: #888; margin-left: 2px; }

    /* Timestamp */
    .timestamp { font-size: 0.72rem; color: #bbb; min-width: 100px; }

    /* Toggle switch */
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
    function sendCommand(name, isOn) {
      fetch('/command/' + name, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: isOn ? 'on' : 'off' })
      }).then(r => r.json()).then(d => {
        if (d.ok) {
          document.querySelector('.footer').textContent =
            'Command sent to ' + name + ' — Shelly will update within 60s';
        }
      });
    }
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
