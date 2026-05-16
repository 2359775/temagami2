const express = require('express');
const app = express();
app.use(express.json());

let latest = {
  temperature: null,
  humidity: null,
  power: null,
  energy: null,
  relay: null,
  timestamp: null
};

let pendingCommand = null; // 'on', 'off', or null

// Shelly posts sensor data and picks up any pending command
app.post('/data', (req, res) => {
  console.log('Received:', req.body);
  latest = { ...req.body, timestamp: new Date().toLocaleString() };
  const cmd = pendingCommand;
  pendingCommand = null; // clear after sending once
  res.json({ command: cmd });
});

// Dashboard toggle posts here
app.post('/command', (req, res) => {
  const { state } = req.body;
  if (state === 'on' || state === 'off') {
    pendingCommand = state;
    res.json({ ok: true, pending: pendingCommand });
  } else {
    res.status(400).json({ error: 'state must be on or off' });
  }
});

// Public dashboard
app.get('/', (req, res) => {
  const temp     = latest.temperature ?? '—';
  const humidity = latest.humidity    ?? '—';
  const power    = latest.power       ?? '—';
  const energy   = latest.energy      ?? '—';
  const time     = latest.timestamp   ?? 'Waiting for first reading...';
  const relay    = latest.relay;
  const relayLabel = relay === true ? 'ON' : relay === false ? 'OFF' : '—';
  const checked  = relay === true ? 'checked' : '';
  const pending  = pendingCommand ? `<p class="pending">Command pending: turn ${pendingCommand}...</p>` : '';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="30">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shelly Sensor</title>
  <style>
    body { font-family: sans-serif; max-width: 500px; margin: 60px auto; padding: 0 20px; color: #222; }
    h1 { font-size: 1.4rem; font-weight: 500; margin-bottom: 2rem; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { background: #f5f5f5; border-radius: 10px; padding: 20px 24px; }
    .label { font-size: 0.85rem; color: #666; margin-bottom: 4px; }
    .value { font-size: 2.4rem; font-weight: 600; }
    .unit  { font-size: 1rem; color: #888; margin-left: 4px; }
    .relay-card { background: #f5f5f5; border-radius: 10px; padding: 20px 24px; margin-top: 16px; display: flex; align-items: center; justify-content: space-between; }
    .relay-label { font-size: 0.85rem; color: #666; margin-bottom: 4px; }
    .relay-state { font-size: 1.4rem; font-weight: 600; }
    .switch { position: relative; display: inline-block; width: 56px; height: 30px; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: #ccc; border-radius: 30px; transition: .3s; }
    .slider:before { position: absolute; content: ""; height: 22px; width: 22px; left: 4px; bottom: 4px; background: white; border-radius: 50%; transition: .3s; }
    input:checked + .slider { background: #4CAF50; }
    input:checked + .slider:before { transform: translateX(26px); }
    .pending { font-size: 0.8rem; color: #e67e00; margin-top: 12px; }
    .footer { font-size: 0.8rem; color: #999; margin-top: 24px; }
  </style>
</head>
<body>
  <h1>Shelly 1PM — Live Sensor Data</h1>
  <div class="grid">
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

  <div class="relay-card">
    <div>
      <div class="relay-label">Relay</div>
      <div class="relay-state">${relayLabel}</div>
    </div>
    <label class="switch">
      <input type="checkbox" id="relay-toggle" ${checked} onchange="sendCommand(this.checked)">
      <span class="slider"></span>
    </label>
  </div>
  ${pending}

  <p class="footer">Last updated: ${time} · refreshes every 30s</p>

  <script>
    function sendCommand(isOn) {
      fetch('/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: isOn ? 'on' : 'off' })
      }).then(r => r.json()).then(d => {
        if (d.ok) {
          document.querySelector('.footer').textContent = 'Command sent — Shelly will update within 60s';
        }
      });
    }
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
