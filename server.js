const express = require('express');
const app = express();
app.use(express.json());

let latest = {
  temperature: null,
  power: null,
  energy: null,
  timestamp: null
};

// Shelly posts sensor data here
app.post('/data', (req, res) => {
  console.log('Received:', req.body);
  latest = { ...req.body, timestamp: new Date().toLocaleString() };
  res.sendStatus(200);
});

// Public dashboard
app.get('/', (req, res) => {
  const temp  = latest.temperature ?? '—';
  const power = latest.power      ?? '—';
  const energy = latest.energy    ?? '—';
  const time  = latest.timestamp  ?? 'Waiting for first reading...';

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
    .card { background: #f5f5f5; border-radius: 10px; padding: 20px 24px; margin-bottom: 16px; }
    .label { font-size: 0.85rem; color: #666; margin-bottom: 4px; }
    .value { font-size: 2.4rem; font-weight: 600; }
    .unit  { font-size: 1rem; color: #888; margin-left: 4px; }
    .footer { font-size: 0.8rem; color: #999; margin-top: 24px; }
  </style>
</head>
<body>
  <h1>Shelly 1PM — Live Sensor Data</h1>
  <div class="card">
    <div class="label">Temperature</div>
    <div class="value">${temp}<span class="unit">°C</span></div>
  </div>
  <div class="card">
    <div class="label">Power</div>
    <div class="value">${power}<span class="unit">W</span></div>
  </div>
  <div class="card">
    <div class="label">Energy</div>
    <div class="value">${energy}<span class="unit">Wh</span></div>
  </div>
  <p class="footer">Last updated: ${time} · refreshes every 30s</p>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
