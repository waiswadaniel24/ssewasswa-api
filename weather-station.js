// ============================================================
// WEATHER STATION MODULE — Multi-Tenant SaaS School Portal
// Real-time dashboard, temperature/humidity/pressure/wind tracking,
// historical data charts, weather alerts for outdoor activities,
// UV index monitoring, air quality index, rain prediction,
// sports day weather planning, sensor management, data export.
// Color theme: #0ea5e9 (sky blue)
// ============================================================
// Usage in server.js:
//   const weatherStation = require('./weather-station');
//   weatherStation(app, pool, { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT });
// ============================================================

'use strict';

module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#0ea5e9', GRAY = '#6b7280';

  // -- shared CSS / breadcrumb header -------------------------------------
  const SKIP = `<link rel="stylesheet" href="/css/sk.css"><style>
    .ws-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
    .ws-nav a{padding:7px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .ws-nav a:hover{background:#e0f2fe;color:#0369a1}
    .ws-nav a.active{background:#0ea5e9;color:#fff}
    .ws-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .ws-btn:hover{opacity:.9;transform:translateY(-1px)}
    .ws-btn-primary{background:#0ea5e9;color:#fff}
    .ws-btn-success{background:#16a34a;color:#fff}
    .ws-btn-danger{background:#fee2e2;color:#dc2626}
    .ws-btn-secondary{background:#f1f5f9;color:#475569}
    .ws-btn-warning{background:#fef3c7;color:#92400e}
    .ws-table{width:100%;border-collapse:collapse;font-size:13px}
    .ws-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f0f9ff}
    .ws-table td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .ws-table tr:hover{background:#f0f9ff}
    .ws-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .ws-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .ws-filter input,.ws-filter select{padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;background:#fff}
    .ws-filter input:focus,.ws-filter select:focus{outline:none;border-color:#0ea5e9}
    .ws-card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
    .ws-fg{margin-bottom:16px}
    .ws-fg label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:6px}
    .ws-fg input,.ws-fg select,.ws-fg textarea{width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:8px;font-size:14px;background:#fff;box-sizing:border-box}
    .ws-fg input:focus,.ws-fg select:focus,.ws-fg textarea:focus{outline:none;border-color:#0ea5e9}
    .ws-fg textarea{resize:vertical;min-height:80px}
    .ws-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .ws-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
    .ws-alert{padding:12px 18px;border-radius:10px;margin-bottom:16px;font-size:13px;font-weight:500;display:flex;align-items:center;gap:10px}
    .ws-alert-danger{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
    .ws-alert-warning{background:#fffbeb;border:1px solid #fde68a;color:#92400e}
    .ws-alert-info{background:#f0f9ff;border:1px solid #bae6fd;color:#0369a1}
    .ws-alert-success{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}
    .badge{padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;display:inline-block}
    .badge-success{background:#dcfce7;color:#166534}
    .badge-warning{background:#fef3c7;color:#92400e}
    .badge-danger{background:#fee2e2;color:#991b1b}
    .badge-info{background:#e0f2fe;color:#0369a1}
    @media(max-width:768px){.ws-nav{gap:4px}.ws-nav a{padding:6px 12px;font-size:12px}.ws-row,.ws-row3{grid-template-columns:1fr}}
  </style>
  <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#0ea5e9;text-decoration:none;font-weight:600">School</a> &rsaquo; Weather Station</div>`;

  // -- navigation --------------------------------------------------------
  const nav = (active) => `<div class="ws-nav">
    <a href="/school/weather-station" class="${active === 'dash' ? 'active' : ''}">🌤 Dashboard</a>
    <a href="/school/weather-station/readings" class="${active === 'readings' ? 'active' : ''}">📊 Readings</a>
    <a href="/school/weather-station/sensors" class="${active === 'sensors' ? 'active' : ''}">📡 Sensors</a>
    <a href="/school/weather-station/alerts" class="${active === 'alerts' ? 'active' : ''}">🔔 Alerts</a>
    <a href="/school/weather-station/forecast" class="${active === 'forecast' ? 'active' : ''}">🔮 Forecast</a>
    <a href="/school/weather-station/settings" class="${active === 'settings' ? 'active' : ''}">⚙ Settings</a>
    <a href="/school/weather-station/export" class="${active === 'export' ? 'active' : ''}">📥 Export</a>
  </div>`;

  // -- helpers ------------------------------------------------------------
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const nvl = (v, fallback) => v != null && v !== '' ? v : fallback;

  // -- SVG gauge builder --------------------------------------------------
  function svgGauge(label, value, unit, maxVal, color, warningThreshold, dangerThreshold) {
    const pct = Math.min(Math.max((value || 0) / maxVal, 0), 1);
    const angle = pct * 270 - 135;
    const rad = (a) => a * Math.PI / 180;
    const cx = 80, cy = 80, r = 60;
    const ex = cx + r * Math.cos(rad(angle));
    const ey = cy + r * Math.sin(rad(angle));
    const bgColor = (warningThreshold != null && value >= warningThreshold)
      ? ((dangerThreshold != null && value >= dangerThreshold) ? '#dc2626' : '#f59e0b')
      : color;
    return `<svg width="160" height="140" viewBox="0 0 160 140">
      <path d="M 20 100 A 60 60 0 1 1 140 100" fill="none" stroke="#e5e7eb" stroke-width="10" stroke-linecap="round"/>
      <path d="M 20 100 A 60 60 0 1 1 140 100" fill="none" stroke="${bgColor}" stroke-width="10" stroke-linecap="round"
        stroke-dasharray="${pct * 283} 283" transform="rotate(135 80 80)"/>
      <text x="80" y="75" text-anchor="middle" font-size="24" font-weight="700" fill="#1e293b">${typeof value === 'number' ? value.toFixed(1) : value || '—'}</text>
      <text x="80" y="95" text-anchor="middle" font-size="11" fill="${GRAY}">${esc(unit)}</text>
      <text x="80" y="120" text-anchor="middle" font-size="12" font-weight="600" fill="#475569">${esc(label)}</text>
      ${warningThreshold != null ? `<text x="80" y="135" text-anchor="middle" font-size="9" fill="${value >= (dangerThreshold || Infinity) ? '#dc2626' : value >= warningThreshold ? '#f59e0b' : '#16a34a'}">${value >= (dangerThreshold || Infinity) ? 'DANGER' : value >= warningThreshold ? 'WARNING' : 'NORMAL'}</text>` : ''}
    </svg>`;
  }

  // -- SVG sparkline builder ----------------------------------------------
  function svgSparkline(data, color, width, height) {
    if (!data || data.length < 2) return `<svg width="${width}" height="${height}"><text x="50%" y="50%" text-anchor="middle" fill="${GRAY}" font-size="11">No data</text></svg>`;
    const w = width || 300, h = height || 80;
    const min = Math.min(...data), max = Math.max(...data);
    const range = max - min || 1;
    const pad = 4;
    const points = data.map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const areaPoints = points + ` ${(w - pad).toFixed(1)},${h - pad} ${pad},${h - pad}`;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <polygon points="${areaPoints}" fill="${color}" opacity="0.1"/>
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;
  }

  // -- SVG wind compass ---------------------------------------------------
  function svgWindCompass(direction, speed) {
    const deg = direction || 0;
    const dirLabels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const dirIdx = Math.round(deg / 45) % 8;
    const rad = (a) => (a - 90) * Math.PI / 180;
    const cx = 70, cy = 70, r = 50;
    const nx = cx + r * Math.cos(rad(deg)), ny = cy + r * Math.sin(rad(deg));
    return `<svg width="140" height="160" viewBox="0 0 140 160">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="2"/>
      <circle cx="${cx}" cy="${cy}" r="25" fill="none" stroke="#f1f5f9" stroke-width="1"/>
      <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#0ea5e9" stroke-width="3" stroke-linecap="round" marker-end="url(#arrowhead)"/>
      <defs><marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#0ea5e9"/></marker></defs>
      ${dirLabels.map((l, i) => {
        const a = i * 45 - 90;
        const lx = cx + (r + 14) * Math.cos(rad(i * 45));
        const ly = cy + (r + 14) * Math.sin(rad(i * 45));
        return `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" font-size="${l.length === 1 ? 11 : 9}" fill="${i === dirIdx ? '#0ea5e9' : '#94a3b8'}" font-weight="${i === dirIdx ? 700 : 400}">${l}</text>`;
      }).join('')}
      <text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="#1e293b">${speed != null ? speed.toFixed(1) : '—'}</text>
      <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="10" fill="${GRAY}">km/h ${dirLabels[dirIdx]}</text>
      <text x="${cx}" y="150" text-anchor="middle" font-size="11" font-weight="600" fill="#475569">Wind</text>
    </svg>`;
  }

  // -- SVG bar chart ------------------------------------------------------
  function svgBarChart(items, w, h, barColor) {
    const width = w || 400, height = h || 120;
    if (!items || items.length === 0) return `<svg width="${width}" height="${height}"><text x="50%" y="50%" text-anchor="middle" fill="${GRAY}" font-size="11">No data</text></svg>`;
    const max = Math.max(...items.map(i => i.value), 1);
    const barW = Math.max(Math.floor((width - 40) / items.length - 4), 6);
    const labels = items.map(i => esc(String(i.label).substring(0, 6)));
    const color = barColor || P;
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${items.map((item, idx) => {
        const barH = Math.max((item.value / max) * (height - 30), 2);
        const x = 20 + idx * (barW + 4);
        const y = height - 20 - barH;
        return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="${color}" opacity="0.85"/>
          <text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" font-size="9" fill="#475569">${item.value}</text>
          <text x="${x + barW / 2}" y="${height - 5}" text-anchor="middle" font-size="8" fill="${GRAY}">${labels[idx]}</text>`;
      }).join('')}
    </svg>`;
  }

  // -- UV index description -----------------------------------------------
  function uvDescription(uv) {
    if (uv == null) return { label: 'N/A', color: GRAY, advice: 'No UV data available' };
    if (uv <= 2) return { label: 'Low', color: '#16a34a', advice: 'Safe for outdoor activities. No protection needed.' };
    if (uv <= 5) return { label: 'Moderate', color: '#f59e0b', advice: 'Wear sunscreen and hats during recess.' };
    if (uv <= 7) return { label: 'High', color: '#f97316', advice: 'Reduce outdoor exposure between 10am-4pm.' };
    if (uv <= 10) return { label: 'Very High', color: '#dc2626', advice: 'Avoid prolonged outdoor activities. SPF 30+ required.' };
    return { label: 'Extreme', color: '#7c3aed', advice: 'Cancel outdoor PE. Keep students indoors.' };
  }

  // -- AQI description ----------------------------------------------------
  function aqiDescription(aqi) {
    if (aqi == null) return { label: 'N/A', color: GRAY, advice: 'No air quality data available' };
    if (aqi <= 50) return { label: 'Good', color: '#16a34a', advice: 'Air quality is satisfactory. Safe for outdoor activities.' };
    if (aqi <= 100) return { label: 'Moderate', color: '#f59e0b', advice: 'Acceptable quality. Sensitive students should limit exertion.' };
    if (aqi <= 150) return { label: 'Unhealthy (Sensitive)', color: '#f97316', advice: 'Students with asthma should stay indoors.' };
    if (aqi <= 200) return { label: 'Unhealthy', color: '#dc2626', advice: 'Limit outdoor PE. Keep windows closed.' };
    return { label: 'Very Unhealthy', color: '#7c3aed', advice: 'All outdoor activities should be cancelled.' };
  }

  // -- activity recommendation --------------------------------------------
  function activityRecommendation(reading) {
    if (!reading) return { status: 'No Data', color: GRAY, text: 'No current weather data. Please check sensors.' };
    const issues = [];
    if (reading.temperature != null && (reading.temperature > 38 || reading.temperature < 2)) issues.push('Extreme temperature');
    if (reading.wind_speed != null && reading.wind_speed > 40) issues.push('High winds');
    if (reading.uv_index != null && reading.uv_index > 10) issues.push('Extreme UV');
    if (reading.air_quality != null && reading.air_quality > 200) issues.push('Poor air quality');
    if (reading.rainfall != null && reading.rainfall > 10) issues.push('Heavy rain');
    if (issues.length === 0) {
      if (reading.temperature != null && reading.temperature < 10) return { status: 'Caution', color: '#f59e0b', text: 'Outdoor activities OK but ensure students dress warmly.' };
      if (reading.rainfall != null && reading.rainfall > 0) return { status: 'Light Rain', color: '#0ea5e9', text: 'Light rain detected. Covered activities recommended.' };
      return { status: 'All Clear', color: '#16a34a', text: 'Weather conditions are ideal for outdoor activities and sports.' };
    }
    return { status: 'Not Recommended', color: '#dc2626', text: 'Issues: ' + issues.join(', ') + '. Consider indoor alternatives.' };
  }

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS weather_readings (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        temperature NUMERIC(5,2),
        humidity NUMERIC(5,2),
        pressure NUMERIC(7,2),
        wind_speed NUMERIC(5,2),
        wind_direction INTEGER,
        uv_index NUMERIC(4,2),
        air_quality INTEGER,
        rainfall NUMERIC(6,2),
        sensor_id INTEGER,
        recorded_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS weather_alerts (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        alert_type VARCHAR(50) NOT NULL DEFAULT 'weather',
        message TEXT NOT NULL,
        severity VARCHAR(20) NOT NULL DEFAULT 'info',
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS weather_sensors (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(200) NOT NULL,
        location VARCHAR(300),
        type VARCHAR(100) NOT NULL DEFAULT 'weather',
        status VARCHAR(20) NOT NULL DEFAULT 'online',
        last_reading TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS weather_settings (
        tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        alert_threshold_temp_high NUMERIC(5,2) DEFAULT 38,
        alert_threshold_temp_low NUMERIC(5,2) DEFAULT 2,
        alert_threshold_wind NUMERIC(5,2) DEFAULT 40,
        alert_threshold_uv NUMERIC(4,2) DEFAULT 10,
        alert_threshold_aqi INTEGER DEFAULT 200,
        alert_threshold_rain NUMERIC(6,2) DEFAULT 10,
        auto_alert BOOLEAN DEFAULT true,
        display_unit_temp VARCHAR(10) DEFAULT 'C',
        display_unit_wind VARCHAR(10) DEFAULT 'km/h',
        display_unit_pressure VARCHAR(10) DEFAULT 'hPa',
        refresh_interval INTEGER DEFAULT 300,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      // Indexes
      const idxs = [
        'CREATE INDEX IF NOT EXISTS idx_wr_tenant ON weather_readings(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_wr_recorded ON weather_readings(recorded_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_wr_sensor ON weather_readings(sensor_id)',
        'CREATE INDEX IF NOT EXISTS idx_wa_tenant ON weather_alerts(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_wa_active ON weather_alerts(active)',
        'CREATE INDEX IF NOT EXISTS idx_ws_tenant ON weather_sensors(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_ws_status ON weather_sensors(status)',
      ];
      for (const sql of idxs) { try { await pool.query(sql); } catch (_) { /* ignore */ } }
      console.log('[WeatherStation] Tables ready');
    } catch (e) { console.warn('[WeatherStation] Migration warning:', e.message); }
  })();

  // ============================================================
  // ROUTE 1: GET /school/weather-station — Dashboard
  // ============================================================
  app.get('/school/weather-station', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const [latestRows, sensorRows, alertRows, hourlyTemp, hourlyHum, dailyRain, recentReadings, settingsRow] = await Promise.all([
      pool.query(`SELECT wr.*, ws.name AS sensor_name FROM weather_readings wr
        LEFT JOIN weather_sensors ws ON ws.id = wr.sensor_id AND ws.tenant_id = wr.tenant_id
        WHERE wr.tenant_id=$1 ORDER BY wr.recorded_at DESC LIMIT 1`, [tid]),
      pool.query(`SELECT * FROM weather_sensors WHERE tenant_id=$1 ORDER BY name`, [tid]),
      pool.query(`SELECT * FROM weather_alerts WHERE tenant_id=$1 AND active=true ORDER BY created_at DESC LIMIT 5`, [tid]),
      pool.query(`SELECT temperature, EXTRACT(HOUR FROM recorded_at) AS hr
        FROM weather_readings WHERE tenant_id=$1 AND recorded_at >= NOW() - INTERVAL '24 hours'
        ORDER BY recorded_at ASC`, [tid]),
      pool.query(`SELECT humidity, EXTRACT(HOUR FROM recorded_at) AS hr
        FROM weather_readings WHERE tenant_id=$1 AND recorded_at >= NOW() - INTERVAL '24 hours'
        ORDER BY recorded_at ASC`, [tid]),
      pool.query(`SELECT DATE(recorded_at) AS day, SUM(COALESCE(rainfall,0)) AS total_rain
        FROM weather_readings WHERE tenant_id=$1 AND recorded_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(recorded_at) ORDER BY day ASC`, [tid]),
      pool.query(`SELECT wr.*, ws.name AS sensor_name FROM weather_readings wr
        LEFT JOIN weather_sensors ws ON ws.id = wr.sensor_id AND ws.tenant_id = wr.tenant_id
        WHERE wr.tenant_id=$1 ORDER BY wr.recorded_at DESC LIMIT 10`, [tid]),
      pool.query(`SELECT * FROM weather_settings WHERE tenant_id=$1`, [tid]),
    ]);

    const latest = latestRows.rows[0];
    const sensors = sensorRows.rows;
    const activeAlerts = alertRows.rows;
    const settings = settingsRow.rows[0];

    const onlineSensors = sensors.filter(s => s.status === 'online').length;
    const rec = activityRecommendation(latest);
    const uv = uvDescription(latest?.uv_index);
    const aqi = aqiDescription(latest?.air_quality);

    // Alerts banner
    const alertsHtml = activeAlerts.length > 0
      ? activeAlerts.map(a => {
          const cls = a.severity === 'critical' ? 'ws-alert-danger' : a.severity === 'warning' ? 'ws-alert-warning' : 'ws-alert-info';
          const icon = a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟡' : '🔵';
          return `<div class="ws-alert ${cls}">${icon} <div><strong>${esc(a.alert_type)}</strong>: ${esc(a.message)}</div>
            <span style="font-size:11px;color:${GRAY}">${fmtDateTime(a.created_at)}</span></div>`;
        }).join('')
      : '<div class="ws-alert ws-alert-success">✅ No active weather alerts. Conditions are being monitored.</div>';

    // Gauges row
    const gaugesHtml = `<div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-bottom:20px">
      ${svgGauge('Temperature', latest?.temperature, (settings?.display_unit_temp || '°C'), 50, P, settings?.alert_threshold_temp_high, 45)}
      ${svgGauge('Humidity', latest?.humidity, '%', 100, '#06b6d4', 85, 95)}
      ${svgGauge('Pressure', latest?.pressure, (settings?.display_unit_pressure || 'hPa'), 1100, '#8b5cf6', null, null)}
      ${svgWindCompass(latest?.wind_direction, latest?.wind_speed)}
    </div>`;

    // UV & AQI cards
    const uvAqiHtml = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      <div class="ws-card" style="border-left:4px solid ${uv.color}">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="font-size:36px">☀️</div>
          <div style="flex:1">
            <div style="font-size:12px;color:${GRAY};text-transform:uppercase;font-weight:700;letter-spacing:.5px">UV Index</div>
            <div style="font-size:28px;font-weight:700;color:#1e293b">${latest?.uv_index != null ? latest.uv_index.toFixed(1) : '—'}</div>
            <span class="badge" style="background:${uv.color}20;color:${uv.color}">${uv.label}</span>
          </div>
        </div>
        <div style="margin-top:10px;font-size:12px;color:${GRAY}">${uv.advice}</div>
      </div>
      <div class="ws-card" style="border-left:4px solid ${aqi.color}">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="font-size:36px">🌬</div>
          <div style="flex:1">
            <div style="font-size:12px;color:${GRAY};text-transform:uppercase;font-weight:700;letter-spacing:.5px">Air Quality (AQI)</div>
            <div style="font-size:28px;font-weight:700;color:#1e293b">${latest?.air_quality ?? '—'}</div>
            <span class="badge" style="background:${aqi.color}20;color:${aqi.color}">${aqi.label}</span>
          </div>
        </div>
        <div style="margin-top:10px;font-size:12px;color:${GRAY}">${aqi.advice}</div>
      </div>
    </div>`;

    // Activity recommendation
    const recHtml = `<div class="ws-card" style="border-left:4px solid ${rec.color};margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-size:28px">${rec.status === 'All Clear' ? '🏃' : rec.status === 'Not Recommended' ? '🚫' : '⚠️'}</div>
        <div>
          <div style="font-size:14px;font-weight:700;color:#1e293b">Outdoor Activity Status: <span style="color:${rec.color}">${rec.status}</span></div>
          <div style="font-size:13px;color:${GRAY}">${rec.text}</div>
        </div>
      </div>
    </div>`;

    // Sparklines
    const tempSparkline = svgSparkline(hourlyTemp.rows.map(r => r.temperature).filter(v => v != null), P, 380, 80);
    const humSparkline = svgSparkline(hourlyHum.rows.map(r => r.humidity).filter(v => v != null), '#06b6d4', 380, 80);
    const rainBars = svgBarChart(
      dailyRain.rows.map(r => ({ label: String(r.day || '').substring(5, 10), value: parseFloat(r.total_rain || 0).toFixed(1) })),
      380, 100, '#3b82f6'
    );

    // Recent readings table
    const readingsHtml = recentReadings.rows.length > 0
      ? `<table class="ws-table"><thead><tr><th>Time</th><th>Sensor</th><th>Temp</th><th>Humidity</th><th>Wind</th><th>UV</th><th>AQI</th><th>Rain</th></tr></thead>
         <tbody>${recentReadings.rows.map(r => `<tr>
           <td>${fmtDateTime(r.recorded_at)}</td>
           <td>${esc(r.sensor_name || 'Sensor #' + (r.sensor_id || '—'))}</td>
           <td>${r.temperature != null ? r.temperature.toFixed(1) + '°C' : '—'}</td>
           <td>${r.humidity != null ? r.humidity.toFixed(1) + '%' : '—'}</td>
           <td>${r.wind_speed != null ? r.wind_speed.toFixed(1) + ' km/h' : '—'}</td>
           <td>${r.uv_index != null ? r.uv_index.toFixed(1) : '—'}</td>
           <td>${r.air_quality ?? '—'}</td>
           <td>${r.rainfall != null ? r.rainfall.toFixed(1) + ' mm' : '—'}</td>
         </tr>`).join('')}</tbody></table>`
      : '<p style="text-align:center;color:#94a3b8;padding:20px">No readings yet. Connect sensors to begin collecting data.</p>';

    // Sensors status
    const sensorsHtml = sensors.length > 0
      ? sensors.map(s => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9">
          <div style="width:10px;height:10px;border-radius:50%;background:${s.status === 'online' ? '#16a34a' : s.status === 'warning' ? '#f59e0b' : '#dc2626'}"></div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;color:#1e293b">${esc(s.name)}</div>
            <div style="font-size:11px;color:${GRAY}">${esc(s.location || 'No location')} · ${esc(s.type)}</div>
          </div>
          <span class="badge ${s.status === 'online' ? 'badge-success' : s.status === 'warning' ? 'badge-warning' : 'badge-danger'}">${s.status}</span>
        </div>`).join('')
      : '<p style="text-align:center;color:#94a3b8;padding:20px">No sensors configured.</p>';

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🌤 Weather Station</h1>
          <p style="font-size:13px;color:${GRAY};margin-top:2px">Real-time weather monitoring for school grounds</p></div>
        <div style="display:flex;gap:8px">
          <a href="/school/weather-station/sensors" class="ws-btn ws-btn-secondary">📡 Manage Sensors</a>
          <a href="/school/weather-station/alerts" class="ws-btn ws-btn-secondary">🔔 Alerts (${activeAlerts.length})</a>
        </div>
      </div>

      ${alertsHtml}

      <!-- Stats -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px">
        <div class="ws-card" style="text-align:center;padding:16px">
          <div style="font-size:28px;font-weight:700;color:${P}">${sensors.length}</div>
          <div style="font-size:11px;color:${GRAY};text-transform:uppercase;letter-spacing:.5px">Sensors</div>
          <div style="font-size:11px;color:#16a34a">${onlineSensors} online</div>
        </div>
        <div class="ws-card" style="text-align:center;padding:16px">
          <div style="font-size:28px;font-weight:700;color:#16a34a">${rec.status === 'All Clear' ? '✅' : rec.status === 'Not Recommended' ? '🚫' : '⚠️'}</div>
          <div style="font-size:11px;color:${GRAY};text-transform:uppercase;letter-spacing:.5px">Activities</div>
          <div style="font-size:11px;color:${rec.color}">${rec.status}</div>
        </div>
        <div class="ws-card" style="text-align:center;padding:16px">
          <div style="font-size:28px;font-weight:700;color:#f59e0b">${activeAlerts.length}</div>
          <div style="font-size:11px;color:${GRAY};text-transform:uppercase;letter-spacing:.5px">Active Alerts</div>
        </div>
        <div class="ws-card" style="text-align:center;padding:16px">
          <div style="font-size:28px;font-weight:700;color:#8b5cf6">${latest ? fmtTime(latest.recorded_at) : '—'}</div>
          <div style="font-size:11px;color:${GRAY};text-transform:uppercase;letter-spacing:.5px">Last Update</div>
        </div>
      </div>

      ${gaugesHtml}
      ${uvAqiHtml}
      ${recHtml}

      <!-- Charts row -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="ws-card">
          <h3 style="font-size:14px;color:#1e293b;margin:0 0 12px">🌡 Temperature (24h)</h3>
          <div style="text-align:center">${tempSparkline}</div>
        </div>
        <div class="ws-card">
          <h3 style="font-size:14px;color:#1e293b;margin:0 0 12px">💧 Humidity (24h)</h3>
          <div style="text-align:center">${humSparkline}</div>
        </div>
      </div>
      <div class="ws-card" style="margin-bottom:20px">
        <h3 style="font-size:14px;color:#1e293b;margin:0 0 12px">🌧 Rainfall (7 days)</h3>
        <div style="text-align:center">${rainBars}</div>
      </div>

      <!-- Recent readings & sensors -->
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px">
        <div class="ws-card">
          <h3 style="font-size:14px;color:#1e293b;margin:0 0 12px">📊 Recent Readings</h3>
          <div style="overflow-x:auto">${readingsHtml}</div>
        </div>
        <div class="ws-card">
          <h3 style="font-size:14px;color:#1e293b;margin:0 0 12px">📡 Sensor Status</h3>
          ${sensorsHtml}
        </div>
      </div>

      <!-- Sports Day Planning -->
      <div class="ws-card" style="border-left:4px solid ${rec.color}">
        <h3 style="font-size:14px;color:#1e293b;margin:0 0 8px">🏅 Sports Day Weather Assessment</h3>
        <p style="font-size:13px;color:${GRAY};margin:0">
          ${latest ? `Current: ${latest.temperature != null ? latest.temperature.toFixed(1) + '°C' : '—'}, Humidity: ${latest.humidity != null ? latest.humidity.toFixed(1) + '%' : '—'}, Wind: ${latest.wind_speed != null ? latest.wind_speed.toFixed(1) + ' km/h' : '—'}, UV: ${uv.label}, AQI: ${aqi.label}. ${rec.text}` : 'No data available for assessment.'}
        </p>
      </div>
    </div>`;
    res.send(renderPage('Weather Station', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /school/weather-station/readings — History
  // ============================================================
  app.get('/school/weather-station/readings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const dateFrom = req.query.from || today();
    const dateTo = req.query.to || today();
    const sensorFilter = req.query.sensor || '';
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    let sql = `SELECT wr.*, ws.name AS sensor_name FROM weather_readings wr
      LEFT JOIN weather_sensors ws ON ws.id = wr.sensor_id AND ws.tenant_id = wr.tenant_id
      WHERE wr.tenant_id=$1`;
    const params = [tid];
    let pi = 2;
    if (dateFrom) { sql += ` AND wr.recorded_at >= $${pi}::date`; params.push(dateFrom); pi++; }
    if (dateTo) { sql += ` AND wr.recorded_at < ($${pi}::date + INTERVAL '1 day')`; params.push(dateTo); pi++; }
    if (sensorFilter) { sql += ` AND wr.sensor_id = $${pi}`; params.push(parseInt(sensorFilter)); pi++; }
    sql += ` ORDER BY wr.recorded_at DESC LIMIT $${pi} OFFSET $${pi + 1}`;
    params.push(limit, offset);

    const [readings, countResult, sensors] = await Promise.all([
      pool.query(sql, params),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM weather_readings WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT id, name FROM weather_sensors WHERE tenant_id=$1 ORDER BY name`, [tid]),
    ]);

    const total = countResult.rows[0].cnt;
    const totalPages = Math.ceil(total / limit);

    // Chart data
    const chartData = await pool.query(`SELECT wr.temperature, wr.humidity, wr.pressure, wr.wind_speed, wr.uv_index, wr.air_quality, wr.recorded_at
      FROM weather_readings wr WHERE wr.tenant_id=$1 ${dateFrom ? 'AND wr.recorded_at >= $2::date' : ''}
      ORDER BY wr.recorded_at ASC`, dateFrom ? [tid, dateFrom] : [tid]);

    const tempChart = svgSparkline(chartData.rows.map(r => r.temperature).filter(v => v != null), P, 700, 80);
    const humChart = svgSparkline(chartData.rows.map(r => r.humidity).filter(v => v != null), '#06b6d4', 700, 80);

    const rowsHtml = readings.rows.map(r => `<tr>
      <td style="white-space:nowrap">${fmtDateTime(r.recorded_at)}</td>
      <td>${esc(r.sensor_name || 'Sensor #' + (r.sensor_id || '—'))}</td>
      <td><span style="font-weight:600;color:${r.temperature != null && (r.temperature > 38 || r.temperature < 2) ? '#dc2626' : '#1e293b'}">${r.temperature != null ? r.temperature.toFixed(1) + '°C' : '—'}</span></td>
      <td>${r.humidity != null ? r.humidity.toFixed(1) + '%' : '—'}</td>
      <td>${r.pressure != null ? r.pressure.toFixed(1) + ' hPa' : '—'}</td>
      <td>${r.wind_speed != null ? r.wind_speed.toFixed(1) + ' km/h' : '—'}</td>
      <td>${r.wind_direction != null ? r.wind_direction + '°' : '—'}</td>
      <td><span class="badge" style="background:${uvDescription(r.uv_index).color}20;color:${uvDescription(r.uv_index).color}">${r.uv_index != null ? r.uv_index.toFixed(1) : '—'}</span></td>
      <td><span class="badge" style="background:${aqiDescription(r.air_quality).color}20;color:${aqiDescription(r.air_quality).color}">${r.air_quality ?? '—'}</span></td>
      <td>${r.rainfall != null ? r.rainfall.toFixed(1) + ' mm' : '—'}</td>
    </tr>`).join('');

    const pagination = totalPages > 1 ? `<div style="display:flex;gap:6px;justify-content:center;margin-top:16px">
      ${Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map(p =>
        `<a href="/school/weather-station/readings?page=${p}&from=${esc(dateFrom)}&to=${esc(dateTo)}${sensorFilter ? '&sensor=' + sensorFilter : ''}"
          class="ws-btn ${p === page ? 'ws-btn-primary' : 'ws-btn-secondary'}" style="padding:6px 12px;font-size:12px">${p}</a>`
      ).join('')}</div>` : '';

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">
      ${nav('readings')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:4px">📊 Weather Readings History</h1>
      <p style="font-size:13px;color:${GRAY};margin-bottom:20px">${total} total readings</p>

      <div class="ws-filter">
        <form method="GET" style="display:flex;gap:8px;flex-wrap:wrap">
          <div><label>From</label><input type="date" name="from" value="${esc(dateFrom)}"></div>
          <div><label>To</label><input type="date" name="to" value="${esc(dateTo)}"></div>
          <div><label>Sensor</label><select name="sensor">
            <option value="">All Sensors</option>
            ${sensors.rows.map(s => `<option value="${s.id}" ${sensorFilter == s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select></div>
          <div style="align-self:end"><button type="submit" class="ws-btn ws-btn-primary">Filter</button></div>
          ${(dateFrom !== today() || dateTo !== today() || sensorFilter) ? '<a href="/school/weather-station/readings" class="ws-btn ws-btn-secondary" style="align-self:end">Clear</a>' : ''}
        </form>
      </div>

      <div class="ws-card"><h3 style="font-size:14px;color:#1e293b;margin:0 0 12px">Temperature Trend</h3>${tempChart}</div>
      <div class="ws-card"><h3 style="font-size:14px;color:#1e293b;margin:0 0 12px">Humidity Trend</h3>${humChart}</div>

      <div class="ws-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="ws-table">
            <thead><tr><th>Time</th><th>Sensor</th><th>Temp</th><th>Humidity</th><th>Pressure</th><th>Wind</th><th>Direction</th><th>UV</th><th>AQI</th><th>Rain</th></tr></thead>
            <tbody>${rowsHtml || `<tr><td colspan="10" style="text-align:center;color:#94a3b8;padding:40px">No readings found for this period.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      ${pagination}
    </div>`;
    res.send(renderPage('Weather Readings', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: GET /school/weather-station/sensors — Sensor list
  // ============================================================
  app.get('/school/weather-station/sensors', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const sensors = (await pool.query(`SELECT ws.*,
      (SELECT COUNT(*)::int FROM weather_readings wr WHERE wr.sensor_id = ws.id AND wr.tenant_id = ws.tenant_id) AS reading_count,
      (SELECT temperature FROM weather_readings wr WHERE wr.sensor_id = ws.id AND wr.tenant_id = ws.tenant_id ORDER BY wr.recorded_at DESC LIMIT 1) AS last_temp
      FROM weather_sensors ws WHERE ws.tenant_id=$1 ORDER BY ws.name`, [tid])).rows;

    const rowsHtml = sensors.map(s => `<tr>
      <td><strong>${esc(s.name)}</strong></td>
      <td>${esc(s.location || '—')}</td>
      <td>${esc(s.type)}</td>
      <td><span class="badge ${s.status === 'online' ? 'badge-success' : s.status === 'warning' ? 'badge-warning' : 'badge-danger'}">${s.status}</span></td>
      <td>${s.last_temp != null ? s.last_temp.toFixed(1) + '°C' : '—'}</td>
      <td>${s.reading_count || 0}</td>
      <td>${fmtDateTime(s.last_reading)}</td>
      <td>
        <a href="/school/weather-station/sensors/${s.id}" class="ws-btn ws-btn-secondary" style="padding:4px 10px;font-size:11px">Edit</a>
        <form method="POST" action="/school/weather-station/sensors/${s.id}/delete" style="display:inline"
          onsubmit="return confirm('Delete sensor ${esc(s.name)}?')">
          <button class="ws-btn ws-btn-danger" style="padding:4px 10px;font-size:11px">Delete</button>
        </form>
      </td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">
      ${nav('sensors')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📡 Weather Sensors</h1>
          <p style="font-size:13px;color:${GRAY};margin-top:2px">${sensors.length} sensors configured</p></div>
        <a href="/school/weather-station/sensors/new" class="ws-btn ws-btn-primary">➕ Add Sensor</a>
      </div>

      <div class="ws-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="ws-table">
            <thead><tr><th>Name</th><th>Location</th><th>Type</th><th>Status</th><th>Last Temp</th><th>Readings</th><th>Last Reading</th><th>Actions</th></tr></thead>
            <tbody>${rowsHtml || `<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">No sensors configured yet. <a href="/school/weather-station/sensors/new">Add your first sensor</a>.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Weather Sensors', html, user, req));
  }));

  // ============================================================
  // ROUTE 4: GET /school/weather-station/sensors/new — Add sensor form
  // ============================================================
  app.get('/school/weather-station/sensors/new', requireAuth, requireNotBanned, (req, res) => {
    const user = req.session.user;
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">
      ${nav('sensors')}
      <a href="/school/weather-station/sensors" style="color:${GRAY};font-size:13px;text-decoration:none">← Back to Sensors</a>
      <h1 style="font-size:24px;color:#1e293b;margin:12px 0 20px">➕ Add Weather Sensor</h1>
      <div class="ws-card">
        <form method="POST" action="/school/weather-station/sensors">
          <div class="ws-fg"><label>Sensor Name *</label>
            <input type="text" name="name" required placeholder="e.g. Rooftop Weather Station"></div>
          <div class="ws-fg"><label>Location</label>
            <input type="text" name="location" placeholder="e.g. Main Building Rooftop"></div>
          <div class="ws-row">
            <div class="ws-fg"><label>Type</label>
              <select name="type">
                <option value="weather">Weather Station (All-in-one)</option>
                <option value="temperature">Temperature Only</option>
                <option value="humidity">Humidity Only</option>
                <option value="wind">Wind Speed/Direction</option>
                <option value="uv">UV Index Sensor</option>
                <option value="aqi">Air Quality Monitor</option>
                <option value="rain">Rain Gauge</option>
                <option value="pressure">Barometric Pressure</option>
              </select></div>
            <div class="ws-fg"><label>Initial Status</label>
              <select name="status">
                <option value="online">Online</option>
                <option value="offline">Offline</option>
                <option value="warning">Warning</option>
              </select></div>
          </div>
          <div style="display:flex;gap:10px;margin-top:20px">
            <button type="submit" class="ws-btn ws-btn-primary">Save Sensor</button>
            <a href="/school/weather-station/sensors" class="ws-btn ws-btn-secondary">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Add Sensor', html, user, req));
  });

  // ============================================================
  // ROUTE 5: POST /school/weather-station/sensors — Create sensor
  // ============================================================
  app.post('/school/weather-station/sensors', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, location, type, status } = req.body;
    if (!name || !name.trim()) {
      return res.send(renderPage('Error', '<div class="ws-card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Sensor name is required</h2><a href="/school/weather-station/sensors/new" class="ws-btn ws-btn-primary" style="margin-top:12px">← Back</a></div>', user, req));
    }
    await pool.query(`INSERT INTO weather_sensors (tenant_id, name, location, type, status) VALUES ($1,$2,$3,$4,$5)`,
      [tid, name.trim(), location || null, type || 'weather', status || 'online']);
    audit && audit(user, 'create_sensor', { name: name.trim() });
    res.redirect('/school/weather-station/sensors');
  }));

  // ============================================================
  // ROUTE 6: GET /school/weather-station/sensors/:id — Edit sensor
  // ============================================================
  app.get('/school/weather-station/sensors/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, sid = req.params.id;
    const sensor = (await pool.query(`SELECT * FROM weather_sensors WHERE id=$1 AND tenant_id=$2`, [sid, tid])).rows[0];
    if (!sensor) {
      return res.send(renderPage('Not Found', '<div class="ws-card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Sensor not found</h2><a href="/school/weather-station/sensors" class="ws-btn ws-btn-primary" style="margin-top:12px">← Back</a></div>', user, req));
    }
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">
      ${nav('sensors')}
      <a href="/school/weather-station/sensors" style="color:${GRAY};font-size:13px;text-decoration:none">← Back to Sensors</a>
      <h1 style="font-size:24px;color:#1e293b;margin:12px 0 20px">✏️ Edit Sensor: ${esc(sensor.name)}</h1>
      <div class="ws-card">
        <form method="POST" action="/school/weather-station/sensors/${sid}">
          <div class="ws-fg"><label>Sensor Name *</label>
            <input type="text" name="name" required value="${esc(sensor.name)}"></div>
          <div class="ws-fg"><label>Location</label>
            <input type="text" name="location" value="${esc(sensor.location || '')}"></div>
          <div class="ws-row">
            <div class="ws-fg"><label>Type</label>
              <select name="type">
                ${['weather','temperature','humidity','wind','uv','aqi','rain','pressure'].map(t =>
                  `<option value="${t}" ${sensor.type === t ? 'selected' : ''}>${t}</option>`).join('')}
              </select></div>
            <div class="ws-fg"><label>Status</label>
              <select name="status">
                ${['online','offline','warning'].map(s =>
                  `<option value="${s}" ${sensor.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select></div>
          </div>
          <div style="display:flex;gap:10px;margin-top:20px">
            <button type="submit" class="ws-btn ws-btn-primary">Update Sensor</button>
            <a href="/school/weather-station/sensors" class="ws-btn ws-btn-secondary">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Edit Sensor', html, user, req));
  }));

  // ============================================================
  // ROUTE 7: POST /school/weather-station/sensors/:id — Update sensor
  // ============================================================
  app.post('/school/weather-station/sensors/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, sid = req.params.id;
    const { name, location, type, status } = req.body;
    if (!name || !name.trim()) {
      return res.send(renderPage('Error', '<div class="ws-card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Name is required</h2><a href="javascript:history.back()" class="ws-btn ws-btn-primary" style="margin-top:12px">← Back</a></div>', user, req));
    }
    await pool.query(`UPDATE weather_sensors SET name=$1, location=$2, type=$3, status=$4 WHERE id=$5 AND tenant_id=$6`,
      [name.trim(), location || null, type || 'weather', status || 'online', sid, tid]);
    audit && audit(user, 'update_sensor', { sensor_id: sid, name: name.trim() });
    res.redirect('/school/weather-station/sensors');
  }));

  // ============================================================
  // ROUTE 8: POST /school/weather-station/sensors/:id/delete
  // ============================================================
  app.post('/school/weather-station/sensors/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, sid = req.params.id;
    await pool.query(`DELETE FROM weather_readings WHERE sensor_id=$1 AND tenant_id=$2`, [sid, tid]);
    await pool.query(`DELETE FROM weather_sensors WHERE id=$1 AND tenant_id=$2`, [sid, tid]);
    audit && audit(user, 'delete_sensor', { sensor_id: sid });
    res.redirect('/school/weather-station/sensors');
  }));

  // ============================================================
  // ROUTE 9: GET /school/weather-station/alerts — Alerts list
  // ============================================================
  app.get('/school/weather-station/alerts', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const showAll = req.query.all === '1';

    const alerts = (await pool.query(
      `SELECT * FROM weather_alerts WHERE tenant_id=$1 ${showAll ? '' : 'AND active=true'} ORDER BY created_at DESC LIMIT 100`,
      [tid]
    )).rows;

    const rowsHtml = alerts.map(a => `<tr>
      <td><span class="badge ${a.severity === 'critical' ? 'badge-danger' : a.severity === 'warning' ? 'badge-warning' : 'badge-info'}">${esc(a.severity)}</span></td>
      <td>${esc(a.alert_type)}</td>
      <td style="max-width:300px">${esc(a.message)}</td>
      <td><span class="badge ${a.active ? 'badge-success' : 'badge-warning'}">${a.active ? 'Active' : 'Resolved'}</span></td>
      <td style="white-space:nowrap">${fmtDateTime(a.created_at)}</td>
      <td>
        <form method="POST" action="/school/weather-station/alerts/${a.id}/toggle" style="display:inline">
          <button class="ws-btn ${a.active ? 'ws-btn-warning' : 'ws-btn-success'}" style="padding:4px 10px;font-size:11px">${a.active ? 'Resolve' : 'Reactivate'}</button>
        </form>
        <form method="POST" action="/school/weather-station/alerts/${a.id}/delete" style="display:inline"
          onsubmit="return confirm('Delete this alert?')">
          <button class="ws-btn ws-btn-danger" style="padding:4px 10px;font-size:11px">Delete</button>
        </form>
      </td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">
      ${nav('alerts')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🔔 Weather Alerts</h1>
          <p style="font-size:13px;color:${GRAY};margin-top:2px">${alerts.filter(a => a.active).length} active alerts</p></div>
        <div style="display:flex;gap:8px">
          <a href="/school/weather-station/alerts?all=1" class="ws-btn ws-btn-secondary">${showAll ? 'Active Only' : 'Show All'}</a>
          <button class="ws-btn ws-btn-primary" onclick="document.getElementById('newAlertForm').style.display='block'">➕ New Alert</button>
        </div>
      </div>

      <div id="newAlertForm" style="display:none" class="ws-card" style="margin-bottom:16px">
        <h3 style="font-size:14px;color:#1e293b;margin:0 0 12px">Create Weather Alert</h3>
        <form method="POST" action="/school/weather-station/alerts">
          <div class="ws-row">
            <div class="ws-fg"><label>Alert Type</label>
              <select name="alert_type">
                <option value="heat">Heat Warning</option>
                <option value="cold">Cold Warning</option>
                <option value="wind">Wind Warning</option>
                <option value="uv">UV Warning</option>
                <option value="aqi">Air Quality Warning</option>
                <option value="rain">Rain Warning</option>
                <option value="storm">Storm Warning</option>
                <option value="general">General</option>
              </select></div>
            <div class="ws-fg"><label>Severity</label>
              <select name="severity">
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select></div>
          </div>
          <div class="ws-fg"><label>Message *</label>
            <textarea name="message" required placeholder="Describe the weather alert..."></textarea></div>
          <div style="display:flex;gap:10px;margin-top:12px">
            <button type="submit" class="ws-btn ws-btn-primary">Create Alert</button>
            <button type="button" class="ws-btn ws-btn-secondary" onclick="document.getElementById('newAlertForm').style.display='none'">Cancel</button>
          </div>
        </form>
      </div>

      <div class="ws-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="ws-table">
            <thead><tr><th>Severity</th><th>Type</th><th>Message</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>${rowsHtml || `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:40px">No alerts found.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Weather Alerts', html, user, req));
  }));

  // ============================================================
  // ROUTE 10: POST /school/weather-station/alerts — Create alert
  // ============================================================
  app.post('/school/weather-station/alerts', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { alert_type, message, severity } = req.body;
    if (!message || !message.trim()) {
      return res.send(renderPage('Error', '<div class="ws-card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Alert message is required</h2><a href="/school/weather-station/alerts" class="ws-btn ws-btn-primary" style="margin-top:12px">← Back</a></div>', user, req));
    }
    await pool.query(`INSERT INTO weather_alerts (tenant_id, alert_type, message, severity, active) VALUES ($1,$2,$3,$4,true)`,
      [tid, alert_type || 'general', message.trim(), severity || 'info']);
    audit && audit(user, 'create_alert', { alert_type, severity });
    if (severity === 'critical' && queueEmail) {
      queueEmail({ to: 'admin@school', subject: `⚠️ ${alert_type} Alert`, body: message.trim() });
    }
    res.redirect('/school/weather-station/alerts');
  }));

  // ============================================================
  // ROUTE 11: POST /school/weather-station/alerts/:id/toggle
  // ============================================================
  app.post('/school/weather-station/alerts/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, aid = req.params.id;
    await pool.query(`UPDATE weather_alerts SET active = NOT active WHERE id=$1 AND tenant_id=$2`, [aid, tid]);
    audit && audit(user, 'toggle_alert', { alert_id: aid });
    res.redirect('/school/weather-station/alerts');
  }));

  // ============================================================
  // ROUTE 12: POST /school/weather-station/alerts/:id/delete
  // ============================================================
  app.post('/school/weather-station/alerts/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, aid = req.params.id;
    await pool.query(`DELETE FROM weather_alerts WHERE id=$1 AND tenant_id=$2`, [aid, tid]);
    audit && audit(user, 'delete_alert', { alert_id: aid });
    res.redirect('/school/weather-station/alerts');
  }));

  // ============================================================
  // ROUTE 13: GET /school/weather-station/forecast — Forecast view
  // ============================================================
  app.get('/school/weather-station/forecast', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Gather historical data for prediction simulation
    const [recent7, recent30, sensors, activeAlerts] = await Promise.all([
      pool.query(`SELECT DATE(recorded_at) AS day,
        AVG(temperature) AS avg_temp, MIN(temperature) AS min_temp, MAX(temperature) AS max_temp,
        AVG(humidity) AS avg_hum, AVG(wind_speed) AS avg_wind, SUM(COALESCE(rainfall,0)) AS total_rain,
        AVG(uv_index) AS avg_uv, AVG(air_quality) AS avg_aqi
        FROM weather_readings WHERE tenant_id=$1 AND recorded_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(recorded_at) ORDER BY day`, [tid]),
      pool.query(`SELECT DATE(recorded_at) AS day,
        AVG(temperature) AS avg_temp, MIN(temperature) AS min_temp, MAX(temperature) AS max_temp,
        AVG(humidity) AS avg_hum
        FROM weather_readings WHERE tenant_id=$1 AND recorded_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(recorded_at) ORDER BY day`, [tid]),
      pool.query(`SELECT id, name, status FROM weather_sensors WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT * FROM weather_alerts WHERE tenant_id=$1 AND active=true`, [tid]),
    ]);

    const days7 = recent7.rows;
    const days30 = recent30.rows;

    // Simple trend analysis
    const tempTrend = days7.length >= 3
      ? (days7[days7.length - 1].avg_temp > days7[0].avg_temp + 2 ? 'Rising ↗️' :
         days7[days7.length - 1].avg_temp < days7[0].avg_temp - 2 ? 'Falling ↘️' : 'Stable ➡️')
      : 'Insufficient data';
    const humTrend = days7.length >= 3
      ? (days7[days7.length - 1].avg_hum > days7[0].avg_hum + 5 ? 'Increasing ↗️' :
         days7[days7.length - 1].avg_hum < days7[0].avg_hum - 5 ? 'Decreasing ↘️' : 'Stable ➡️')
      : 'Insufficient data';

    // Predicted next 3 days (simple moving average with some randomness)
    const avgTemp7 = days7.length > 0 ? days7.reduce((s, d) => s + parseFloat(d.avg_temp || 0), 0) / days7.length : null;
    const avgHum7 = days7.length > 0 ? days7.reduce((s, d) => s + parseFloat(d.avg_hum || 0), 0) / days7.length : null;
    const avgWind7 = days7.length > 0 ? days7.reduce((s, d) => s + parseFloat(d.avg_wind || 0), 0) / days7.length : null;
    const avgRain7 = days7.length > 0 ? days7.reduce((s, d) => s + parseFloat(d.total_rain || 0), 0) / days7.length : 0;

    const forecastDays = [];
    for (let i = 1; i <= 5; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const dayName = d.toLocaleDateString('en-GB', { weekday: 'short' });
      const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const variance = (Math.random() - 0.5) * 4;
      const predTemp = avgTemp7 != null ? (avgTemp7 + variance + i * 0.3).toFixed(1) : null;
      const predHum = avgHum7 != null ? Math.min(100, Math.max(10, avgHum7 + (Math.random() - 0.5) * 10)).toFixed(0) : null;
      const predWind = avgWind7 != null ? Math.max(0, avgWind7 + (Math.random() - 0.5) * 8).toFixed(1) : null;
      const rainProb = avgRain7 > 2 ? Math.min(95, 40 + avgRain7 * 8 + (Math.random() - 0.5) * 20).toFixed(0) : Math.max(5, (Math.random() * 30)).toFixed(0);
      forecastDays.push({ dayName, dateStr, temp: predTemp, hum: predHum, wind: predWind, rainProb });
    }

    // Sports day recommendation
    const sportsRecommendation = days7.length > 0
      ? (() => {
          const avgT = parseFloat(days7[days7.length - 1].avg_temp || 20);
          const avgR = parseFloat(days7[days7.length - 1].total_rain || 0);
          const avgW = parseFloat(days7[days7.length - 1].avg_wind || 10);
          if (avgR > 5) return { status: 'Not Ideal', color: '#dc2626', text: 'Recent rainfall makes fields wet. Consider indoor alternatives or postpone.' };
          if (avgT > 35 || avgT < 5) return { status: 'Not Recommended', color: '#f59e0b', text: `Temperature forecast around ${avgT.toFixed(1)}°C. ${avgT > 35 ? 'Heat risk — schedule early morning.' : 'Too cold — consider indoor activities.'}` };
          if (avgW > 30) return { status: 'Caution', color: '#f97316', text: 'High wind speeds expected. Avoid activities with airborne equipment.' };
          return { status: 'Good Conditions', color: '#16a34a', text: `Forecast: ${avgT.toFixed(1)}°C, low rain, moderate wind. Great for outdoor sports!` };
        })()
      : { status: 'No Data', color: GRAY, text: 'Not enough historical data for sports day forecast.' };

    const tempChart = svgSparkline(days30.rows.map(r => parseFloat(r.avg_temp)).filter(v => v != null), P, 700, 100);
    const minMaxChart = days7.length > 0 ? svgBarChart(
      days7.map(d => ({ label: String(d.day || '').substring(5, 10), value: parseFloat(d.max_temp || 0).toFixed(1) })),
      350, 90, '#f59e0b'
    ) : '';

    const forecastHtml = forecastDays.map(f => `<div class="ws-card" style="text-align:center;padding:14px;flex:1;min-width:120px">
      <div style="font-size:12px;font-weight:700;color:${GRAY}">${f.dayName}</div>
      <div style="font-size:11px;color:${GRAY}">${f.dateStr}</div>
      <div style="font-size:22px;font-weight:700;color:#1e293b;margin:8px 0">${f.temp != null ? f.temp + '°C' : '—'}</div>
      <div style="font-size:11px;color:${GRAY}">💧 ${f.hum || '—'}% · 💨 ${f.wind || '—'} km/h</div>
      <div style="font-size:11px;color:${parseInt(f.rainProb) > 60 ? '#3b82f6' : '#16a34a'};margin-top:4px">🌧 ${f.rainProb}% rain</div>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">
      ${nav('forecast')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:4px">🔮 Weather Forecast & Planning</h1>
      <p style="font-size:13px;color:${GRAY};margin-bottom:20px">Based on ${days7.length} days of sensor data</p>

      <!-- Sports Day Assessment -->
      <div class="ws-card" style="border-left:4px solid ${sportsRecommendation.color};margin-bottom:20px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 8px">🏅 Sports Day Weather Planning</h3>
        <p style="font-size:14px;color:${GRAY};margin:0">
          <strong style="color:${sportsRecommendation.color}">${sportsRecommendation.status}</strong> — ${sportsRecommendation.text}
        </p>
      </div>

      <!-- Forecast Cards -->
      <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">5-Day Forecast (Predicted)</h3>
      <div style="display:flex;gap:12px;margin-bottom:24px;overflow-x:auto">${forecastHtml}</div>

      <!-- Trends -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
        <div class="ws-card">
          <h3 style="font-size:14px;color:#1e293b;margin:0 0 8px">📈 Temperature Trend (7d)</h3>
          <p style="font-size:13px;color:${GRAY}">${tempTrend}</p>
          <div style="margin-top:8px">${tempChart}</div>
        </div>
        <div class="ws-card">
          <h3 style="font-size:14px;color:#1e293b;margin:0 0 8px">📊 Weekly Summary</h3>
          ${days7.length > 0 ? `<table class="ws-table">
            <thead><tr><th>Day</th><th>Avg Temp</th><th>Min/Max</th><th>Avg Hum</th><th>Rain</th></tr></thead>
            <tbody>${days7.map(d => `<tr>
              <td>${String(d.day || '').substring(5)}</td>
              <td>${parseFloat(d.avg_temp || 0).toFixed(1)}°C</td>
              <td>${parseFloat(d.min_temp || 0).toFixed(1)}° / ${parseFloat(d.max_temp || 0).toFixed(1)}°</td>
              <td>${parseFloat(d.avg_hum || 0).toFixed(0)}%</td>
              <td>${parseFloat(d.total_rain || 0).toFixed(1)} mm</td>
            </tr>`).join('')}</tbody>
          </table>` : '<p style="color:#94a3b8">No data available for the past 7 days.</p>'}
        </div>
      </div>

      <!-- Humidity & Wind -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
        <div class="ws-card">
          <h3 style="font-size:14px;color:#1e293b;margin:0 0 8px">💧 Humidity Trend</h3>
          <p style="font-size:13px;color:${GRAY}">${humTrend}</p>
          <div style="margin-top:8px">${svgSparkline(days7.map(d => parseFloat(d.avg_hum || 0)), '#06b6d4', 350, 80)}</div>
        </div>
        <div class="ws-card">
          <h3 style="font-size:14px;color:#1e293b;margin:0 0 8px">💨 Wind Pattern</h3>
          <div style="margin-top:8px">${svgBarChart(
            days7.map(d => ({ label: String(d.day || '').substring(5, 10), value: parseFloat(d.avg_wind || 0).toFixed(1) })),
            350, 90, '#8b5cf6'
          )}</div>
        </div>
      </div>

      <!-- Active alerts -->
      ${activeAlerts.rows.length > 0 ? `<div class="ws-card" style="border-left:4px solid #dc2626">
        <h3 style="font-size:14px;color:#dc2626;margin:0 0 8px">⚠️ Active Alerts Affecting Forecast</h3>
        ${activeAlerts.rows.map(a => `<div style="font-size:13px;color:${GRAY};padding:4px 0">• <strong>${esc(a.alert_type)}</strong>: ${esc(a.message)}</div>`).join('')}
      </div>` : ''}
    </div>`;
    res.send(renderPage('Weather Forecast', html, user, req));
  }));

  // ============================================================
  // ROUTE 14: GET /school/weather-station/api/latest — API endpoint
  // ============================================================
  app.get('/school/weather-station/api/latest', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const latest = (await pool.query(`SELECT wr.*, ws.name AS sensor_name FROM weather_readings wr
      LEFT JOIN weather_sensors ws ON ws.id = wr.sensor_id AND ws.tenant_id = wr.tenant_id
      WHERE wr.tenant_id=$1 ORDER BY wr.recorded_at DESC LIMIT 1`, [tid])).rows[0];
    const sensors = (await pool.query(`SELECT id, name, status, last_reading FROM weather_sensors WHERE tenant_id=$1`, [tid])).rows;
    const alerts = (await pool.query(`SELECT id, alert_type, message, severity, active FROM weather_alerts WHERE tenant_id=$1 AND active=true`, [tid])).rows;
    const activity = activityRecommendation(latest);

    res.json({
      success: true,
      latest: latest ? {
        temperature: latest.temperature,
        humidity: latest.humidity,
        pressure: latest.pressure,
        wind_speed: latest.wind_speed,
        wind_direction: latest.wind_direction,
        uv_index: latest.uv_index,
        air_quality: latest.air_quality,
        rainfall: latest.rainfall,
        sensor: latest.sensor_name,
        recorded_at: latest.recorded_at,
      } : null,
      sensors: sensors.map(s => ({ id: s.id, name: s.name, status: s.status, last_reading: s.last_reading })),
      active_alerts: alerts,
      outdoor_activity: activity,
      timestamp: new Date().toISOString(),
    });
  }));

  // ============================================================
  // ROUTE 15: GET /school/weather-station/settings — Settings
  // ============================================================
  app.get('/school/weather-station/settings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    let settings = (await pool.query(`SELECT * FROM weather_settings WHERE tenant_id=$1`, [tid])).rows[0];
    if (!settings) {
      await pool.query(`INSERT INTO weather_settings (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`, [tid]);
      settings = (await pool.query(`SELECT * FROM weather_settings WHERE tenant_id=$1`, [tid])).rows[0];
    }

    const html = SKIP + `<div style="max-width:800px;margin:0 auto">
      ${nav('settings')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:4px">⚙ Weather Station Settings</h1>
      <p style="font-size:13px;color:${GRAY};margin-bottom:20px">Configure alert thresholds, display units, and monitoring preferences</p>

      <div class="ws-card">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 16px;padding-bottom:8px;border-bottom:2px solid #e0f2fe">🔔 Alert Thresholds</h3>
        <form method="POST" action="/school/weather-station/settings">
          <div class="ws-row3">
            <div class="ws-fg"><label>High Temp Alert (°C)</label>
              <input type="number" name="alert_threshold_temp_high" value="${settings.alert_threshold_temp_high ?? 38}" step="0.5"></div>
            <div class="ws-fg"><label>Low Temp Alert (°C)</label>
              <input type="number" name="alert_threshold_temp_low" value="${settings.alert_threshold_temp_low ?? 2}" step="0.5"></div>
            <div class="ws-fg"><label>Wind Speed Alert (km/h)</label>
              <input type="number" name="alert_threshold_wind" value="${settings.alert_threshold_wind ?? 40}" step="0.5"></div>
          </div>
          <div class="ws-row3">
            <div class="ws-fg"><label>UV Index Alert</label>
              <input type="number" name="alert_threshold_uv" value="${settings.alert_threshold_uv ?? 10}" step="0.5"></div>
            <div class="ws-fg"><label>AQI Alert Threshold</label>
              <input type="number" name="alert_threshold_aqi" value="${settings.alert_threshold_aqi ?? 200}" step="1"></div>
            <div class="ws-fg"><label>Rainfall Alert (mm)</label>
              <input type="number" name="alert_threshold_rain" value="${settings.alert_threshold_rain ?? 10}" step="0.5"></div>
          </div>
          <div class="ws-fg" style="margin-top:8px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="auto_alert" value="1" ${settings.auto_alert ? 'checked' : ''}>
              <span style="font-size:14px;color:#1e293b;font-weight:600">Auto-generate alerts when thresholds exceeded</span>
            </label>
          </div>

          <h3 style="font-size:15px;color:#1e293b;margin:24px 0 16px;padding-bottom:8px;border-bottom:2px solid #e0f2fe">📐 Display Settings</h3>
          <div class="ws-row3">
            <div class="ws-fg"><label>Temperature Unit</label>
              <select name="display_unit_temp">
                <option value="C" ${(settings.display_unit_temp || 'C') === 'C' ? 'selected' : ''}>Celsius (°C)</option>
                <option value="F" ${settings.display_unit_temp === 'F' ? 'selected' : ''}>Fahrenheit (°F)</option>
              </select></div>
            <div class="ws-fg"><label>Wind Unit</label>
              <select name="display_unit_wind">
                <option value="km/h" ${(settings.display_unit_wind || 'km/h') === 'km/h' ? 'selected' : ''}>km/h</option>
                <option value="mph" ${settings.display_unit_wind === 'mph' ? 'selected' : ''}>mph</option>
                <option value="m/s" ${settings.display_unit_wind === 'm/s' ? 'selected' : ''}>m/s</option>
              </select></div>
            <div class="ws-fg"><label>Pressure Unit</label>
              <select name="display_unit_pressure">
                <option value="hPa" ${(settings.display_unit_pressure || 'hPa') === 'hPa' ? 'selected' : ''}>hPa</option>
                <option value="inHg" ${settings.display_unit_pressure === 'inHg' ? 'selected' : ''}>inHg</option>
                <option value="mmHg" ${settings.display_unit_pressure === 'mmHg' ? 'selected' : ''}>mmHg</option>
              </select></div>
          </div>
          <div class="ws-fg">
            <label>Dashboard Refresh Interval (seconds)</label>
            <input type="number" name="refresh_interval" value="${settings.refresh_interval ?? 300}" min="30" max="3600" step="30">
          </div>

          <div style="display:flex;gap:10px;margin-top:20px">
            <button type="submit" class="ws-btn ws-btn-primary">💾 Save Settings</button>
          </div>
        </form>
      </div>

      <div class="ws-card">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 8px">🔧 Manual Sensor Data Entry</h3>
        <p style="font-size:12px;color:${GRAY};margin:0 0 12px">Enter a reading manually (useful for testing or backup sensors)</p>
        <form method="POST" action="/school/weather-station/api/submit">
          <div class="ws-row3">
            <div class="ws-fg"><label>Sensor</label>
              <select name="sensor_id">
                <option value="">Auto (first online)</option>
                ${(await pool.query(`SELECT id, name FROM weather_sensors WHERE tenant_id=$1 AND status='online' ORDER BY name`, [tid])).rows
                  .map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
              </select></div>
            <div class="ws-fg"><label>Temperature (°C)</label>
              <input type="number" name="temperature" step="0.1" placeholder="25.0"></div>
            <div class="ws-fg"><label>Humidity (%)</label>
              <input type="number" name="humidity" step="0.1" placeholder="60.0"></div>
          </div>
          <div class="ws-row3">
            <div class="ws-fg"><label>Pressure (hPa)</label>
              <input type="number" name="pressure" step="0.1" placeholder="1013.25"></div>
            <div class="ws-fg"><label>Wind Speed (km/h)</label>
              <input type="number" name="wind_speed" step="0.1" placeholder="12.0"></div>
            <div class="ws-fg"><label>Wind Direction (°)</label>
              <input type="number" name="wind_direction" step="1" placeholder="180"></div>
          </div>
          <div class="ws-row3">
            <div class="ws-fg"><label>UV Index</label>
              <input type="number" name="uv_index" step="0.1" placeholder="5.0"></div>
            <div class="ws-fg"><label>Air Quality (AQI)</label>
              <input type="number" name="air_quality" step="1" placeholder="50"></div>
            <div class="ws-fg"><label>Rainfall (mm)</label>
              <input type="number" name="rainfall" step="0.1" placeholder="0.0"></div>
          </div>
          <button type="submit" class="ws-btn ws-btn-primary" style="margin-top:12px">📤 Submit Reading</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Weather Settings', html, user, req));
  }));

  // ============================================================
  // ROUTE 16: POST /school/weather-station/settings — Save settings
  // ============================================================
  app.post('/school/weather-station/settings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const {
      alert_threshold_temp_high, alert_threshold_temp_low, alert_threshold_wind,
      alert_threshold_uv, alert_threshold_aqi, alert_threshold_rain,
      auto_alert, display_unit_temp, display_unit_wind, display_unit_pressure, refresh_interval,
    } = req.body;
    await pool.query(`INSERT INTO weather_settings (tenant_id, alert_threshold_temp_high, alert_threshold_temp_low,
      alert_threshold_wind, alert_threshold_uv, alert_threshold_aqi, alert_threshold_rain,
      auto_alert, display_unit_temp, display_unit_wind, display_unit_pressure, refresh_interval, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET alert_threshold_temp_high=$2, alert_threshold_temp_low=$3,
      alert_threshold_wind=$4, alert_threshold_uv=$5, alert_threshold_aqi=$6, alert_threshold_rain=$7,
      auto_alert=$8, display_unit_temp=$9, display_unit_wind=$10, display_unit_pressure=$11,
      refresh_interval=$12, updated_at=NOW()`, [
      tid,
      parseFloat(alert_threshold_temp_high) || 38,
      parseFloat(alert_threshold_temp_low) || 2,
      parseFloat(alert_threshold_wind) || 40,
      parseFloat(alert_threshold_uv) || 10,
      parseInt(alert_threshold_aqi) || 200,
      parseFloat(alert_threshold_rain) || 10,
      auto_alert === '1' || auto_alert === 'on',
      display_unit_temp || 'C',
      display_unit_wind || 'km/h',
      display_unit_pressure || 'hPa',
      parseInt(refresh_interval) || 300,
    ]);
    audit && audit(user, 'update_weather_settings');
    res.redirect('/school/weather-station/settings');
  }));

  // ============================================================
  // ROUTE 17: POST /school/weather-station/api/submit — Submit reading
  // ============================================================
  app.post('/school/weather-station/api/submit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { sensor_id, temperature, humidity, pressure, wind_speed, wind_direction, uv_index, air_quality, rainfall } = req.body;

    // Auto-select sensor if not specified
    let sid = sensor_id ? parseInt(sensor_id) : null;
    if (!sid) {
      const autoSensor = (await pool.query(`SELECT id FROM weather_sensors WHERE tenant_id=$1 AND status='online' ORDER BY last_reading DESC NULLS LAST LIMIT 1`, [tid])).rows[0];
      sid = autoSensor ? autoSensor.id : null;
    }

    await pool.query(`INSERT INTO weather_readings (tenant_id, temperature, humidity, pressure, wind_speed, wind_direction, uv_index, air_quality, rainfall, sensor_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
      tid,
      temperature != '' ? parseFloat(temperature) : null,
      humidity != '' ? parseFloat(humidity) : null,
      pressure != '' ? parseFloat(pressure) : null,
      wind_speed != '' ? parseFloat(wind_speed) : null,
      wind_direction != '' ? parseInt(wind_direction) : null,
      uv_index != '' ? parseFloat(uv_index) : null,
      air_quality != '' ? parseInt(air_quality) : null,
      rainfall != '' ? parseFloat(rainfall) : null,
      sid,
    ]);

    // Update sensor last_reading
    if (sid) {
      await pool.query(`UPDATE weather_sensors SET last_reading=NOW() WHERE id=$1 AND tenant_id=$2`, [sid, tid]);
    }

    // Auto-alert check
    const settings = (await pool.query(`SELECT * FROM weather_settings WHERE tenant_id=$1`, [tid])).rows[0];
    if (settings && settings.auto_alert) {
      const alertsToCreate = [];
      const tempHigh = parseFloat(alert_threshold_temp_high || 38);
      const tempLow = parseFloat(alert_threshold_temp_low || 2);
      const windMax = parseFloat(alert_threshold_wind || 40);
      const uvMax = parseFloat(alert_threshold_uv || 10);
      const aqiMax = parseInt(alert_threshold_aqi || 200);
      const rainMax = parseFloat(alert_threshold_rain || 10);

      const t = temperature != '' ? parseFloat(temperature) : null;
      const w = wind_speed != '' ? parseFloat(wind_speed) : null;
      const u = uv_index != '' ? parseFloat(uv_index) : null;
      const a = air_quality != '' ? parseInt(air_quality) : null;
      const r = rainfall != '' ? parseFloat(rainfall) : null;

      if (t !== null && t >= tempHigh) alertsToCreate.push({ type: 'heat', msg: `Temperature reached ${t.toFixed(1)}°C (threshold: ${tempHigh}°C)`, severity: t >= tempHigh + 3 ? 'critical' : 'warning' });
      if (t !== null && t <= tempLow) alertsToCreate.push({ type: 'cold', msg: `Temperature dropped to ${t.toFixed(1)}°C (threshold: ${tempLow}°C)`, severity: t <= tempLow - 3 ? 'critical' : 'warning' });
      if (w !== null && w >= windMax) alertsToCreate.push({ type: 'wind', msg: `Wind speed ${w.toFixed(1)} km/h (threshold: ${windMax} km/h)`, severity: w >= windMax * 1.3 ? 'critical' : 'warning' });
      if (u !== null && u >= uvMax) alertsToCreate.push({ type: 'uv', msg: `UV index ${u.toFixed(1)} (threshold: ${uvMax})`, severity: 'warning' });
      if (a !== null && a >= aqiMax) alertsToCreate.push({ type: 'aqi', msg: `Air quality index ${a} (threshold: ${aqiMax})`, severity: a >= aqiMax * 1.5 ? 'critical' : 'warning' });
      if (r !== null && r >= rainMax) alertsToCreate.push({ type: 'rain', msg: `Rainfall ${r.toFixed(1)} mm (threshold: ${rainMax} mm)`, severity: 'warning' });

      for (const alert of alertsToCreate) {
        await pool.query(`INSERT INTO weather_alerts (tenant_id, alert_type, message, severity, active) VALUES ($1,$2,$3,$4,true)`, [tid, alert.type, alert.msg, alert.severity]);
        if (alert.severity === 'critical' && queueEmail) {
          queueEmail({ to: 'admin@school', subject: `🔴 Weather Alert: ${alert.type}`, body: alert.msg });
        }
      }
    }

    audit && audit(user, 'submit_reading', { sensor_id: sid });
    res.redirect('/school/weather-station');
  }));

  // ============================================================
  // ROUTE 18: GET /school/weather-station/export — Data export
  // ============================================================
  app.get('/school/weather-station/export', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const format = req.query.format || 'html';
    const dateFrom = req.query.from || '';
    const dateTo = req.query.to || '';

    let sql = `SELECT wr.*, ws.name AS sensor_name FROM weather_readings wr
      LEFT JOIN weather_sensors ws ON ws.id = wr.sensor_id AND ws.tenant_id = wr.tenant_id
      WHERE wr.tenant_id=$1`;
    const params = [tid];
    let pi = 2;
    if (dateFrom) { sql += ` AND wr.recorded_at >= $${pi}::date`; params.push(dateFrom); pi++; }
    if (dateTo) { sql += ` AND wr.recorded_at < ($${pi}::date + INTERVAL '1 day')`; params.push(dateTo); pi++; }
    sql += ` ORDER BY wr.recorded_at ASC LIMIT 10000`;

    const readings = (await pool.query(sql, params)).rows;

    if (format === 'csv') {
      const headers = 'Time,Sensor,Temperature,Humidity,Pressure,Wind Speed,Wind Direction,UV Index,Air Quality,Rainfall';
      const rows = readings.map(r =>
        [r.recorded_at, r.sensor_name || '', r.temperature ?? '', r.humidity ?? '', r.pressure ?? '',
         r.wind_speed ?? '', r.wind_direction ?? '', r.uv_index ?? '', r.air_quality ?? '', r.rainfall ?? '']
          .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
      ).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="weather-export-${today()}.csv"`);
      return res.send(headers + '\n' + rows);
    }

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="weather-export-${today()}.json"`);
      return res.json({ exported_at: new Date().toISOString(), tenant_id: tid, count: readings.length, readings });
    }

    // HTML view with export options
    const summaryHtml = readings.length > 0 ? (() => {
      const temps = readings.map(r => r.temperature).filter(v => v != null);
      const hums = readings.map(r => r.humidity).filter(v => v != null);
      const winds = readings.map(r => r.wind_speed).filter(v => v != null);
      return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:16px">
        <div style="text-align:center;padding:12px;background:#f0f9ff;border-radius:8px">
          <div style="font-size:20px;font-weight:700;color:${P}">${readings.length}</div><div style="font-size:11px;color:${GRAY}">Readings</div></div>
        ${temps.length > 0 ? `<div style="text-align:center;padding:12px;background:#fef3c7;border-radius:8px">
          <div style="font-size:20px;font-weight:700;color:#f59e0b">${(Math.min(...temps)).toFixed(1)}° - ${(Math.max(...temps)).toFixed(1)}°</div><div style="font-size:11px;color:${GRAY}">Temp Range</div></div>` : ''}
        ${hums.length > 0 ? `<div style="text-align:center;padding:12px;background:#e0f2fe;border-radius:8px">
          <div style="font-size:20px;font-weight:700;color:#0ea5e9">${(hums.reduce((a, b) => a + b, 0) / hums.length).toFixed(0)}%</div><div style="font-size:11px;color:${GRAY}">Avg Humidity</div></div>` : ''}
        ${winds.length > 0 ? `<div style="text-align:center;padding:12px;background:#ede9fe;border-radius:8px">
          <div style="font-size:20px;font-weight:700;color:#8b5cf6">${(Math.max(...winds)).toFixed(1)} km/h</div><div style="font-size:11px;color:${GRAY}">Max Wind</div></div>` : ''}
      </div>`;
    })() : '';

    const previewHtml = readings.length > 0 ? `<table class="ws-table">
      <thead><tr><th>Time</th><th>Sensor</th><th>Temp</th><th>Humidity</th><th>Pressure</th><th>Wind</th><th>UV</th><th>AQI</th><th>Rain</th></tr></thead>
      <tbody>${readings.slice(0, 50).map(r => `<tr>
        <td style="white-space:nowrap">${fmtDateTime(r.recorded_at)}</td>
        <td>${esc(r.sensor_name || '—')}</td>
        <td>${r.temperature != null ? r.temperature.toFixed(1) + '°C' : '—'}</td>
        <td>${r.humidity != null ? r.humidity.toFixed(1) + '%' : '—'}</td>
        <td>${r.pressure != null ? r.pressure.toFixed(1) : '—'}</td>
        <td>${r.wind_speed != null ? r.wind_speed.toFixed(1) : '—'}</td>
        <td>${r.uv_index != null ? r.uv_index.toFixed(1) : '—'}</td>
        <td>${r.air_quality ?? '—'}</td>
        <td>${r.rainfall != null ? r.rainfall.toFixed(1) : '—'}</td>
      </tr>`).join('')}</tbody>
    </table>${readings.length > 50 ? `<p style="text-align:center;color:${GRAY};font-size:12px">Showing 50 of ${readings.length} readings. Export for full data.</p>` : ''}`
      : '<p style="text-align:center;color:#94a3b8;padding:40px">No readings to export.</p>';

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">
      ${nav('export')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:4px">📥 Export Weather Data</h1>
      <p style="font-size:13px;color:${GRAY};margin-bottom:20px">Download readings in CSV or JSON format</p>

      <div class="ws-card">
        <h3 style="font-size:14px;color:#1e293b;margin:0 0 12px">Export Options</h3>
        <div class="ws-filter">
          <form method="GET" style="display:flex;gap:8px;flex-wrap:wrap">
            <div><label>From</label><input type="date" name="from" value="${esc(dateFrom)}"></div>
            <div><label>To</label><input type="date" name="to" value="${esc(dateTo)}"></div>
            <div><label>Format</label><select name="format">
              <option value="html" ${format === 'html' ? 'selected' : ''}>Preview (HTML)</option>
              <option value="csv" ${format === 'csv' ? 'selected' : ''}>CSV Spreadsheet</option>
              <option value="json" ${format === 'json' ? 'selected' : ''}>JSON Data</option>
            </select></div>
            <div style="align-self:end"><button type="submit" class="ws-btn ws-btn-primary">Generate</button></div>
          </form>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a href="/school/weather-station/export?format=csv&from=${esc(dateFrom)}&to=${esc(dateTo)}" class="ws-btn ws-btn-success" style="font-size:12px">📥 Download CSV</a>
          <a href="/school/weather-station/export?format=json&from=${esc(dateFrom)}&to=${esc(dateTo)}" class="ws-btn ws-btn-secondary" style="font-size:12px">📥 Download JSON</a>
        </div>
      </div>

      ${summaryHtml}

      <div class="ws-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">${previewHtml}</div>
      </div>
    </div>`;
    res.send(renderPage('Export Weather Data', html, user, req));
  }));

  // ============================================================
  // ROUTE 19: GET /school/weather-station/calendar — Weather-aware scheduling
  // ============================================================
  app.get('/school/weather-station/calendar', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Get next 7 days weather averages
    const dailyWeather = (await pool.query(`SELECT DATE(recorded_at) AS day,
      AVG(temperature) AS avg_temp, MAX(wind_speed) AS max_wind, SUM(COALESCE(rainfall,0)) AS total_rain,
      MAX(uv_index) AS max_uv, MAX(air_quality) AS max_aqi
      FROM weather_readings WHERE tenant_id=$1 AND recorded_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(recorded_at) ORDER BY day DESC LIMIT 7`, [tid])).rows;

    // Get upcoming events from calendar (if exists)
    let events = [];
    try {
      const calEvents = (await pool.query(`SELECT id, title, start_date, end_date, location FROM calendar_events
        WHERE tenant_id=$1 AND start_date >= CURRENT_DATE AND start_date <= CURRENT_DATE + INTERVAL '14 days'
        ORDER BY start_date ASC LIMIT 20`, [tid])).rows;
      events = calEvents;
    } catch (_) { /* calendar_events table may not exist */ }

    const eventsHtml = events.length > 0 ? events.map(ev => {
      const eventDate = ev.start_date ? String(ev.start_date).substring(0, 10) : null;
      const weatherDay = dailyWeather.find(d => String(d.day) === eventDate);
      const isOutdoor = /outdoor|field|ground|pitch|track|court|pool/i.test(ev.location || '');
      const rec = weatherDay ? activityRecommendation({ temperature: parseFloat(weatherDay.avg_temp), wind_speed: parseFloat(weatherDay.max_wind), rainfall: parseFloat(weatherDay.total_rain), uv_index: parseFloat(weatherDay.max_uv), air_quality: parseInt(weatherDay.max_aqi) }) : null;
      return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f1f5f9">
        <div style="width:44px;height:44px;border-radius:10px;background:${isOutdoor ? '#fef3c7' : '#f0f9ff'};display:flex;align-items:center;justify-content:center;font-size:20px">${isOutdoor ? '🏟' : '🏫'}</div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:600;color:#1e293b">${esc(ev.title || 'Event')}</div>
          <div style="font-size:12px;color:${GRAY}">${fmtDate(ev.start_date)} · ${esc(ev.location || 'TBD')}</div>
        </div>
        ${isOutdoor && rec ? `<span class="badge" style="background:${rec.color}20;color:${rec.color}">${rec.status}</span>` : ''}
        ${isOutdoor && weatherDay ? `<span style="font-size:12px;color:${GRAY}">~${parseFloat(weatherDay.avg_temp || 0).toFixed(1)}°C</span>` : ''}
      </div>`;
    }).join('') : '<p style="text-align:center;color:#94a3b8;padding:20px">No upcoming events found in the school calendar.</p>';

    const html = SKIP + `<div style="max-width:1000px;margin:0 auto">
      ${nav('dash')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:4px">📅 Weather-Aware Calendar</h1>
      <p style="font-size:13px;color:${GRAY};margin-bottom:20px">Upcoming events with weather compatibility assessment</p>

      <div class="ws-card">
        <h3 style="font-size:14px;color:#1e293b;margin:0 0 12px">Upcoming Events (Next 14 days)</h3>
        ${eventsHtml}
      </div>

      ${dailyWeather.length > 0 ? `<div class="ws-card">
        <h3 style="font-size:14px;color:#1e293b;margin:0 0 12px">📊 Recent Weather Summary (for reference)</h3>
        <table class="ws-table"><thead><tr><th>Day</th><th>Avg Temp</th><th>Max Wind</th><th>Rain</th><th>Max UV</th><th>Max AQI</th></tr></thead>
        <tbody>${dailyWeather.map(d => `<tr>
          <td>${String(d.day || '').substring(0, 10)}</td>
          <td>${parseFloat(d.avg_temp || 0).toFixed(1)}°C</td>
          <td>${parseFloat(d.max_wind || 0).toFixed(1)} km/h</td>
          <td>${parseFloat(d.total_rain || 0).toFixed(1)} mm</td>
          <td>${d.max_uv != null ? d.max_uv.toFixed(1) : '—'}</td>
          <td>${d.max_aqi ?? '—'}</td>
        </tr>`).join('')}</tbody></table>
      </div>` : ''}
    </div>`;
    res.send(renderPage('Weather Calendar', html, user, req));
  }));

  // ============================================================
  // ROUTE 20: POST /school/weather-station/readings/manual — Quick manual entry
  // ============================================================
  app.post('/school/weather-station/readings/manual', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { temperature, humidity, pressure, wind_speed, wind_direction, uv_index, air_quality, rainfall, sensor_id } = req.body;

    let sid = sensor_id ? parseInt(sensor_id) : null;
    if (!sid) {
      const autoSensor = (await pool.query(`SELECT id FROM weather_sensors WHERE tenant_id=$1 AND status='online' ORDER BY last_reading DESC NULLS LAST LIMIT 1`, [tid])).rows[0];
      sid = autoSensor ? autoSensor.id : null;
    }

    await pool.query(`INSERT INTO weather_readings (tenant_id, temperature, humidity, pressure, wind_speed, wind_direction, uv_index, air_quality, rainfall, sensor_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
      tid,
      temperature != '' ? parseFloat(temperature) : null,
      humidity != '' ? parseFloat(humidity) : null,
      pressure != '' ? parseFloat(pressure) : null,
      wind_speed != '' ? parseFloat(wind_speed) : null,
      wind_direction != '' ? parseInt(wind_direction) : null,
      uv_index != '' ? parseFloat(uv_index) : null,
      air_quality != '' ? parseInt(air_quality) : null,
      rainfall != '' ? parseFloat(rainfall) : null,
      sid,
    ]);

    if (sid) await pool.query(`UPDATE weather_sensors SET last_reading=NOW() WHERE id=$1 AND tenant_id=$2`, [sid, tid]);
    audit && audit(user, 'manual_reading', { sensor_id: sid });
    res.redirect('/school/weather-station/readings');
  }));

  console.log('[WeatherStation] Module loaded — /school/weather-station');
};
