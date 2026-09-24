const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

const DATA_FILE = path.join(__dirname, 'tenants.json');
const PAYMENTS_FILE = path.join(__dirname, 'payments.json');
const CONFIG_FILE = path.join(__dirname, 'system_config.json');
const BACKUPS_DIR = path.join(__dirname, 'backups_vault');

if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

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
      currency: 'USD',
      method: 'Pago Movil',
      reference: 'PM-889412',
      date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'APROBADO'
    }
  ]);
}

function getSystemConfig() {
  return readJson(CONFIG_FILE, {
    bcvRate: 41.85,
    latestVersion: 'v2.4.0',
    releaseNotes: 'Soporte para balanzas IP Toledo y optimización de arqueo ciego.',
    secretKey: 'SUPERPOS_SAAS_SECRET_KEY_2026'
  });
}

// =========================================================================
// 1. APIS DE SINCRONIZACIÓN Y HEARTBEAT (CLIENTE LOCAL -> CLOUD)
// =========================================================================
app.post('/api/cloud/license/heartbeat', (req, res) => {
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
    latestVersion: sysConfig.latestVersion,
    updateAvailable: tenant.currentVersion !== sysConfig.latestVersion
  });
});

// Consulta de Tasa BCV Oficial
app.get('/api/cloud/bcv-rate', (req, res) => {
  const config = getSystemConfig();
  res.json({ rate: config.bcvRate, updated: new Date().toISOString() });
});

// =========================================================================
// 2. APIS ADMINISTRATIVAS (SUPERADMIN SAAS)
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

// Registrar y Aprobar Pago (Extiende 30 días automáticamente)
app.post('/api/cloud/admin/payments', (req, res) => {
  const { tenantId, amount, method, reference } = req.body || {};
  let tenants = getTenants();
  let payments = getPayments();
  const tenant = tenants.find(t => t.id === tenantId);
  if (!tenant) return res.status(404).json({ error: 'Supermercado no encontrado' });

  // Extender 30 días la fecha de corte
  const currentDue = new Date(tenant.nextDueDate).getTime();
  const baseTime = currentDue > Date.now() ? currentDue : Date.now();
  tenant.nextDueDate = new Date(baseTime + 30 * 24 * 60 * 60 * 1000).toISOString();
  tenant.status = 'ACTIVE';

  const newPayment = {
    id: 'pay-' + Date.now(),
    tenantId: tenant.id,
    tenantName: tenant.name,
    amount: Number(amount) || tenant.monthlyPrice,
    currency: 'USD',
    method: method || 'Pago Movil',
    reference: reference || 'REF-' + Math.floor(Math.random() * 900000 + 100000),
    date: new Date().toISOString(),
    status: 'APROBADO'
  };

  payments.unshift(newPayment);
  writeJson(DATA_FILE, tenants);
  writeJson(PAYMENTS_FILE, payments);
  res.json({ success: true, payment: newPayment, newDueDate: tenant.nextDueDate });
});

// Actualizar Tasa BCV y Versión OTA
app.post('/api/cloud/admin/update-config', (req, res) => {
  const { bcvRate, latestVersion, releaseNotes } = req.body || {};
  let config = getSystemConfig();
  if (bcvRate) config.bcvRate = Number(bcvRate);
  if (latestVersion) config.latestVersion = latestVersion;
  if (releaseNotes) config.releaseNotes = releaseNotes;
  writeJson(CONFIG_FILE, config);
  res.json({ success: true, config });
});

// Generador de Token Criptográfico Offline
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
// 3. DASHBOARD VISUAL WEB DE SUPERADMIN (TAILWIND FULL-SUITE)
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
  <!-- Top Navigation -->
  <header class="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md p-4 sticky top-0 z-50">
    <div class="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-emerald-500 flex items-center justify-center font-black text-xl shadow-lg shadow-sky-500/20">⚡</div>
        <div>
          <span class="font-bold text-lg text-white">SuperPOS <span class="text-sky-400">Master Cloud</span></span>
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-emerald-400 font-mono font-semibold">● CLOUD PRODUCCIÓN</span>
            <span id="header-bcv" class="text-[10px] text-amber-400 font-mono bg-amber-950/60 px-2 py-0.5 rounded-full border border-amber-800/60">Tasa BCV: Bs. --</span>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="openConfigModal()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold px-3 py-2 rounded-xl transition flex items-center gap-1.5 border border-slate-700">
          ⚙️ Ajustar Tasa BCV & OTA
        </button>
        <button onclick="openNewTenantModal()" class="bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition shadow-lg shadow-sky-600/30 flex items-center gap-1.5">
          <span>+</span> Registrar Supermercado
        </button>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
    <!-- Métricas Globales -->
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

    <!-- Pestañas Principales -->
    <div class="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
      <button onclick="switchTab('tab-clients')" id="btn-tab-clients" class="px-4 py-2 rounded-xl text-xs font-bold bg-sky-600 text-white transition">🏢 Supermercados & Licencias</button>
      <button onclick="switchTab('tab-payments')" id="btn-tab-payments" class="px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-slate-400 hover:text-white transition">💵 Aprobación de Pagos (+30 Días)</button>
      <button onclick="switchTab('tab-offline')" id="btn-tab-offline" class="px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-slate-400 hover:text-white transition">🔑 Desbloqueo Offline</button>
    </div>

    <!-- TAB 1: Supermercados y WhatsApp -->
    <div id="tab-clients" class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      <div class="p-4 border-b border-slate-800 flex justify-between items-center">
        <div>
          <h2 class="font-bold text-base text-white">Supermercados y Comercios Conectados</h2>
          <p class="text-xs text-slate-400">Control de licencias, cobro por WhatsApp en 1 clic y Kill-Switch remoto.</p>
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
              <th class="p-4 text-right">Acciones (WhatsApp / Kill-Switch)</th>
            </tr>
          </thead>
          <tbody id="tenants-tbody" class="divide-y divide-slate-800"></tbody>
        </table>
      </div>
    </div>

    <!-- TAB 2: Pagos & Renovaciones -->
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
              <th class="p-4">Monto ($)</th>
              <th class="p-4">Método</th>
              <th class="p-4">Referencia</th>
              <th class="p-4">Estado</th>
            </tr>
          </thead>
          <tbody id="payments-tbody" class="divide-y divide-slate-800"></tbody>
        </table>
      </div>
    </div>

    <!-- TAB 3: Generador Offline -->
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
          <label class="block text-slate-400 mb-1">Nombre de Contacto</label>
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
            <label class="block text-slate-400 mb-1">Monto Pagado ($)</label>
            <input id="pay-amount" type="number" value="60" required class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Método de Pago</label>
            <select id="pay-method" class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none">
              <option value="Pago Movil">Pago Móvil</option>
              <option value="Zelle">Zelle</option>
              <option value="Transferencia Bancaria">Transferencia Bancaria</option>
              <option value="Efectivo Divisas">Efectivo Divisas</option>
            </select>
          </div>
        </div>
        <div>
          <label class="block text-slate-400 mb-1">Número de Referencia / Comprobante</label>
          <input id="pay-ref" required placeholder="Ej: PM-491204" class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none">
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closePaymentModal()" class="px-3 py-2 bg-slate-800 rounded-xl text-slate-300">Cancelar</button>
          <button type="submit" class="px-4 py-2 bg-emerald-600 font-bold rounded-xl text-white">Aprobar y Renovar 30 Días</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Modal Configuración Tasa BCV & OTA -->
  <div id="modal-config" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-3 text-xs shadow-2xl">
      <h3 class="font-bold text-white text-base">Ajustes Globales (BCV & OTA Updates)</h3>
      <form onsubmit="saveConfig(event)" class="space-y-3">
        <div>
          <label class="block text-slate-400 mb-1">Tasa Oficial BCV Actual (Bs. / USD)</label>
          <input id="cfg-bcv" type="number" step="0.01" required class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none">
        </div>
        <div>
          <label class="block text-slate-400 mb-1">Última Versión Oficial del Software</label>
          <input id="cfg-version" required placeholder="v2.4.0" class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none">
        </div>
        <div>
          <label class="block text-slate-400 mb-1">Notas de la Actualización</label>
          <textarea id="cfg-notes" rows="2" class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none"></textarea>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeConfigModal()" class="px-3 py-2 bg-slate-800 rounded-xl text-slate-300">Cancelar</button>
          <button type="submit" class="px-4 py-2 bg-sky-600 font-bold rounded-xl text-white">Guardar Ajustes</button>
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

        document.getElementById('header-bcv').innerText = 'Tasa BCV: Bs. ' + (globalData.config.bcvRate || '--');

        // Supermercados
        globalData.tenants.forEach(t => {
          if (t.status === 'ACTIVE') { active++; mrr += (t.monthlyPrice || 0); }
          else { suspended++; }
          totalRegs += (t.activeRegisters || 1);

          const act = t.status === 'ACTIVE';
          const dueDate = new Date(t.nextDueDate);
          const daysLeft = Math.ceil((dueDate - Date.now()) / (1000 * 60 * 60 * 24));
          
          let dueBadge = '<span class="text-emerald-400 font-bold">' + daysLeft + ' días restantes</span>';
          if (daysLeft <= 3 && daysLeft > 0) dueBadge = '<span class="text-amber-400 font-bold bg-amber-950/60 px-2 py-0.5 rounded-full border border-amber-800/60">⚠️ Vence en ' + daysLeft + ' días</span>';
          if (daysLeft <= 0) dueBadge = '<span class="text-rose-400 font-bold bg-rose-950/60 px-2 py-0.5 rounded-full border border-rose-800/60">🚨 En Mora</span>';

          // Mensaje personalizado de WhatsApp
          const phone = t.contactPhone || '584120000000';
          const bcvAmount = ((t.monthlyPrice || 60) * (globalData.config.bcvRate || 41.85)).toFixed(2);
          const waMsg = encodeURIComponent('Hola estimado(a) ' + (t.contactName || t.name) + ', le saludamos cordialmente de SuperPOS Cloud. Le recordamos que el canon de servicio de su sistema vence el ' + dueDate.toLocaleDateString() + ' por un monto de USD $' + t.monthlyPrice + ' (o Bs. ' + bcvAmount + ' a tasa oficial BCV). Agradecemos confirmar su comprobante de pago para mantener su servicio activo. ¡Muchas gracias!');
          const waLink = 'https://wa.me/' + phone + '?text=' + waMsg;

          // Opciones en selectores
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
              <div class="text-[10px] text-slate-500">\${t.contactName || ''} (\${t.contactPhone || 'Sin tel'})</div>
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
                📲 WhatsApp
              </a>
              \${act ? 
                \`<button onclick="toggleStatus('\${t.id}', 'SUSPENDED')" class="bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-600 px-2.5 py-1 rounded-xl font-bold transition">🔒 Suspender</button>\` : 
                \`<button onclick="toggleStatus('\${t.id}', 'ACTIVE')" class="bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-600 px-2.5 py-1 rounded-xl font-bold transition">🔓 Reactivar</button>\`
              }
            </td>
          \`;
          tb.appendChild(tr);
        });

        // Historial de Pagos
        globalData.payments.forEach(p => {
          const ptr = document.createElement('tr');
          ptr.className = 'hover:bg-slate-800/40 transition';
          ptr.innerHTML = \`
            <td class="p-4 text-slate-400 font-mono text-[11px]">\${new Date(p.date).toLocaleDateString()}</td>
            <td class="p-4 font-bold text-white">\${p.tenantName}</td>
            <td class="p-4 text-emerald-400 font-black">USD $\${p.amount}</td>
            <td class="p-4"><span class="bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md font-semibold">\${p.method}</span></td>
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
      document.getElementById('cfg-bcv').value = globalData.config.bcvRate || 41.85;
      document.getElementById('cfg-version').value = globalData.config.latestVersion || 'v2.4.0';
      document.getElementById('cfg-notes').value = globalData.config.releaseNotes || '';
      document.getElementById('modal-config').classList.remove('hidden'); 
    }
    function closeConfigModal() { document.getElementById('modal-config').classList.add('hidden'); }

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
          bcvRate: document.getElementById('cfg-bcv').value,
          latestVersion: document.getElementById('cfg-version').value,
          releaseNotes: document.getElementById('cfg-notes').value
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
  console.log('SuperPOS Master Cloud v2.5 listo en puerto ' + PORT);
});
