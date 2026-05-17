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

let pendingCommand = null;
let desiredRelay = null;

// Shelly posts sensor data and picks up any pending command
app.post('/data', (req, res) => {
  console.log('Received:', req.body);
  latest = { ...req.body, timestamp: new Date().toLocaleString() };
  const cmd = pendingCommand;
  pendingCommand = null;
  res.json({ command: cmd });
});

// Dashboard toggle posts here
app.post('/command', (req, res) => {
  const { state } = req.body;
  if (state === 'on' || state === 'off') {
    pendingCommand = state;
    desiredRelay = state === 'on';
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

  if (desiredRelay !== null && latest.relay === desiredRelay) {
    desiredRelay = null;
  }
  const relay      = desiredRelay !== null ? desiredRelay : latest.relay;
  const relayLabel = relay === true ? 'ON' : relay === false ? 'OFF' : '—';
  const checked    = relay === true ? 'checked' : '';
  const pending    = pendingCommand ? `<p class="pending">Command pending: turn ${pendingCommand}...</p>` : '';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="30">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shelly Sensor</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: sans-serif; max-width: 700px; margin: 60px auto; padding: 0 20px; color: #222; }
    h1 { font-size: 1.4rem; font-weight: 500; margin-bottom: 2rem; }

    .row { display: flex; align-items: stretch; gap: 16px; }

    /* Toggle card on the left */
    .relay-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #f5f5f5;
      border-radius: 10px;
      padding: 20px 24px;
      min-width: 110px;
      gap: 12px;
    }
    .relay-label { font-size: 0.85rem; color: #666; }
    .relay-state { font-size: 1.4rem; font-weight: 600; }

    /* Sensor tiles on the right */
    .tiles {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      flex: 1;
    }
    .card { background: #f5f5f5; border-radius: 10px; padding: 20px 16px; }
    .label { font-size: 0.85rem; color: #666; margin-bottom: 4px; }
    .value { font-size: 2rem; font-weight: 600; line-height: 1.1; }
    .unit  { font-size: 0.9rem; color: #888; margin-left: 2px; }

    /* Toggle switch */
    .switch { position: relative; display: inline-block; width: 56px; height: 30px; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: #ccc; border-radius: 30px; transition: .3s; }
    .slider:before { position: absolute; content: ""; height: 22px; width: 22px; left: 4px; bottom: 4px; background: white; border-radius: 50%; transition: .3s; }
    input:checked + .slider { background: #4CAF50; }
    input:checked + .slider:before { transform: translateX(26px); }

    .pending { font-size: 0.8rem; color: #e67e00; margin-top: 12px; }
    .footer  { font-size: 0.8rem; color: #999; margin-top: 24px; }

    /* Stack to two columns on narrow screens */
    @media (max-width: 520px) {
      .tiles { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <h1>Shelly 1PM — Live Sensor Data</h1>

  <div class="row">
    <div class="relay-card">
      <div class="relay-label">Relay</div>
      <label class="switch">
        <input type="checkbox" id="relay-toggle" ${checked} onchange="sendCommand(this.checked)">
        <span class="slider"></span>
      </label>
      <div class="relay-state">${relayLabel}</div>
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
