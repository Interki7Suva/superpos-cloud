const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

const DATA_FILE = path.join(__dirname, 'tenants.json');
const PAYMENTS_FILE = path.join(__dirname, 'payments.json');
const CONFIG_FILE = path.join(__dirname, 'system_config.json');

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Inicialización de Datos
function getTenants() {
  return readJson(DATA_FILE, [
    {
      id: 'tenant-super-1',
      name: 'Supermercado Central Express, C.A.',
      rif: 'J-31456982-1',
      city: 'Maracay, Edo. Aragua',
      plan: 'PROFESIONAL',
      monthlyPrice: 60,
      status: 'ACTIVE',
      lastHeartbeat: new Date().toISOString(),
      nextDueDate: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(),
      contactName: 'Ing. Carlos Mendoza',
      contactPhone: '584121234567',
      activeRegisters: 3,
      currentVersion: 'v2.4.0'
    }
  ]);
}

function getPayments() {
  return readJson(PAYMENTS_FILE, [
    {
      id: 'pay-001',
      tenantId: 'tenant-super-1',
      tenantName: 'Supermercado Central Express, C.A.',
      amount: 60,
      currency: 'USDT',
      method: 'Binance Pay',
      reference: 'BINANCE-889412',
      date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'APROBADO'
    }
  ]);
}

function getSystemConfig() {
  return readJson(CONFIG_FILE, {
    bcvRate: 41.85,
    bcvLastUpdated: new Date().toISOString(),
    binancePayId: '123456789',
    binanceQrUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=binancepay://pay?id=123456789',
    pagoMovilBanco: 'Banco de Venezuela (0102)',
    pagoMovilTelefono: '0412-1234567',
    pagoMovilCedula: 'V-12345678',
    zelleEmail: 'tu-correo-zelle@gmail.com',
    latestVersion: 'v2.4.0',
    secretKey: 'SUPERPOS_SAAS_SECRET_KEY_2026'
  });
}

// =========================================================================
// 🔄 CONSULTA AUTOMÁTICA DE TASA OFICIAL BCV EN TIEMPO REAL
// =========================================================================
async function fetchLiveBcvRate() {
  return new Promise((resolve) => {
    https.get('https://pydolarve.org/api/v1/dollar?page=bcv', { timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const rate = parseFloat(json?.monitors?.usd?.price || json?.price);
          if (rate && rate > 0) {
            let cfg = getSystemConfig();
            cfg.bcvRate = rate;
            cfg.bcvLastUpdated = new Date().toISOString();
            writeJson(CONFIG_FILE, cfg);
            console.log('✅ Tasa BCV Oficial sincronizada en vivo: Bs. ' + rate);
            resolve(rate);
            return;
          }
        } catch (e) {}
        resolve(getSystemConfig().bcvRate);
      });
    }).on('error', () => resolve(getSystemConfig().bcvRate));
  });
}

// Sincronizar BCV cada 30 minutos automáticamente
fetchLiveBcvRate();
setInterval(fetchLiveBcvRate, 30 * 60 * 1000);

// =========================================================================
// 1. APIS PARA CLIENTES Y HEARTBEAT DE CAJAS
// =========================================================================
app.post('/api/cloud/license/heartbeat', async (req, res) => {
  const { tenantId, machineFingerprint, localVersion, activeRegisters } = req.body || {};
  let tenants = getTenants();
  let tenant = tenants.find(t => t.id === tenantId);
  const sysConfig = getSystemConfig();

  if (!tenant) {
    tenant = {
      id: tenantId || 'tenant-' + Date.now(),
      name: 'Nuevo Supermercado',
      rif: 'J-Pendiente',
      city: 'Venezuela',
      plan: 'BASICO',
      monthlyPrice: 35,
      status: 'ACTIVE',
      lastHeartbeat: new Date().toISOString(),
      nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      contactName: 'Gerencia',
      contactPhone: '584120000000',
      activeRegisters: activeRegisters || 1,
      currentVersion: localVersion || 'v2.4.0',
      machineFingerprint
    };
    tenants.push(tenant);
  } else {
    tenant.lastHeartbeat = new Date().toISOString();
    if (activeRegisters) tenant.activeRegisters = activeRegisters;
    if (localVersion) tenant.currentVersion = localVersion;
  }
  writeJson(DATA_FILE, tenants);

  const isActive = tenant.status === 'ACTIVE';
  res.json({
    valid: isActive,
    status: tenant.status,
    tenantId: tenant.id,
    plan: tenant.plan,
    nextDueDate: tenant.nextDueDate,
    bcvRate: sysConfig.bcvRate,
    latestVersion: sysConfig.latestVersion
  });
});

app.get('/api/cloud/bcv-rate', (req, res) => {
  const cfg = getSystemConfig();
  res.json({ rate: cfg.bcvRate, lastUpdated: cfg.bcvLastUpdated });
});

// =========================================================================
// 2. APIS SUPERADMIN
// =========================================================================
app.get('/api/cloud/admin/data', (req, res) => {
  res.json({
    tenants: getTenants(),
    payments: getPayments(),
    config: getSystemConfig()
  });
});

app.post('/api/cloud/admin/tenants', (req, res) => {
  const { name, rif, city, plan, monthlyPrice, contactName, contactPhone } = req.body || {};
  let tenants = getTenants();
  const cleanPhone = (contactPhone || '').replace(/[^0-9]/g, '');
  const newTenant = {
    id: 'tenant-' + Math.random().toString(36).substring(2, 9),
    name: name || 'Supermercado',
    rif: rif || 'J-00000000-0',
    city: city || 'Venezuela',
    plan: plan || 'PROFESIONAL',
    monthlyPrice: Number(monthlyPrice) || 60,
    status: 'ACTIVE',
    lastHeartbeat: 'Nunca',
    nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    contactName: contactName || 'Gerente',
    contactPhone: cleanPhone.startsWith('58') ? cleanPhone : '58' + cleanPhone,
    activeRegisters: 1,
    currentVersion: getSystemConfig().latestVersion
  };
  tenants.push(newTenant);
  writeJson(DATA_FILE, tenants);
  res.json({ success: true, tenant: newTenant });
});

app.post('/api/cloud/admin/toggle-status', (req, res) => {
  const { tenantId, status } = req.body || {};
  let tenants = getTenants();
  const idx = tenants.findIndex(t => t.id === tenantId);
  if (idx !== -1) {
    tenants[idx].status = status;
    writeJson(DATA_FILE, tenants);
    res.json({ success: true, tenant: tenants[idx] });
  } else {
    res.status(404).json({ error: 'No encontrado' });
  }
});

app.post('/api/cloud/admin/payments', (req, res) => {
  const { tenantId, amount, method, reference } = req.body || {};
  let tenants = getTenants();
  let payments = getPayments();
  const tenant = tenants.find(t => t.id === tenantId);
  if (!tenant) return res.status(404).json({ error: 'Supermercado no encontrado' });

  const currentDue = new Date(tenant.nextDueDate).getTime();
  const baseTime = currentDue > Date.now() ? currentDue : Date.now();
  tenant.nextDueDate = new Date(baseTime + 30 * 24 * 60 * 60 * 1000).toISOString();
  tenant.status = 'ACTIVE';

  const newPayment = {
    id: 'pay-' + Date.now(),
    tenantId: tenant.id,
    tenantName: tenant.name,
    amount: Number(amount) || tenant.monthlyPrice,
    currency: method === 'Binance Pay' ? 'USDT' : 'USD',
    method: method || 'Binance Pay',
    reference: reference || 'REF-' + Math.floor(Math.random() * 900000 + 100000),
    date: new Date().toISOString(),
    status: 'APROBADO'
  };

  payments.unshift(newPayment);
  writeJson(DATA_FILE, tenants);
  writeJson(PAYMENTS_FILE, payments);
  res.json({ success: true, payment: newPayment, newDueDate: tenant.nextDueDate });
});

app.post('/api/cloud/admin/update-config', async (req, res) => {
  const { bcvRate, binancePayId, binanceQrUrl, pagoMovilBanco, pagoMovilTelefono, pagoMovilCedula, zelleEmail, refreshBcv } = req.body || {};
  let config = getSystemConfig();

  if (refreshBcv) {
    await fetchLiveBcvRate();
    config = getSystemConfig();
  } else if (bcvRate) {
    config.bcvRate = Number(bcvRate);
  }

  if (binancePayId) config.binancePayId = binancePayId;
  if (binanceQrUrl) config.binanceQrUrl = binanceQrUrl;
  if (pagoMovilBanco) config.pagoMovilBanco = pagoMovilBanco;
  if (pagoMovilTelefono) config.pagoMovilTelefono = pagoMovilTelefono;
  if (pagoMovilCedula) config.pagoMovilCedula = pagoMovilCedula;
  if (zelleEmail) config.zelleEmail = zelleEmail;

  writeJson(CONFIG_FILE, config);
  res.json({ success: true, config });
});

app.post('/api/cloud/admin/generate-offline-token', (req, res) => {
  const { tenantId, days } = req.body || {};
  const config = getSystemConfig();
  const durationDays = Number(days) || 3;
  const expiry = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
  const hash = crypto.createHmac('sha256', config.secretKey).update(`${tenantId}_${expiry}`).digest('hex').substring(0, 8).toUpperCase();
  const token = `SP-${hash}-${durationDays}D`;
  res.json({ success: true, token, expiry, durationDays });
});

// =========================================================================
// 3. PORTAL PÚBLICO DE PAGO CON QR PARA EL CLIENTE (/pay/:tenantId)
// =========================================================================
app.get('/pay/:tenantId', (req, res) => {
  const tenants = getTenants();
  const cfg = getSystemConfig();
  const tenant = tenants.find(t => t.id === req.params.tenantId) || tenants[0];
  const bcvAmount = (tenant.monthlyPrice * cfg.bcvRate).toFixed(2);

  res.send(`
<!DOCTYPE html>
<html lang="es" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portal de Pago — ${tenant.name}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>body { font-family: 'Plus Jakarta Sans', sans-serif; }</style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col justify-center items-center p-4">
  <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl">
    <div class="text-center space-y-2">
      <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-400 flex items-center justify-center font-black text-2xl mx-auto shadow-lg shadow-amber-500/20 text-slate-950">₿</div>
      <h1 class="text-lg font-bold text-white">${tenant.name}</h1>
      <p class="text-xs text-slate-400">Renovación de Licencia SaaS SuperPOS</p>
      <div class="bg-slate-950 border border-slate-800 rounded-2xl p-4 mt-2">
        <div class="text-xs text-slate-400 uppercase font-semibold">Monto a Cancelar</div>
        <div class="text-3xl font-black text-emerald-400 mt-1">USD $${tenant.monthlyPrice}.00</div>
        <div class="text-xs text-amber-400 font-mono mt-1">En Bolívares (BCV): Bs. ${bcvAmount}</div>
      </div>
    </div>

    <!-- Pestañas de Pago -->
    <div class="space-y-4">
      <div class="text-xs font-bold text-slate-300 uppercase tracking-wider text-center">Métodos de Pago Disponibles:</div>
      
      <!-- Opción Binance Pay con QR -->
      <div class="bg-amber-950/30 border border-amber-500/40 rounded-2xl p-4 text-center space-y-3">
        <div class="flex items-center justify-center gap-2">
          <span class="text-amber-400 font-bold text-sm">🟡 Binance Pay (USDT)</span>
        </div>
        <div class="bg-white p-3 rounded-2xl inline-block shadow-lg">
          <img src="${cfg.binanceQrUrl}" alt="Binance QR" class="w-44 h-44 mx-auto">
        </div>
        <div class="text-xs text-slate-300">
          Binance Pay ID: <span class="font-mono font-bold text-amber-400 select-all">${cfg.binancePayId}</span>
        </div>
      </div>

      <!-- Pago Móvil -->
      <div class="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-2 text-xs">
        <div class="font-bold text-sky-400">📲 Pago Móvil (Bolívares)</div>
        <div class="text-slate-300">Banco: <span class="font-semibold text-white">${cfg.pagoMovilBanco}</span></div>
        <div class="text-slate-300">Teléfono: <span class="font-mono font-bold text-white">${cfg.pagoMovilTelefono}</span></div>
        <div class="text-slate-300">C.I. / RIF: <span class="font-mono font-bold text-white">${cfg.pagoMovilCedula}</span></div>
      </div>
    </div>

    <div class="text-center pt-2">
      <a href="https://wa.me/?text=${encodeURIComponent('Hola, adjunto mi comprobante de pago de la mensualidad SuperPOS para ' + tenant.name)}" target="_blank" class="w-full inline-block py-3 bg-emerald-600 hover:bg-emerald-500 font-bold text-white rounded-xl text-center transition shadow-lg shadow-emerald-600/30 text-xs">
        ✅ Enviar Comprobante por WhatsApp
      </a>
    </div>
  </div>
</body>
</html>
  `);
});

// =========================================================================
// 4. PANEL MASTER DASHBOARD (ADMINISTRADOR)
// =========================================================================
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="es" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SuperPOS Master Cloud — Centro de Mando SaaS</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>body { font-family: 'Plus Jakarta Sans', sans-serif; }</style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
  <!-- Top Header -->
  <header class="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md p-4 sticky top-0 z-50">
    <div class="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-emerald-500 flex items-center justify-center font-black text-xl shadow-lg shadow-sky-500/20">⚡</div>
        <div>
          <span class="font-bold text-lg text-white">SuperPOS <span class="text-sky-400">Master Cloud</span></span>
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-emerald-400 font-mono font-semibold">● CLOUD PRODUCCIÓN</span>
            <span id="header-bcv" class="text-[10px] text-amber-400 font-mono bg-amber-950/60 px-2.5 py-0.5 rounded-full border border-amber-800/60">Tasa BCV: Sincronizando...</span>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="openConfigModal()" class="bg-slate-800 hover:bg-slate-700 text-amber-400 text-xs font-semibold px-3 py-2 rounded-xl transition flex items-center gap-1.5 border border-slate-700">
          🟡 Configurar Binance QR & BCV
        </button>
        <button onclick="openNewTenantModal()" class="bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition shadow-lg shadow-sky-600/30 flex items-center gap-1.5">
          <span>+</span> Registrar Supermercado
        </button>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
    <!-- Metricas -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg">
        <div class="text-slate-400 text-xs font-semibold uppercase">Supermercados Activos</div>
        <div id="stat-active" class="text-3xl font-black text-emerald-400 mt-2">0</div>
        <div class="text-[11px] text-slate-500 mt-1">Facturando al día</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg">
        <div class="text-slate-400 text-xs font-semibold uppercase">Clientes Suspendidos</div>
        <div id="stat-suspended" class="text-3xl font-black text-rose-400 mt-2">0</div>
        <div class="text-[11px] text-slate-500 mt-1">Bloqueados por falta de pago</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg">
        <div class="text-slate-400 text-xs font-semibold uppercase">Ingresos Mensuales (MRR)</div>
        <div id="stat-revenue" class="text-3xl font-black text-sky-400 mt-2">$0</div>
        <div class="text-[11px] text-slate-500 mt-1">Facturación SaaS recurrente</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg">
        <div class="text-slate-400 text-xs font-semibold uppercase">Total Cajas Conectadas</div>
        <div id="stat-registers" class="text-3xl font-black text-amber-400 mt-2">0</div>
        <div class="text-[11px] text-slate-500 mt-1">Puntos de venta en red</div>
      </div>
    </div>

    <!-- Pestañas -->
    <div class="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
      <button onclick="switchTab('tab-clients')" id="btn-tab-clients" class="px-4 py-2 rounded-xl text-xs font-bold bg-sky-600 text-white transition">🏢 Supermercados & WhatsApp QR</button>
      <button onclick="switchTab('tab-payments')" id="btn-tab-payments" class="px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-slate-400 hover:text-white transition">💵 Pagos Recibidos (Binance/Pago Móvil)</button>
      <button onclick="switchTab('tab-offline')" id="btn-tab-offline" class="px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-slate-400 hover:text-white transition">🔑 Desbloqueo Offline</button>
    </div>

    <!-- TAB 1: Supermercados -->
    <div id="tab-clients" class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      <div class="p-4 border-b border-slate-800 flex justify-between items-center">
        <div>
          <h2 class="font-bold text-base text-white">Supermercados y Comercios Conectados</h2>
          <p class="text-xs text-slate-400">Cobro por WhatsApp con QR de Binance y Kill-Switch remoto.</p>
        </div>
        <button onclick="loadData()" class="text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition">🔄 Actualizar</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
            <tr>
              <th class="p-4">Supermercado / RIF</th>
              <th class="p-4">Ubicación & Contacto</th>
              <th class="p-4">Plan & Canon</th>
              <th class="p-4">Próximo Corte</th>
              <th class="p-4">Cajas / Versión</th>
              <th class="p-4">Estado</th>
              <th class="p-4 text-right">Acciones de Cobro & Kill-Switch</th>
            </tr>
          </thead>
          <tbody id="tenants-tbody" class="divide-y divide-slate-800"></tbody>
        </table>
      </div>
    </div>

    <!-- TAB 2: Pagos -->
    <div id="tab-payments" class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl hidden">
      <div class="p-4 border-b border-slate-800 flex justify-between items-center">
        <div>
          <h2 class="font-bold text-base text-white">Historial y Aprobación de Pagos</h2>
          <p class="text-xs text-slate-400">Cada pago registrado renueva automáticamente el acceso por 30 días.</p>
        </div>
        <button onclick="openPaymentModal()" class="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition">
          + Registrar Pago Recibido
        </button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
            <tr>
              <th class="p-4">Fecha</th>
              <th class="p-4">Supermercado</th>
              <th class="p-4">Monto</th>
              <th class="p-4">Método</th>
              <th class="p-4">Referencia</th>
              <th class="p-4">Estado</th>
            </tr>
          </thead>
          <tbody id="payments-tbody" class="divide-y divide-slate-800"></tbody>
        </table>
      </div>
    </div>

    <!-- TAB 3: Offline -->
    <div id="tab-offline" class="bg-slate-900 border border-slate-800 rounded-2xl p-6 hidden space-y-4">
      <div>
        <h2 class="font-bold text-base text-white">Generador de Clave de Emergencia Offline</h2>
        <p class="text-xs text-slate-400">Si un supermercado se queda sin internet y se bloquea el POS, genérale un código para desbloquearlo temporalmente.</p>
      </div>
      <div class="max-w-md space-y-3 text-xs">
        <div>
          <label class="block text-slate-400 mb-1">Selecciona el Supermercado</label>
          <select id="off-tenant" class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none"></select>
        </div>
        <div>
          <label class="block text-slate-400 mb-1">Días de Gracia sin Internet</label>
          <select id="off-days" class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none">
            <option value="3">3 Días</option>
            <option value="7">7 Días</option>
            <option value="15">15 Días</option>
            <option value="30">30 Días</option>
          </select>
        </div>
        <button onclick="generateOfflineToken()" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 font-bold text-white rounded-xl transition">Generar Clave Criptográfica</button>
        <div id="off-result" class="hidden p-4 bg-emerald-950/80 border border-emerald-500/50 rounded-xl space-y-1">
          <div class="text-[10px] text-emerald-400 uppercase font-bold">Código para el cliente:</div>
          <div id="off-token-text" class="text-xl font-mono font-black text-emerald-300"></div>
          <div class="text-[10px] text-slate-400">El cliente lo ingresa en su pantalla de bloqueo para desbloquear el POS de inmediato.</div>
        </div>
      </div>
    </div>
  </main>

  <!-- Modal Nuevo Supermercado -->
  <div id="modal-tenant" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-3 text-xs shadow-2xl">
      <h3 class="font-bold text-white text-base">Registrar Nuevo Supermercado</h3>
      <form onsubmit="saveTenant(event)" class="space-y-3">
        <div>
          <label class="block text-slate-400 mb-1">Nombre Comercial</label>
          <input id="tn" required placeholder="Ej. Hipermercado Los Andes" class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none">
        </div>
        <div>
          <label class="block text-slate-400 mb-1">RIF Fiscal</label>
          <input id="tr" required placeholder="J-12345678-9" class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none">
        </div>
        <div>
          <label class="block text-slate-400 mb-1">Ciudad / Estado</label>
          <input id="tc" required placeholder="Maracay, Aragua" class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none">
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-slate-400 mb-1">Plan SaaS</label>
            <select id="tp" class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none">
              <option value="BASICO">Básico ($35)</option>
              <option value="PROFESIONAL" selected>Profesional ($60)</option>
              <option value="ENTERPRISE">Enterprise ($120)</option>
            </select>
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Precio ($/mes)</label>
            <input id="tm" type="number" value="60" class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none">
          </div>
        </div>
        <div>
          <label class="block text-slate-400 mb-1">Contacto / Nombre</label>
          <input id="tcontact" placeholder="Gerente / Dueño" class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none">
        </div>
        <div>
          <label class="block text-slate-400 mb-1">Teléfono WhatsApp (Ej: 584121234567)</label>
          <input id="tphone" placeholder="584121234567" class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none">
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeNewTenantModal()" class="px-3 py-2 bg-slate-800 rounded-xl text-slate-300">Cancelar</button>
          <button type="submit" class="px-4 py-2 bg-sky-600 font-bold rounded-xl text-white">Guardar Supermercado</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Modal Registrar Pago -->
  <div id="modal-payment" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-3 text-xs shadow-2xl">
      <h3 class="font-bold text-white text-base">Registrar Pago y Renovar 30 Días</h3>
      <form onsubmit="savePayment(event)" class="space-y-3">
        <div>
          <label class="block text-slate-400 mb-1">Seleccionar Supermercado</label>
          <select id="pay-tenant" class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none"></select>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-slate-400 mb-1">Monto Pagado ($ o USDT)</label>
            <input id="pay-amount" type="number" value="60" required class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Método de Pago</label>
            <select id="pay-method" class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none">
              <option value="Binance Pay">Binance Pay (USDT)</option>
              <option value="Pago Movil">Pago Móvil (Bs)</option>
              <option value="Zelle">Zelle</option>
              <option value="Transferencia Bancaria">Transferencia Bancaria</option>
              <option value="Efectivo Divisas">Efectivo Divisas</option>
            </select>
          </div>
        </div>
        <div>
          <label class="block text-slate-400 mb-1">Número de Referencia / ID de Transacción</label>
          <input id="pay-ref" required placeholder="Ej: BINANCE-991204 / REF-312" class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none">
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closePaymentModal()" class="px-3 py-2 bg-slate-800 rounded-xl text-slate-300">Cancelar</button>
          <button type="submit" class="px-4 py-2 bg-emerald-600 font-bold rounded-xl text-white">Aprobar y Renovar 30 Días</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Modal Configuración Binance QR & BCV -->
  <div id="modal-config" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 text-xs shadow-2xl overflow-y-auto max-h-[90vh]">
      <div class="flex justify-between items-center">
        <h3 class="font-bold text-white text-base">Ajustes de Cobro (Binance Pay & BCV)</h3>
        <button onclick="refreshLiveBcv()" class="bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 px-2.5 py-1 rounded-lg font-bold">🔄 Sincronizar BCV Ahora</button>
      </div>
      <form onsubmit="saveConfig(event)" class="space-y-3">
        <div class="p-3 bg-amber-950/40 border border-amber-500/40 rounded-xl space-y-2">
          <div class="font-bold text-amber-400">🟡 Datos de Binance Pay (USDT)</div>
          <div>
            <label class="block text-slate-400 mb-1">Tu Binance Pay ID</label>
            <input id="cfg-binance-id" required placeholder="Ej: 123456789" class="w-full bg-slate-950 border border-slate-700 p-2 rounded-lg text-white outline-none font-mono">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Enlace de tu Código QR de Binance</label>
            <input id="cfg-binance-qr" required placeholder="https://..." class="w-full bg-slate-950 border border-slate-700 p-2 rounded-lg text-white outline-none font-mono">
          </div>
        </div>

        <div class="p-3 bg-sky-950/40 border border-sky-500/40 rounded-xl space-y-2">
          <div class="font-bold text-sky-400">📲 Datos de Pago Móvil & Zelle</div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-slate-400 mb-1">Banco</label>
              <input id="cfg-pm-banco" placeholder="Banesco / Venezuela" class="w-full bg-slate-950 border border-slate-700 p-2 rounded-lg text-white outline-none">
            </div>
            <div>
              <label class="block text-slate-400 mb-1">Teléfono</label>
              <input id="cfg-pm-tel" placeholder="0412-1234567" class="w-full bg-slate-950 border border-slate-700 p-2 rounded-lg text-white outline-none">
            </div>
          </div>
          <div>
            <label class="block text-slate-400 mb-1">C.I. / RIF del Pago Móvil</label>
            <input id="cfg-pm-ci" placeholder="V-12345678" class="w-full bg-slate-950 border border-slate-700 p-2 rounded-lg text-white outline-none">
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeConfigModal()" class="px-3 py-2 bg-slate-800 rounded-xl text-slate-300">Cancelar</button>
          <button type="submit" class="px-4 py-2 bg-sky-600 font-bold rounded-xl text-white">Guardar Configuración</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    let globalData = { tenants: [], payments: [], config: {} };

    async function loadData() {
      try {
        const res = await fetch('/api/cloud/admin/data');
        globalData = await res.json();
        
        let active = 0, suspended = 0, mrr = 0, totalRegs = 0;
        const tb = document.getElementById('tenants-tbody');
        const pb = document.getElementById('payments-tbody');
        const offSel = document.getElementById('off-tenant');
        const paySel = document.getElementById('pay-tenant');

        tb.innerHTML = '';
        pb.innerHTML = '';
        offSel.innerHTML = '';
        paySel.innerHTML = '';

        document.getElementById('header-bcv').innerText = 'Tasa BCV: Bs. ' + (globalData.config.bcvRate || '--') + ' (Oficial)';

        // Supermercados
        globalData.tenants.forEach(t => {
          if (t.status === 'ACTIVE') { active++; mrr += (t.monthlyPrice || 0); }
          else { suspended++; }
          totalRegs += (t.activeRegisters || 1);

          const act = t.status === 'ACTIVE';
          const dueDate = new Date(t.nextDueDate);
          const daysLeft = Math.ceil((dueDate - Date.now()) / (1000 * 60 * 60 * 24));
          
          let dueBadge = '<span class="text-emerald-400 font-bold">' + daysLeft + ' días</span>';
          if (daysLeft <= 3 && daysLeft > 0) dueBadge = '<span class="text-amber-400 font-bold bg-amber-950/60 px-2 py-0.5 rounded-full border border-amber-800/60">⚠️ Vence en ' + daysLeft + ' d</span>';
          if (daysLeft <= 0) dueBadge = '<span class="text-rose-400 font-bold bg-rose-950/60 px-2 py-0.5 rounded-full border border-rose-800/60">🚨 En Mora</span>';

          // Mensaje con Enlace de Pago Binance / QR
          const phone = t.contactPhone || '584120000000';
          const bcvAmount = ((t.monthlyPrice || 60) * (globalData.config.bcvRate || 41.85)).toFixed(2);
          const payLink = window.location.origin + '/pay/' + t.id;
          
          const waMsg = encodeURIComponent(
            'Hola estimado(a) ' + (t.contactName || t.name) + ', le saludamos cordialmente de SuperPOS Cloud.\\n\\n' +
            'Le recordamos que el canon mensual de su sistema vence el ' + dueDate.toLocaleDateString() + '.\\n' +
            '💵 Monto: USD $' + t.monthlyPrice + ' / USDT ' + t.monthlyPrice + ' (o Bs. ' + bcvAmount + ' a tasa BCV).\\n\\n' +
            '🟡 Paga fácil con BINANCE PAY o PAGO MÓVIL escaneando el QR aquí:\\n' +
            payLink + '\\n\\n' +
            'Agradecemos enviar el comprobante por este medio. ¡Muchas gracias!'
          );
          const waLink = 'https://wa.me/' + phone + '?text=' + waMsg;

          const opt = document.createElement('option');
          opt.value = t.id;
          opt.innerText = t.name + ' (' + t.rif + ')';
          offSel.appendChild(opt.cloneNode(true));
          paySel.appendChild(opt);

          const tr = document.createElement('tr');
          tr.className = 'hover:bg-slate-800/40 transition';
          tr.innerHTML = \`
            <td class="p-4 font-bold text-white">
              \${t.name}
              <div class="text-[10px] text-slate-500 font-mono">\${t.rif}</div>
            </td>
            <td class="p-4 text-slate-400">
              <div>\${t.city}</div>
              <div class="text-[10px] text-slate-500">\${t.contactName || ''} (\${t.contactPhone || ''})</div>
            </td>
            <td class="p-4">
              <span class="font-bold">\${t.plan}</span>
              <div class="text-emerald-400 font-bold">$\${t.monthlyPrice}/mes</div>
            </td>
            <td class="p-4">
              <div class="text-[11px] text-slate-300 font-semibold">\${dueDate.toLocaleDateString()}</div>
              <div>\${dueBadge}</div>
            </td>
            <td class="p-4 font-mono text-[11px]">
              <span class="text-amber-400 font-bold">\${t.activeRegisters || 1} Cajas</span>
              <div class="text-[10px] text-slate-500">\${t.currentVersion || 'v2.4.0'}</div>
            </td>
            <td class="p-4">
              \${act ? '<span class="bg-emerald-950 text-emerald-400 border border-emerald-800 px-2.5 py-1 rounded-full text-[10px] font-bold">● ACTIVO</span>' : '<span class="bg-rose-950 text-rose-400 border border-rose-800 px-2.5 py-1 rounded-full text-[10px] font-bold">■ SUSPENDIDO</span>'}
            </td>
            <td class="p-4 text-right space-x-1.5">
              <a href="\${waLink}" target="_blank" class="inline-block bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-600/40 px-2.5 py-1 rounded-xl font-bold transition">
                📲 Cobrar QR
              </a>
              <a href="/pay/\${t.id}" target="_blank" class="inline-block bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white border border-amber-600/40 px-2.5 py-1 rounded-xl font-bold transition">
                🟡 Ver Factura
              </a>
              \${act ? 
                \`<button onclick="toggleStatus('\${t.id}', 'SUSPENDED')" class="bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-600 px-2.5 py-1 rounded-xl font-bold transition">🔒 Suspender</button>\` : 
                \`<button onclick="toggleStatus('\${t.id}', 'ACTIVE')" class="bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-600 px-2.5 py-1 rounded-xl font-bold transition">🔓 Reactivar</button>\`
              }
            </td>
          \`;
          tb.appendChild(tr);
        });

        // Pagos
        globalData.payments.forEach(p => {
          const ptr = document.createElement('tr');
          ptr.className = 'hover:bg-slate-800/40 transition';
          ptr.innerHTML = \`
            <td class="p-4 text-slate-400 font-mono text-[11px]">\${new Date(p.date).toLocaleDateString()}</td>
            <td class="p-4 font-bold text-white">\${p.tenantName}</td>
            <td class="p-4 text-emerald-400 font-black">\${p.currency} \${p.amount}</td>
            <td class="p-4"><span class="bg-slate-800 text-amber-400 px-2 py-0.5 rounded-md font-semibold">\${p.method}</span></td>
            <td class="p-4 font-mono text-slate-400">\${p.reference}</td>
            <td class="p-4"><span class="text-emerald-400 font-bold">✓ \${p.status}</span></td>
          \`;
          pb.appendChild(ptr);
        });

        document.getElementById('stat-active').innerText = active;
        document.getElementById('stat-suspended').innerText = suspended;
        document.getElementById('stat-revenue').innerText = '$' + mrr;
        document.getElementById('stat-registers').innerText = totalRegs;
      } catch (e) { console.error(e); }
    }

    async function toggleStatus(tenantId, newStatus) {
      if (!confirm('¿Deseas cambiar el estado a: ' + newStatus + '?')) return;
      await fetch('/api/cloud/admin/toggle-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, status: newStatus })
      });
      loadData();
    }

    async function generateOfflineToken() {
      const tenantId = document.getElementById('off-tenant').value;
      const days = document.getElementById('off-days').value;
      const res = await fetch('/api/cloud/admin/generate-offline-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, days })
      });
      const data = await res.json();
      document.getElementById('off-token-text').innerText = data.token;
      document.getElementById('off-result').classList.remove('hidden');
    }

    function switchTab(tabId) {
      document.getElementById('tab-clients').classList.add('hidden');
      document.getElementById('tab-payments').classList.add('hidden');
      document.getElementById('tab-offline').classList.add('hidden');

      ['btn-tab-clients', 'btn-tab-payments', 'btn-tab-offline'].forEach(id => {
        document.getElementById(id).className = 'px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-slate-400 hover:text-white transition';
      });

      document.getElementById(tabId).classList.remove('hidden');
      document.getElementById('btn-' + tabId).className = 'px-4 py-2 rounded-xl text-xs font-bold bg-sky-600 text-white transition';
    }

    function openNewTenantModal() { document.getElementById('modal-tenant').classList.remove('hidden'); }
    function closeNewTenantModal() { document.getElementById('modal-tenant').classList.add('hidden'); }

    function openPaymentModal() { document.getElementById('modal-payment').classList.remove('hidden'); }
    function closePaymentModal() { document.getElementById('modal-payment').classList.add('hidden'); }

    function openConfigModal() { 
      document.getElementById('cfg-binance-id').value = globalData.config.binancePayId || '';
      document.getElementById('cfg-binance-qr').value = globalData.config.binanceQrUrl || '';
      document.getElementById('cfg-pm-banco').value = globalData.config.pagoMovilBanco || '';
      document.getElementById('cfg-pm-tel').value = globalData.config.pagoMovilTelefono || '';
      document.getElementById('cfg-pm-ci').value = globalData.config.pagoMovilCedula || '';
      document.getElementById('modal-config').classList.remove('hidden'); 
    }
    function closeConfigModal() { document.getElementById('modal-config').classList.add('hidden'); }

    async function refreshLiveBcv() {
      await fetch('/api/cloud/admin/update-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshBcv: true })
      });
      alert('Tasa oficial BCV sincronizada con éxito.');
      loadData();
    }

    async function saveTenant(e) {
      e.preventDefault();
      await fetch('/api/cloud/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('tn').value,
          rif: document.getElementById('tr').value,
          city: document.getElementById('tc').value,
          plan: document.getElementById('tp').value,
          monthlyPrice: document.getElementById('tm').value,
          contactName: document.getElementById('tcontact').value,
          contactPhone: document.getElementById('tphone').value
        })
      });
      closeNewTenantModal();
      loadData();
    }

    async function savePayment(e) {
      e.preventDefault();
      await fetch('/api/cloud/admin/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: document.getElementById('pay-tenant').value,
          amount: document.getElementById('pay-amount').value,
          method: document.getElementById('pay-method').value,
          reference: document.getElementById('pay-ref').value
        })
      });
      closePaymentModal();
      loadData();
    }

    async function saveConfig(e) {
      e.preventDefault();
      await fetch('/api/cloud/admin/update-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          binancePayId: document.getElementById('cfg-binance-id').value,
          binanceQrUrl: document.getElementById('cfg-binance-qr').value,
          pagoMovilBanco: document.getElementById('cfg-pm-banco').value,
          pagoMovilTelefono: document.getElementById('cfg-pm-tel').value,
          pagoMovilCedula: document.getElementById('cfg-pm-ci').value
        })
      });
      closeConfigModal();
      loadData();
    }

    loadData();
    setInterval(loadData, 10000);
  </script>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('SuperPOS Master Cloud v3.0 listo en puerto ' + PORT);
});
