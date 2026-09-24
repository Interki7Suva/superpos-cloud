/**
 * ==============================================================================
 * SUPERPOS MASTER CLOUD SAAS - SERVER.JS (EDICIÓN AVANZADA DE PERMISOS Y MÓDULOS)
 * Servidor Central: Render & Hetzner Cloud
 * 
 * Funcionalidades Principales:
 *  1. Gestión Total de Supermercados: Datos, Contacto, Vencimiento y Plan
 *  2. Control Granular de Permisos de Módulos (POS, Inventario, Balanzas, IA/ML, etc.)
 *  3. Límites de Capacidad: Cantidad Máxima de Usuarios y Estaciones de Trabajo
 *  4. Sincronización Automática Diaria con el Portal Oficial del BCV (bcv.org.ve)
 *  5. Carga directa de imagen QR de Binance Pay (Base64) - Sin URLs externas
 *  6. Kill-Switch remoto, Bóveda de Respaldos y Tokens Criptográficos Offline
 *  7. Portal Público de Pagos (/pay/:tenantId) con Tasa BCV en vivo y QR Binance
 * ==============================================================================
 */

const fastify = require('fastify')({ logger: true, bodyLimit: 20 * 1024 * 1024 });
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

fastify.register(require('@fastify/cors'), { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] });
fastify.register(require('@fastify/multipart'), { limits: { fileSize: 100 * 1024 * 1024 } });

const DATA_DIR = path.join(__dirname, 'data');
const BACKUPS_VAULT = path.join(DATA_DIR, 'backups_vault');
const TENANTS_FILE = path.join(DATA_DIR, 'tenants_master.json');
const CONFIG_FILE = path.join(DATA_DIR, 'system_config.json');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments_master.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUPS_VAULT)) fs.mkdirSync(BACKUPS_VAULT, { recursive: true });

function readJson(f, fallback = []) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fallback; }
}
function writeJson(f, d) {
  fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8');
}

// Lista oficial de módulos del ecosistema SuperPOS
const ALL_AVAILABLE_MODULES = [
  { id: 'pos', name: 'Punto de Venta (POS & Facturación)', icon: '🛒', desc: 'Venta rápida, códigos de barra, multi-moneda y cobro' },
  { id: 'inventory', name: 'Control de Inventarios & Almacén', icon: '📦', desc: 'Stock mínimo, kardex, lotes, vencimientos y traslados' },
  { id: 'scales', name: 'Balanzas & Códigos Pesables', icon: '⚖️', desc: 'Charcutería, carnicería, verduras y prefijo 20' },
  { id: 'purchases_ml', name: 'Compras & Sugerencias IA/ML', icon: '🤖', desc: 'Órdenes de compra y predicción de agotamiento' },
  { id: 'quotations', name: 'Presupuestos & Proformas', icon: '📋', desc: 'Emisión de cotizaciones congelando precios y conversión' },
  { id: 'shelf_labels', name: 'Habladores & Etiquetas QR', icon: '🏷️', desc: 'Impresión de precios bimoneda y código QR para anaqueles' },
  { id: 'promotions_combos', name: 'Promociones & Combos 2x1', icon: '🎁', desc: 'Reglas de descuento por volumen, días especiales y combos' },
  { id: 'fiscal_reports', name: 'Reportes Fiscales SENIAT', icon: '🏛️', desc: 'Reportes Z, Libro de Ventas y auditoría de impresoras fiscales' },
  { id: 'delivery_notes', name: 'Notas de Entrega & Guías', icon: '🚚', desc: 'Despacho de mercancía con numeración correlativa' },
  { id: 'pagomovil_c2p', name: 'Pasarela Pago Móvil C2P & Fintech', icon: '📱', desc: 'Validación en vivo BDV y cuotas Cashea' },
  { id: 'loss_prevention', name: 'Auditoría & Prevención de Mermas', icon: '🛡️', desc: 'Detección de mermas, anulaciones y transacciones sospechosas' },
  { id: 'cloud_backups', name: 'Bóveda de Respaldos Cloud', icon: '☁️', desc: 'Copia de seguridad encriptada en el servidor central' }
];

// Configuración inicial del sistema
if (!fs.existsSync(CONFIG_FILE)) {
  writeJson(CONFIG_FILE, {
    adminSecret: 'SuperPOS_Master_Secret_2026',
    bcvRate: 854.4637,
    bcvLastUpdated: new Date().toISOString(),
    bcvAutoSync: true,
    pagoMovilBank: 'Banco de Venezuela (0102)',
    pagoMovilPhone: '0414-2329011',
    pagoMovilRif: 'V-26123456-7',
    binanceId: '849201948',
    binancePayId: 'superpos@binance',
    binanceQrBase64: '',
    usdtNetwork: 'USDT (TRC20 / BEP20)'
  });
}

// Inicializar tenants por defecto
if (!fs.existsSync(TENANTS_FILE)) {
  writeJson(TENANTS_FILE, [
    {
      id: 'tenant-super-1',
      name: 'Supermercado Central Express, C.A.',
      rif: 'J-31456982-1',
      city: 'Maracay, Edo. Aragua',
      plan: 'PROFESIONAL',
      monthlyPrice: 60,
      status: 'ACTIVE',
      maxUsers: 10,
      maxWorkstations: 4,
      enabledModules: [
        'pos',
        'inventory',
        'scales',
        'purchases_ml',
        'quotations',
        'shelf_labels',
        'promotions_combos',
        'fiscal_reports',
        'delivery_notes',
        'pagomovil_c2p',
        'loss_prevention',
        'cloud_backups'
      ],
      lastHeartbeat: new Date().toISOString(),
      nextDueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
      contactName: 'Gerencia General',
      contactPhone: '+58 412-1234567'
    }
  ]);
}

// ==============================================================================
// 1. MOTOR DE EXTRACCIÓN OFICIAL BCV (https://www.bcv.org.ve)
// ==============================================================================
async function fetchOfficialBcvRate() {
  console.log('[BCV-Scraper] Consultando portal oficial https://www.bcv.org.ve ...');
  
  const parseHtmlForUsd = (html) => {
    let rawStr = null;
    const matchDolar = html.match(/id=["']dolar["'][\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/i);
    if (matchDolar && matchDolar[1]) {
      rawStr = matchDolar[1].trim();
    } else {
      const matchUsd = html.match(/USD[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/i);
      if (matchUsd && matchUsd[1]) rawStr = matchUsd[1].trim();
    }

    if (rawStr) {
      if (rawStr.includes('.') && rawStr.includes(',')) {
        rawStr = rawStr.replace(/\./g, '').replace(',', '.');
      } else if (rawStr.includes(',')) {
        rawStr = rawStr.replace(',', '.');
      }
      const val = parseFloat(rawStr);
      if (!isNaN(val) && val > 0) return Number(val.toFixed(4));
    }
    return null;
  };

  try {
    const html = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'www.bcv.org.ve',
        port: 443,
        path: '/',
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-VE,es;q=0.9',
        },
        rejectUnauthorized: false,
        timeout: 10000,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout de conexión a bcv.org.ve')); });
      req.end();
    });

    const parsedRate = parseHtmlForUsd(html);
    if (parsedRate) {
      console.log(`[BCV-Scraper] ✅ Tasa oficial extraída con éxito de bcv.org.ve: ${parsedRate} Bs/USD`);
      return { rate: parsedRate, source: 'PORTAL_OFICIAL_BCV', date: new Date().toISOString() };
    }
  } catch (err) {
    console.warn(`[BCV-Scraper] Accediendo por canal redundante oficial: ${err.message}`);
  }

  try {
    const backupRate = await new Promise((resolve) => {
      const req = https.get('https://ve.dolarapi.com/v1/dolares/oficial', { timeout: 6000 }, (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(raw);
            const val = parseFloat(json.promedio);
            if (!isNaN(val) && val > 0) resolve(Number(val.toFixed(4)));
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });

    if (backupRate) {
      console.log(`[BCV-Scraper] ✅ Tasa obtenida de canal redundante BCV: ${backupRate} Bs/USD`);
      return { rate: backupRate, source: 'ESPEJO_REDUNDANTE_BCV', date: new Date().toISOString() };
    }
  } catch (e) {}

  const cfg = readJson(CONFIG_FILE, {});
  return { rate: cfg.bcvRate || 854.4637, source: 'CACHE_RETENIDO', date: cfg.bcvLastUpdated || new Date().toISOString() };
}

async function syncAndSaveBcvRate() {
  const result = await fetchOfficialBcvRate();
  const cfg = readJson(CONFIG_FILE, {});
  cfg.bcvRate = result.rate;
  cfg.bcvLastUpdated = result.date;
  cfg.bcvSource = result.source;
  writeJson(CONFIG_FILE, cfg);
  return result;
}

// Sincronizar en arranque y programar cada hora
syncAndSaveBcvRate();
setInterval(() => {
  const now = new Date();
  const hour = now.getUTCHours();
  if (hour === 8 || hour === 12 || hour === 17) {
    syncAndSaveBcvRate();
  }
}, 60 * 60 * 1000);

// ==============================================================================
// 2. ENDPOINTS DE TASA BCV & CONFIGURACIÓN
// ==============================================================================
fastify.get('/api/cloud/bcv-rate', async () => {
  const cfg = readJson(CONFIG_FILE, {});
  return {
    rate: cfg.bcvRate || 854.4637,
    lastUpdated: cfg.bcvLastUpdated,
    source: cfg.bcvSource || 'bcv.org.ve',
    currency: 'VES/USD'
  };
});

fastify.post('/api/cloud/bcv-rate/sync-now', async () => {
  const res = await syncAndSaveBcvRate();
  return { success: true, ...res };
});

fastify.get('/api/cloud/system-config', async () => {
  const cfg = readJson(CONFIG_FILE, {});
  return {
    pagoMovilBank: cfg.pagoMovilBank,
    pagoMovilPhone: cfg.pagoMovilPhone,
    pagoMovilRif: cfg.pagoMovilRif,
    binanceId: cfg.binanceId,
    binancePayId: cfg.binancePayId,
    binanceQrBase64: cfg.binanceQrBase64 || '',
    usdtNetwork: cfg.usdtNetwork,
    bcvRate: cfg.bcvRate,
    bcvLastUpdated: cfg.bcvLastUpdated,
    availableModules: ALL_AVAILABLE_MODULES
  };
});

fastify.post('/api/cloud/admin/update-config', async (request) => {
  const body = request.body || {};
  const cfg = readJson(CONFIG_FILE, {});
  
  if (body.pagoMovilBank) cfg.pagoMovilBank = body.pagoMovilBank;
  if (body.pagoMovilPhone) cfg.pagoMovilPhone = body.pagoMovilPhone;
  if (body.pagoMovilRif) cfg.pagoMovilRif = body.pagoMovilRif;
  if (body.binanceId) cfg.binanceId = body.binanceId;
  if (body.binancePayId) cfg.binancePayId = body.binancePayId;
  if (body.usdtNetwork) cfg.usdtNetwork = body.usdtNetwork;
  if (typeof body.binanceQrBase64 === 'string') cfg.binanceQrBase64 = body.binanceQrBase64;
  if (body.bcvRate) cfg.bcvRate = Number(body.bcvRate);

  writeJson(CONFIG_FILE, cfg);
  return { success: true, message: 'Configuración actualizada exitosamente', config: cfg };
});

// ==============================================================================
// 3. LICENCIAMIENTO & HEARTBEAT (SUPERPOS CLIENTE -> CLOUD)
// ==============================================================================
fastify.post('/api/cloud/license/heartbeat', async (request) => {
  const { tenantId, machineFingerprint, localVersion } = request.body || {};
  let tenants = readJson(TENANTS_FILE, []);
  let tenant = tenants.find(t => t.id === tenantId);
  const cfg = readJson(CONFIG_FILE, {});

  if (!tenant) {
    tenant = {
      id: tenantId || 'tenant-' + Date.now(),
      name: 'Nuevo Supermercado Registrado',
      rif: 'J-Pendiente',
      city: 'Venezuela',
      plan: 'BASICO',
      monthlyPrice: 35,
      status: 'ACTIVE',
      maxUsers: 3,
      maxWorkstations: 1,
      enabledModules: ['pos', 'inventory', 'fiscal_reports', 'delivery_notes'],
      lastHeartbeat: new Date().toISOString(),
      nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      machineFingerprint,
      localVersion
    };
    tenants.push(tenant);
  } else {
    tenant.lastHeartbeat = new Date().toISOString();
    if (machineFingerprint) tenant.machineFingerprint = machineFingerprint;
    if (localVersion) tenant.localVersion = localVersion;
  }

  writeJson(TENANTS_FILE, tenants);

  const isActive = tenant.status === 'ACTIVE';
  return {
    valid: isActive,
    status: tenant.status,
    tenantId: tenant.id,
    companyName: tenant.name,
    plan: tenant.plan,
    nextDueDate: tenant.nextDueDate,
    expiresAt: tenant.nextDueDate,
    maxUsers: tenant.maxUsers || 10,
    maxWorkstations: tenant.maxWorkstations || 4,
    enabledModules: tenant.enabledModules || ALL_AVAILABLE_MODULES.map(m => m.id),
    bcvRate: cfg.bcvRate,
    serverTime: new Date().toISOString(),
    message: isActive ? 'Licencia activa y autorizada' : 'Acceso suspendido por administración'
  };
});

// ==============================================================================
// 4. GESTIÓN TOTAL DE SUPERMERCADOS, PERMISOS Y MÓDULOS
// ==============================================================================
fastify.get('/api/cloud/admin/tenants', async () => {
  return readJson(TENANTS_FILE, []);
});

fastify.post('/api/cloud/admin/tenants', async (request) => {
  const body = request.body || {};
  let tenants = readJson(TENANTS_FILE, []);

  const defaultModules = body.enabledModules && Array.isArray(body.enabledModules) && body.enabledModules.length > 0
    ? body.enabledModules
    : (body.plan === 'BASICO' 
        ? ['pos', 'inventory', 'fiscal_reports', 'delivery_notes'] 
        : ALL_AVAILABLE_MODULES.map(m => m.id));

  const newTenant = {
    id: 'tenant-' + Math.random().toString(36).substring(2, 9),
    name: body.name || 'Supermercado',
    rif: body.rif || 'J-00000000-0',
    city: body.city || 'Venezuela',
    plan: body.plan || 'PROFESIONAL',
    monthlyPrice: Number(body.monthlyPrice) || 60,
    maxUsers: Number(body.maxUsers) || (body.plan === 'BASICO' ? 3 : body.plan === 'ENTERPRISE' ? 50 : 10),
    maxWorkstations: Number(body.maxWorkstations) || (body.plan === 'BASICO' ? 1 : body.plan === 'ENTERPRISE' ? 15 : 4),
    enabledModules: defaultModules,
    status: 'ACTIVE',
    lastHeartbeat: 'Sin conexión previa',
    nextDueDate: body.nextDueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    contactName: body.contactName || 'Gerente',
    contactPhone: body.contactPhone || ''
  };

  tenants.push(newTenant);
  writeJson(TENANTS_FILE, tenants);
  return { success: true, tenant: newTenant };
});

fastify.post('/api/cloud/admin/update-tenant', async (request, reply) => {
  const body = request.body || {};
  let tenants = readJson(TENANTS_FILE, []);
  const idx = tenants.findIndex(t => t.id === body.id);
  if (idx === -1) return reply.status(404).send({ error: 'Supermercado no encontrado' });

  if (body.name) tenants[idx].name = body.name;
  if (body.rif) tenants[idx].rif = body.rif;
  if (body.city) tenants[idx].city = body.city;
  if (body.plan) tenants[idx].plan = body.plan;
  if (body.monthlyPrice !== undefined) tenants[idx].monthlyPrice = Number(body.monthlyPrice);
  if (body.maxUsers !== undefined) tenants[idx].maxUsers = Number(body.maxUsers);
  if (body.maxWorkstations !== undefined) tenants[idx].maxWorkstations = Number(body.maxWorkstations);
  if (body.contactName !== undefined) tenants[idx].contactName = body.contactName;
  if (body.contactPhone !== undefined) tenants[idx].contactPhone = body.contactPhone;
  if (body.nextDueDate) tenants[idx].nextDueDate = new Date(body.nextDueDate).toISOString();
  if (body.status) tenants[idx].status = body.status;
  if (Array.isArray(body.enabledModules)) tenants[idx].enabledModules = body.enabledModules;

  writeJson(TENANTS_FILE, tenants);
  return { success: true, message: 'Supermercado y permisos de módulos actualizados exitosamente', tenant: tenants[idx] };
});

fastify.post('/api/cloud/admin/toggle-status', async (request, reply) => {
  const { tenantId, status } = request.body || {};
  let tenants = readJson(TENANTS_FILE, []);
  const idx = tenants.findIndex(t => t.id === tenantId);
  if (idx === -1) return reply.status(404).send({ error: 'Cliente no encontrado' });

  tenants[idx].status = status;
  writeJson(TENANTS_FILE, tenants);
  return { success: true, tenant: tenants[idx] };
});

fastify.post('/api/cloud/admin/delete-tenant', async (request, reply) => {
  const { tenantId } = request.body || {};
  let tenants = readJson(TENANTS_FILE, []);
  tenants = tenants.filter(t => t.id !== tenantId);
  writeJson(TENANTS_FILE, tenants);
  return { success: true, message: 'Supermercado eliminado de la base de datos' };
});

fastify.post('/api/cloud/admin/generate-offline-token', async (request, reply) => {
  const { tenantId, days = 30 } = request.body || {};
  const tenants = readJson(TENANTS_FILE, []);
  const tenant = tenants.find(t => t.id === tenantId);
  if (!tenant) return reply.status(404).send({ error: 'Cliente no encontrado' });

  const payload = {
    tenantId: tenant.id,
    rif: tenant.rif,
    maxUsers: tenant.maxUsers || 10,
    maxWorkstations: tenant.maxWorkstations || 4,
    enabledModules: tenant.enabledModules || [],
    validUntil: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
    plan: tenant.plan,
    issuedAt: new Date().toISOString()
  };

  const secret = 'SUPERPOS_OFFLINE_SECRET_KEY_2026';
  const dataString = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = crypto.createHmac('sha256', secret).update(dataString).digest('hex');
  const token = `SPPOS-${dataString}.${signature}`;

  return { success: true, token, expiresAt: payload.validUntil };
});

// ==============================================================================
// 5. REPORTES DE PAGO & VALIDACIÓN
// ==============================================================================
fastify.post('/api/cloud/tenant/report-payment', async (request) => {
  const body = request.body || {};
  let payments = readJson(PAYMENTS_FILE, []);

  const newPayment = {
    id: 'pay-' + Date.now(),
    tenantId: body.tenantId,
    amountUsd: Number(body.amountUsd) || 0,
    amountVes: Number(body.amountVes) || 0,
    bcvRate: Number(body.bcvRate) || 854.4637,
    paymentMethod: body.paymentMethod,
    referenceNumber: body.referenceNumber || '',
    voucherBase64: body.voucherBase64 || '',
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };

  payments.push(newPayment);
  writeJson(PAYMENTS_FILE, payments);
  return { success: true, message: 'Pago reportado correctamente. El administrador validará su transacción.', payment: newPayment };
});

fastify.get('/api/cloud/admin/payments', async () => {
  return readJson(PAYMENTS_FILE, []);
});

fastify.post('/api/cloud/admin/approve-payment', async (request, reply) => {
  const { paymentId } = request.body || {};
  let payments = readJson(PAYMENTS_FILE, []);
  const pIdx = payments.findIndex(p => p.id === paymentId);
  if (pIdx === -1) return reply.status(404).send({ error: 'Pago no encontrado' });

  payments[pIdx].status = 'APPROVED';
  payments[pIdx].approvedAt = new Date().toISOString();
  writeJson(PAYMENTS_FILE, payments);

  let tenants = readJson(TENANTS_FILE, []);
  const tIdx = tenants.findIndex(t => t.id === payments[pIdx].tenantId);
  if (tIdx !== -1) {
    tenants[tIdx].status = 'ACTIVE';
    const currentDue = new Date(tenants[tIdx].nextDueDate);
    const baseDate = currentDue > new Date() ? currentDue.getTime() : Date.now();
    tenants[tIdx].nextDueDate = new Date(baseDate + 30 * 24 * 60 * 60 * 1000).toISOString();
    writeJson(TENANTS_FILE, tenants);
  }

  return { success: true, message: 'Pago aprobado y suscripción renovada por 30 días.' };
});

// ==============================================================================
// 6. PORTAL PÚBLICO DE PAGO PARA CLIENTES (/pay/:tenantId)
// ==============================================================================
fastify.get('/pay/:tenantId', async (request, reply) => {
  const { tenantId } = request.params;
  const tenants = readJson(TENANTS_FILE, []);
  const tenant = tenants.find(t => t.id === tenantId);
  const cfg = readJson(CONFIG_FILE, {});

  if (!tenant) {
    return reply.type('text/html').send(`
      <div style="font-family: sans-serif; text-align: center; padding: 50px; background: #0f172a; color: white; min-height: 100vh;">
        <h2>❌ Enlace de Pago no válido o Supermercado no encontrado</h2>
        <p style="color: #94a3b8;">Por favor contacte a soporte técnico para obtener su enlace de facturación actualizado.</p>
      </div>
    `);
  }

  const bcvRate = cfg.bcvRate || 854.4637;
  const amountUsd = tenant.monthlyPrice || 60;
  const amountVes = (amountUsd * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  reply.type('text/html').send(`
<!DOCTYPE html>
<html lang="es" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portal de Pago — SuperPOS Cloud (${tenant.name})</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>body { font-family: 'Plus Jakarta Sans', sans-serif; }</style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col justify-between">
  <header class="border-b border-slate-800 bg-slate-900/90 py-4 px-6 sticky top-0 z-40 backdrop-blur">
    <div class="max-w-4xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-emerald-500 flex items-center justify-center font-black text-xl shadow-lg">⚡</div>
        <div>
          <span class="font-bold text-white text-lg">SuperPOS <span class="text-sky-400">Portal de Facturación</span></span>
          <span class="block text-[11px] text-slate-400 font-mono">Licencia Oficial SaaS Venezuela</span>
        </div>
      </div>
      <div class="text-right">
        <span class="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800/80 px-3 py-1 rounded-full font-bold">
          🇻🇪 BCV Oficial: ${bcvRate} Bs/$
        </span>
      </div>
    </div>
  </header>

  <main class="max-w-4xl mx-auto px-4 py-8 w-full space-y-6">
    <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
      <div class="absolute -right-10 -bottom-10 w-48 h-48 bg-sky-500/10 rounded-full blur-3xl pointer-events-none"></div>
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 pb-6">
        <div>
          <span class="text-xs font-bold text-sky-400 uppercase tracking-wider">Cliente Suscrito</span>
          <h1 class="text-2xl font-black text-white mt-1">${tenant.name}</h1>
          <p class="text-xs text-slate-400 font-mono">RIF: ${tenant.rif} | Plan: <span class="text-amber-400 font-bold">${tenant.plan}</span></p>
        </div>
        <div class="text-right bg-slate-950 border border-slate-800 p-4 rounded-2xl">
          <div class="text-xs text-slate-400">Total a Pagar (Canon Mensual)</div>
          <div class="text-3xl font-black text-emerald-400 mt-1">$${amountUsd}.00 <span class="text-xs text-slate-400">USD</span></div>
          <div class="text-sm font-bold text-sky-300 mt-0.5">Bs. ${amountVes} <span class="text-[10px] text-slate-400">a Tasa BCV</span></div>
        </div>
      </div>

      <div class="mt-6">
        <div class="flex gap-2 border-b border-slate-800 pb-3">
          <button onclick="switchTab('pm')" id="tab-pm-btn" class="px-4 py-2 rounded-xl font-bold text-xs bg-sky-600 text-white transition flex items-center gap-2">
            📱 Pago Móvil (BDV / Todos los Bancos)
          </button>
          <button onclick="switchTab('binance')" id="tab-binance-btn" class="px-4 py-2 rounded-xl font-bold text-xs bg-slate-800 text-slate-400 hover:text-white transition flex items-center gap-2">
            🟡 Binance Pay (QR & ID)
          </button>
        </div>

        <div id="tab-pm" class="pt-6 space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="bg-slate-950 p-4 rounded-2xl border border-slate-800">
              <span class="text-slate-400 text-xs block">Banco Receptor</span>
              <strong class="text-white text-sm block mt-1">${cfg.pagoMovilBank || 'Banco de Venezuela (0102)'}</strong>
            </div>
            <div class="bg-slate-950 p-4 rounded-2xl border border-slate-800">
              <span class="text-slate-400 text-xs block">Teléfono Registrado</span>
              <strong class="text-sky-400 text-base font-mono block mt-1">${cfg.pagoMovilPhone || '0414-2329011'}</strong>
            </div>
            <div class="bg-slate-950 p-4 rounded-2xl border border-slate-800">
              <span class="text-slate-400 text-xs block">C.I. / RIF del Beneficiario</span>
              <strong class="text-emerald-400 text-base font-mono block mt-1">${cfg.pagoMovilRif || 'V-26123456-7'}</strong>
            </div>
          </div>
        </div>

        <div id="tab-binance" class="pt-6 space-y-4 hidden">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
            <div class="text-center bg-slate-950 p-5 rounded-3xl border border-slate-800">
              <span class="text-xs font-bold text-amber-400 block mb-3 uppercase tracking-wider">Escanea con tu App de Binance</span>
              ${cfg.binanceQrBase64 ? `
                <img src="${cfg.binanceQrBase64}" alt="Código QR Binance Pay" class="w-56 h-56 mx-auto rounded-2xl border-2 border-amber-500/50 shadow-2xl p-2 bg-white object-contain">
              ` : `
                <div class="w-56 h-56 mx-auto rounded-2xl border-2 border-dashed border-slate-700 flex flex-col items-center justify-center p-4 text-slate-500">
                  <span class="text-3xl mb-2">📷</span>
                  <span class="text-xs">QR pendiente de carga por el Administrador</span>
                </div>
              `}
              <span class="text-[11px] text-slate-400 block mt-3 font-mono">Red recomendada: ${cfg.usdtNetwork || 'USDT / Binance Pay'}</span>
            </div>
            <div class="space-y-3">
              <div class="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <span class="text-slate-400 text-xs block">Binance ID (Pay ID)</span>
                <strong class="text-amber-400 text-lg font-mono block mt-1 select-all">${cfg.binanceId || '849201948'}</strong>
              </div>
              <div class="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <span class="text-slate-400 text-xs block">Binance Email / Alias</span>
                <strong class="text-white text-sm font-mono block mt-1 select-all">${cfg.binancePayId || 'superpos@binance'}</strong>
              </div>
              <div class="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <span class="text-slate-400 text-xs block">Monto Exacto USDT</span>
                <strong class="text-emerald-400 text-xl font-black block mt-1">${amountUsd}.00 USDT</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
      <h2 class="text-lg font-bold text-white flex items-center gap-2">
        <span>📋</span> Reportar Pago Realizado
      </h2>
      <form id="reportPaymentForm" onsubmit="submitPayment(event)" class="space-y-4 text-xs">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-slate-400 mb-1">Método de Pago Utilizado</label>
            <select id="p-method" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white font-medium">
              <option value="PAGO_MOVIL">Pago Móvil Interbancario (Bs.)</option>
              <option value="BINANCE_PAY">Binance Pay / USDT</option>
              <option value="BANCO_VES">Transferencia Bancaria Nacional</option>
            </select>
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Número de Referencia / ID de Transacción</label>
            <input type="text" id="p-ref" required placeholder="Ej: 00948271 o TxID Binance" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white font-mono">
          </div>
        </div>

        <div>
          <label class="block text-slate-400 mb-1">Adjuntar Captura o Foto del Comprobante</label>
          <div class="flex items-center gap-3">
            <input type="file" id="p-file" accept="image/*" required onchange="handleFileChange(event)" class="hidden">
            <button type="button" onclick="document.getElementById('p-file').click()" class="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-4 py-2.5 rounded-xl font-bold flex items-center gap-2">
              <span>📎</span> Seleccionar Imagen de Comprobante
            </button>
            <span id="file-name" class="text-slate-500 truncate max-w-xs font-mono">Ningún archivo seleccionado</span>
          </div>
          <div id="voucher-preview-container" class="mt-3 hidden">
            <img id="voucher-preview" class="h-36 rounded-xl border border-slate-700 object-contain bg-slate-950 p-1">
          </div>
        </div>

        <button type="submit" id="btn-submit-pay" class="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-2xl text-white font-bold text-sm shadow-lg shadow-emerald-600/30 transition">
          🚀 Enviar Comprobante para Validación Inmediata
        </button>
      </form>
    </div>
  </main>

  <footer class="text-center py-6 text-slate-600 text-xs border-t border-slate-900">
    SuperPOS Cloud v2.0 • Desarrollado con tecnología Edge Offline-First & Respaldo Bancario Oficial BCV
  </footer>

  <script>
    let voucherBase64 = '';
    const tenantId = '${tenant.id}';
    const amountUsd = ${amountUsd};
    const bcvRate = ${bcvRate};

    function switchTab(t) {
      if (t === 'pm') {
        document.getElementById('tab-pm').classList.remove('hidden');
        document.getElementById('tab-binance').classList.add('hidden');
        document.getElementById('tab-pm-btn').className = 'px-4 py-2 rounded-xl font-bold text-xs bg-sky-600 text-white transition flex items-center gap-2';
        document.getElementById('tab-binance-btn').className = 'px-4 py-2 rounded-xl font-bold text-xs bg-slate-800 text-slate-400 hover:text-white transition flex items-center gap-2';
        document.getElementById('p-method').value = 'PAGO_MOVIL';
      } else {
        document.getElementById('tab-binance').classList.remove('hidden');
        document.getElementById('tab-pm').classList.add('hidden');
        document.getElementById('tab-binance-btn').className = 'px-4 py-2 rounded-xl font-bold text-xs bg-amber-600 text-white transition flex items-center gap-2';
        document.getElementById('tab-pm-btn').className = 'px-4 py-2 rounded-xl font-bold text-xs bg-slate-800 text-slate-400 hover:text-white transition flex items-center gap-2';
        document.getElementById('p-method').value = 'BINANCE_PAY';
      }
    }

    function handleFileChange(e) {
      const file = e.target.files[0];
      if (!file) return;
      document.getElementById('file-name').innerText = file.name;

      const reader = new FileReader();
      reader.onload = function(evt) {
        voucherBase64 = evt.target.result;
        document.getElementById('voucher-preview').src = voucherBase64;
        document.getElementById('voucher-preview-container').classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    }

    async function submitPayment(e) {
      e.preventDefault();
      if (!voucherBase64) return alert('Por favor adjunte la captura o foto del comprobante.');

      const btn = document.getElementById('btn-submit-pay');
      btn.disabled = true;
      btn.innerText = 'Enviando...';

      try {
        const res = await fetch('/api/cloud/tenant/report-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            amountUsd,
            amountVes: amountUsd * bcvRate,
            bcvRate,
            paymentMethod: document.getElementById('p-method').value,
            referenceNumber: document.getElementById('p-ref').value,
            voucherBase64
          })
        });

        const data = await res.json();
        if (data.success) {
          alert('✅ ¡Pago reportado exitosamente! El SuperAdmin revisará su comprobante en breve para confirmar la renovación.');
          location.reload();
        } else {
          alert('Error al reportar pago: ' + (data.error || 'Intente nuevamente'));
        }
      } catch (err) {
        alert('Error de conexión: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerText = '🚀 Enviar Comprobante para Validación Inmediata';
      }
    }
  </script>
</body>
</html>
  `);
});

// ==============================================================================
// 7. DASHBOARD SUPERADMIN (/ - PANEL COMPLETO CON EDITOR DE MÓDULOS)
// ==============================================================================
fastify.get('/', async (request, reply) => {
  const cfg = readJson(CONFIG_FILE, {});
  const bcvRate = cfg.bcvRate || 854.4637;

  reply.type('text/html').send(`
<!DOCTYPE html>
<html lang="es" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SuperPOS Master Cloud — Panel de Control SaaS</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
    .custom-scroll::-webkit-scrollbar { width: 6px; }
    .custom-scroll::-webkit-scrollbar-track { background: #0f172a; }
    .custom-scroll::-webkit-scrollbar-thumb { background: #334155; border-radius: 9999px; }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
  <header class="border-b border-slate-800 bg-slate-900/90 sticky top-0 z-50 backdrop-blur">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-emerald-500 flex items-center justify-center font-black text-xl shadow-lg shadow-sky-500/20">⚡</div>
        <div>
          <span class="font-bold text-lg text-white">SuperPOS <span class="text-sky-400">Master Cloud</span></span>
          <span class="text-[10px] block text-emerald-400 font-mono font-semibold">● SERVIDOR CENTRAL SAAS ACTIVO</span>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <div class="bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl flex items-center gap-2">
          <span class="text-xs font-bold text-emerald-400">🇻🇪 BCV: <span id="bcv-val">${bcvRate}</span> Bs/$</span>
          <button onclick="syncBcvNow()" title="Sincronizar ahora con bcv.org.ve" class="text-slate-400 hover:text-white text-xs bg-slate-800 px-2 py-0.5 rounded-lg transition">🔄</button>
        </div>
        <button onclick="openConfigModal()" class="bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-500/40 text-xs font-bold px-3 py-2 rounded-xl transition flex items-center gap-1.5">
          <span>⚙️</span> Cuentas & QR Binance
        </button>
        <button onclick="openNewTenantModal()" class="bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition shadow-lg shadow-sky-600/30 flex items-center gap-1.5">
          <span>+</span> Nuevo Supermercado
        </button>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
      <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
        <div class="text-slate-400 text-xs font-semibold uppercase tracking-wider">Supermercados Activos</div>
        <div id="stat-active" class="text-3xl font-black text-emerald-400 mt-2">0</div>
        <div class="text-[11px] text-slate-500 mt-1">Nodos Edge autorizados</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
        <div class="text-slate-400 text-xs font-semibold uppercase tracking-wider">Clientes Suspendidos</div>
        <div id="stat-suspended" class="text-3xl font-black text-rose-400 mt-2">0</div>
        <div class="text-[11px] text-slate-500 mt-1">Acceso bloqueado (Mora)</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
        <div class="text-slate-400 text-xs font-semibold uppercase tracking-wider">MRR Recurrente (USD)</div>
        <div id="stat-revenue" class="text-3xl font-black text-sky-400 mt-2">$0</div>
        <div id="stat-revenue-ves" class="text-[11px] text-slate-400 mt-1">Bs. 0 al BCV</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
        <div class="text-slate-400 text-xs font-semibold uppercase tracking-wider">Pagos por Validar</div>
        <div id="stat-pending-payments" class="text-3xl font-black text-amber-400 mt-2">0</div>
        <div class="text-[11px] text-slate-500 mt-1">Comprobantes recibidos</div>
      </div>
    </div>

    <div id="pending-payments-section" class="bg-slate-900 border border-amber-800/40 rounded-2xl overflow-hidden shadow-xl hidden">
      <div class="px-6 py-4 border-b border-slate-800 bg-amber-950/20 flex items-center justify-between">
        <div>
          <h2 class="text-base font-bold text-amber-300 flex items-center gap-2">
            <span>🔔</span> Comprobantes de Pago Pendientes de Aprobación
          </h2>
          <p class="text-xs text-slate-400">Verifique los fondos en su Pago Móvil o Binance antes de aprobar.</p>
        </div>
        <button onclick="loadPayments()" class="text-xs text-slate-400 hover:text-white bg-slate-800 px-3 py-1.5 rounded-lg">🔄 Refrescar</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="border-b border-slate-800 text-slate-400 uppercase text-[10px] bg-slate-950/60">
              <th class="py-3 px-6">Supermercado</th>
              <th class="py-3 px-6">Monto Reportado</th>
              <th class="py-3 px-6">Método & Ref</th>
              <th class="py-3 px-6">Comprobante</th>
              <th class="py-3 px-6 text-right">Acción</th>
            </tr>
          </thead>
          <tbody id="payments-tbody" class="divide-y border-slate-800"></tbody>
        </table>
      </div>
    </div>

    <div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 class="text-base font-bold text-white">Supermercados y Comercios Conectados</h2>
          <p class="text-xs text-slate-400">Edición de permisos, módulos, límites de cajeros, Kill-Switch y enlaces de cobro.</p>
        </div>
        <button onclick="loadTenants()" class="text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition">
          🔄 Actualizar Lista
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider bg-slate-950/40">
              <th class="py-3 px-6">Supermercado / RIF</th>
              <th class="py-3 px-6">Capacidad</th>
              <th class="py-3 px-6">Plan & Canon</th>
              <th class="py-3 px-6">Módulos Habilitados</th>
              <th class="py-3 px-6">Vencimiento</th>
              <th class="py-3 px-6">Estado</th>
              <th class="py-3 px-6 text-right">Gestión Directa</th>
            </tr>
          </thead>
          <tbody id="tenants-tbody" class="divide-y divide-slate-800/60">
            <tr><td colspan="7" class="py-8 text-center text-slate-500">Cargando supermercados...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <div id="editTenantModal" class="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
    <div class="bg-slate-900 border border-slate-800 rounded-3xl max-w-3xl w-full p-6 space-y-4 shadow-2xl overflow-y-auto max-h-[92vh] custom-scroll">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h3 class="text-base font-bold text-white flex items-center gap-2">
            <span>✏️</span> Editar Supermercado, Límites & Permisos de Módulos
          </h3>
          <span id="edit-modal-subtitle" class="text-xs text-slate-400 font-mono">ID: tenant-super-1</span>
        </div>
        <button onclick="closeEditTenantModal()" class="text-slate-400 hover:text-white text-xl font-bold">&times;</button>
      </div>

      <form id="editTenantForm" onsubmit="saveTenantChanges(event)" class="space-y-4 text-xs">
        <input type="hidden" id="edit-tenant-id">

        <div class="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
          <span class="font-bold text-sky-400 block uppercase tracking-wider text-[11px]">🏢 Datos del Comercio</span>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-slate-400 mb-1">Nombre Comercial</label>
              <input type="text" id="edit-name" required class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium">
            </div>
            <div>
              <label class="block text-slate-400 mb-1">RIF Fiscal</label>
              <input type="text" id="edit-rif" required class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono">
            </div>
            <div>
              <label class="block text-slate-400 mb-1">Ciudad / Estado</label>
              <input type="text" id="edit-city" required class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white">
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-400 mb-1">Contacto / Gerente</label>
              <input type="text" id="edit-contact" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white">
            </div>
            <div>
              <label class="block text-slate-400 mb-1">Teléfono / WhatsApp</label>
              <input type="text" id="edit-phone" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono">
            </div>
          </div>
        </div>

        <div class="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
          <span class="font-bold text-emerald-400 block uppercase tracking-wider text-[11px]">👥 Límites de Usuarios, Cajas & Plan</span>
          <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label class="block text-slate-400 mb-1">Plan SaaS</label>
              <select id="edit-plan" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white">
                <option value="BASICO">BÁSICO</option>
                <option value="PROFESIONAL">PROFESIONAL</option>
                <option value="ENTERPRISE">ENTERPRISE</option>
                <option value="PERSONALIZADO">PERSONALIZADO</option>
              </select>
            </div>
            <div>
              <label class="block text-slate-400 mb-1">Canon Mensual ($)</label>
              <input type="number" id="edit-price" required class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-bold text-emerald-400">
            </div>
            <div>
              <label class="block text-slate-400 mb-1">Máx. Usuarios / Cajeros</label>
              <input type="number" id="edit-max-users" min="1" max="500" required class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-bold text-sky-400">
            </div>
            <div>
              <label class="block text-slate-400 mb-1">Máx. Cajas / Estaciones</label>
              <input type="number" id="edit-max-ws" min="1" max="100" required class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-bold text-amber-400">
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label class="block text-slate-400 mb-1">Fecha de Vencimiento de Licencia</label>
              <input type="date" id="edit-due-date" required class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono">
            </div>
            <div>
              <label class="block text-slate-400 mb-1">Estado de Servicio</label>
              <select id="edit-status" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-bold">
                <option value="ACTIVE" class="text-emerald-400">● ACTIVO (Autorizado)</option>
                <option value="SUSPENDED" class="text-rose-400">■ SUSPENDIDO (Kill-Switch)</option>
              </select>
            </div>
          </div>
        </div>

        <div class="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
          <div class="flex items-center justify-between">
            <div>
              <span class="font-bold text-amber-400 block uppercase tracking-wider text-[11px]">🧩 Permisos de Módulos Autorizados</span>
              <span class="text-[10px] text-slate-400">Los módulos desmarcados quedarán bloqueados en el sistema del supermercado.</span>
            </div>
            <div class="space-x-1.5">
              <button type="button" onclick="selectAllModules(true)" class="text-[10px] bg-slate-800 hover:bg-slate-700 text-sky-400 font-bold px-2.5 py-1 rounded-lg">Seleccionar Todos</button>
              <button type="button" onclick="selectAllModules(false)" class="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-400 px-2.5 py-1 rounded-lg">Limpiar</button>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2" id="modules-checklist-container"></div>
        </div>

        <div class="flex justify-between items-center pt-3 border-t border-slate-800">
          <button type="button" onclick="deleteCurrentTenant()" class="px-4 py-2 bg-rose-950/60 hover:bg-rose-900 text-rose-400 border border-rose-800/60 rounded-xl font-bold transition">
            🗑️ Eliminar Supermercado
          </button>
          <div class="flex gap-2">
            <button type="button" onclick="closeEditTenantModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-medium">Cancelar</button>
            <button type="submit" class="px-5 py-2 bg-sky-600 hover:bg-sky-500 rounded-xl text-white font-bold shadow-lg shadow-sky-600/30">Guardar Cambios</button>
          </div>
        </div>
      </form>
    </div>
  </div>

  <div id="newModal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
      <h3 class="text-base font-bold text-white">Registrar Nuevo Supermercado</h3>
      <form id="newTenantForm" onsubmit="createTenant(event)" class="space-y-3 text-xs">
        <div>
          <label class="block text-slate-400 mb-1">Nombre Comercial / Empresa</label>
          <input type="text" id="t-name" required class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-sky-500" placeholder="Ej. Hipermercado Los Andes">
        </div>
        <div>
          <label class="block text-slate-400 mb-1">RIF Fiscal</label>
          <input type="text" id="t-rif" required class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-sky-500" placeholder="J-12345678-9">
        </div>
        <div>
          <label class="block text-slate-400 mb-1">Ciudad / Estado</label>
          <input type="text" id="t-city" required class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-sky-500" placeholder="Maracay, Aragua">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-slate-400 mb-1">Plan SaaS</label>
            <select id="t-plan" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-sky-500">
              <option value="BASICO">Básico ($35)</option>
              <option value="PROFESIONAL" selected>Profesional ($60)</option>
              <option value="ENTERPRISE">Enterprise ($120)</option>
            </select>
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Precio Mensual ($)</label>
            <input type="number" id="t-price" value="60" required class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-sky-500">
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeNewTenantModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300">Cancelar</button>
          <button type="submit" class="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded-xl text-white font-bold">Guardar Supermercado</button>
        </div>
      </form>
    </div>
  </div>

  <div id="configModal" class="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
    <div class="bg-slate-900 border border-slate-800 rounded-3xl max-w-xl w-full p-6 space-y-4 shadow-2xl overflow-y-auto max-h-[90vh]">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h3 class="text-base font-bold text-white flex items-center gap-2">
          <span>⚙️</span> Cuentas de Cobro & Código QR Binance Pay
        </h3>
        <button onclick="closeConfigModal()" class="text-slate-400 hover:text-white text-lg font-bold">&times;</button>
      </div>

      <form id="configForm" onsubmit="saveConfig(event)" class="space-y-4 text-xs">
        <div class="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
          <span class="font-bold text-sky-400 block uppercase tracking-wider text-[11px]">📱 Datos de Pago Móvil Nacional</span>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-400 mb-1">Banco Receptor</label>
              <input type="text" id="cfg-pm-bank" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium" placeholder="Banco de Venezuela (0102)">
            </div>
            <div>
              <label class="block text-slate-400 mb-1">Teléfono</label>
              <input type="text" id="cfg-pm-phone" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono" placeholder="0414-2329011">
            </div>
          </div>
          <div>
            <label class="block text-slate-400 mb-1">C.I. / RIF del Beneficiario</label>
            <input type="text" id="cfg-pm-rif" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono" placeholder="V-26123456-7">
          </div>
        </div>

        <div class="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
          <span class="font-bold text-amber-400 block uppercase tracking-wider text-[11px]">🟡 Datos de Binance Pay & Carga de Imagen QR</span>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-400 mb-1">Binance Pay ID / Numérico</label>
              <input type="text" id="cfg-binance-id" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono" placeholder="849201948">
            </div>
            <div>
              <label class="block text-slate-400 mb-1">Email / Alias Binance</label>
              <input type="text" id="cfg-binance-payid" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium" placeholder="superpos@binance">
            </div>
          </div>

          <div>
            <label class="block text-slate-300 font-bold mb-1">📷 Imagen del Código QR de Binance (Subir Archivo)</label>
            <div class="flex items-center gap-3 mt-1">
              <input type="file" id="cfg-binance-qr-file" accept="image/*" onchange="previewBinanceQr(event)" class="hidden">
              <button type="button" onclick="document.getElementById('cfg-binance-qr-file').click()" class="bg-amber-600 hover:bg-amber-500 text-white font-bold px-4 py-2 rounded-xl flex items-center gap-2">
                <span>📁</span> Cargar Imagen del QR
              </button>
              <button type="button" onclick="removeBinanceQr()" id="btn-remove-qr" class="text-rose-400 hover:text-rose-300 text-xs underline hidden">
                Eliminar QR
              </button>
            </div>
            <p class="text-[11px] text-slate-500 mt-1">Selecciona la captura o foto del código QR de tu cuenta de Binance.</p>

            <div id="qr-preview-container" class="mt-3 p-3 bg-slate-900 border border-slate-800 rounded-2xl flex items-center gap-4 hidden">
              <img id="qr-preview-img" src="" class="w-24 h-24 rounded-xl border border-amber-500/60 object-contain bg-white p-1">
              <div>
                <span class="text-xs font-bold text-emerald-400 block">✅ Imagen de QR cargada correctamente</span>
                <span class="text-[10px] text-slate-400 block mt-0.5">Se mostrará en los enlaces de pago de tus clientes.</span>
              </div>
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t border-slate-800">
          <button type="button" onclick="closeConfigModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300">Cancelar</button>
          <button type="submit" class="px-5 py-2 bg-sky-600 hover:bg-sky-500 rounded-xl text-white font-bold shadow-lg">Guardar Configuración</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    let currentBcvRate = ${bcvRate};
    let binanceQrBase64Cache = '';
    let cachedTenants = [];

    const availableModulesList = ${JSON.stringify(ALL_AVAILABLE_MODULES)};

    function renderModulesChecklist(enabledList = []) {
      const container = document.getElementById('modules-checklist-container');
      container.innerHTML = '';
      availableModulesList.forEach(m => {
        const isChecked = enabledList.includes(m.id);
        const div = document.createElement('label');
        div.className = 'flex items-start gap-3 p-2.5 rounded-xl border border-slate-800 bg-slate-900/60 hover:bg-slate-800/80 cursor-pointer transition select-none';
        div.innerHTML = \`
          <input type="checkbox" name="module-opt" value="\${m.id}" \${isChecked ? 'checked' : ''} class="mt-0.5 rounded text-sky-600 focus:ring-0 w-4 h-4 bg-slate-950 border-slate-700">
          <div>
            <span class="text-xs font-bold text-white flex items-center gap-1.5">\${m.icon} \${m.name}</span>
            <span class="text-[10px] text-slate-400 block leading-tight mt-0.5">\${m.desc}</span>
          </div>
        \`;
        container.appendChild(div);
      });
    }

    function selectAllModules(checkAll) {
      const checkboxes = document.querySelectorAll('input[name="module-opt"]');
      checkboxes.forEach(cb => cb.checked = checkAll);
    }

    function openEditTenantModal(tenantId) {
      const tenant = cachedTenants.find(t => t.id === tenantId);
      if (!tenant) return;

      document.getElementById('edit-tenant-id').value = tenant.id;
      document.getElementById('edit-modal-subtitle').innerText = 'ID: ' + tenant.id + ' | Creado para ' + tenant.name;
      document.getElementById('edit-name').value = tenant.name || '';
      document.getElementById('edit-rif').value = tenant.rif || '';
      document.getElementById('edit-city').value = tenant.city || '';
      document.getElementById('edit-contact').value = tenant.contactName || '';
      document.getElementById('edit-phone').value = tenant.contactPhone || '';
      document.getElementById('edit-plan').value = tenant.plan || 'PROFESIONAL';
      document.getElementById('edit-price').value = tenant.monthlyPrice || 60;
      document.getElementById('edit-max-users').value = tenant.maxUsers || 10;
      document.getElementById('edit-max-ws').value = tenant.maxWorkstations || 4;
      document.getElementById('edit-status').value = tenant.status || 'ACTIVE';

      if (tenant.nextDueDate) {
        const d = new Date(tenant.nextDueDate);
        document.getElementById('edit-due-date').value = d.toISOString().split('T')[0];
      } else {
        document.getElementById('edit-due-date').value = new Date().toISOString().split('T')[0];
      }

      const enabled = tenant.enabledModules || availableModulesList.map(m => m.id);
      renderModulesChecklist(enabled);

      document.getElementById('editTenantModal').classList.remove('hidden');
    }

    function closeEditTenantModal() {
      document.getElementById('editTenantModal').classList.add('hidden');
    }

    async function saveTenantChanges(e) {
      e.preventDefault();
      const tenantId = document.getElementById('edit-tenant-id').value;
      const checkedModules = Array.from(document.querySelectorAll('input[name="module-opt"]:checked')).map(cb => cb.value);

      const payload = {
        id: tenantId,
        name: document.getElementById('edit-name').value,
        rif: document.getElementById('edit-rif').value,
        city: document.getElementById('edit-city').value,
        contactName: document.getElementById('edit-contact').value,
        contactPhone: document.getElementById('edit-phone').value,
        plan: document.getElementById('edit-plan').value,
        monthlyPrice: document.getElementById('edit-price').value,
        maxUsers: document.getElementById('edit-max-users').value,
        maxWorkstations: document.getElementById('edit-max-ws').value,
        nextDueDate: document.getElementById('edit-due-date').value,
        status: document.getElementById('edit-status').value,
        enabledModules: checkedModules
      };

      try {
        const res = await fetch('/api/cloud/admin/update-tenant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          alert('✅ ' + data.message);
          closeEditTenantModal();
          loadTenants();
        } else {
          alert('Error: ' + (data.error || 'No se pudo guardar'));
        }
      } catch (err) {
        alert('Error de conexión: ' + err.message);
      }
    }

    async function deleteCurrentTenant() {
      const tenantId = document.getElementById('edit-tenant-id').value;
      if (!confirm('⚠️ ¿Seguro que deseas ELIMINAR permanentemente este supermercado de la nube?')) return;
      try {
        const res = await fetch('/api/cloud/admin/delete-tenant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId })
        });
        const data = await res.json();
        if (data.success) {
          alert('Supermercado eliminado');
          closeEditTenantModal();
          loadTenants();
        }
      } catch (err) {
        alert('Error al eliminar');
      }
    }

    async function loadConfig() {
      try {
        const res = await fetch('/api/cloud/system-config');
        const cfg = await res.json();
        document.getElementById('cfg-pm-bank').value = cfg.pagoMovilBank || '';
        document.getElementById('cfg-pm-phone').value = cfg.pagoMovilPhone || '';
        document.getElementById('cfg-pm-rif').value = cfg.pagoMovilRif || '';
        document.getElementById('cfg-binance-id').value = cfg.binanceId || '';
        document.getElementById('cfg-binance-payid').value = cfg.binancePayId || '';
        
        if (cfg.binanceQrBase64) {
          binanceQrBase64Cache = cfg.binanceQrBase64;
          document.getElementById('qr-preview-img').src = cfg.binanceQrBase64;
          document.getElementById('qr-preview-container').classList.remove('hidden');
          document.getElementById('btn-remove-qr').classList.remove('hidden');
        }
      } catch (e) {
        console.error('Error cargando configuración:', e);
      }
    }

    function previewBinanceQr(event) {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function(e) {
        binanceQrBase64Cache = e.target.result;
        document.getElementById('qr-preview-img').src = binanceQrBase64Cache;
        document.getElementById('qr-preview-container').classList.remove('hidden');
        document.getElementById('btn-remove-qr').classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    }

    function removeBinanceQr() {
      binanceQrBase64Cache = '';
      document.getElementById('cfg-binance-qr-file').value = '';
      document.getElementById('qr-preview-img').src = '';
      document.getElementById('qr-preview-container').classList.add('hidden');
      document.getElementById('btn-remove-qr').classList.add('hidden');
    }

    async function saveConfig(e) {
      e.preventDefault();
      const payload = {
        pagoMovilBank: document.getElementById('cfg-pm-bank').value,
        pagoMovilPhone: document.getElementById('cfg-pm-phone').value,
        pagoMovilRif: document.getElementById('cfg-pm-rif').value,
        binanceId: document.getElementById('cfg-binance-id').value,
        binancePayId: document.getElementById('cfg-binance-payid').value,
        binanceQrBase64: binanceQrBase64Cache
      };

      try {
        const res = await fetch('/api/cloud/admin/update-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          alert('✅ Configuración de cobros y QR guardada exitosamente.');
          closeConfigModal();
        }
      } catch (err) {
        alert('Error al guardar: ' + err.message);
      }
    }

    async function syncBcvNow() {
      const bcvElem = document.getElementById('bcv-val');
      bcvElem.innerText = 'Consultando...';
      try {
        const res = await fetch('/api/cloud/bcv-rate/sync-now', { method: 'POST' });
        const data = await res.json();
        if (data.rate) {
          currentBcvRate = data.rate;
          bcvElem.innerText = data.rate;
          alert('✅ Tasa oficial BCV sincronizada con éxito: ' + data.rate + ' Bs/USD (' + data.source + ')');
          loadTenants();
        }
      } catch (err) {
        alert('Error al consultar BCV: ' + err.message);
        bcvElem.innerText = currentBcvRate;
      }
    }

    async function loadTenants() {
      try {
        const res = await fetch('/api/cloud/admin/tenants');
        const tenants = await res.json();
        cachedTenants = tenants || [];
        
        let activeCount = 0;
        let suspendedCount = 0;
        let totalMRR = 0;

        const tbody = document.getElementById('tenants-tbody');
        tbody.innerHTML = '';

        if (!tenants || tenants.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-slate-500">No hay clientes registrados aún.</td></tr>';
          return;
        }

        tenants.forEach(t => {
          if (t.status === 'ACTIVE') {
            activeCount++;
            totalMRR += (t.monthlyPrice || 0);
          } else {
            suspendedCount++;
          }

          const isActive = t.status === 'ACTIVE';
          const monthlyUsd = t.monthlyPrice || 60;
          const monthlyVes = (monthlyUsd * currentBcvRate).toLocaleString('es-VE', { maximumFractionDigits: 2 });
          const payUrl = window.location.origin + '/pay/' + t.id;
          const enabledMods = t.enabledModules || [];
          const modCount = enabledMods.length;

          const row = document.createElement('tr');
          row.className = 'hover:bg-slate-800/40 transition';
          row.innerHTML = \`
            <td class="py-4 px-6 font-medium text-white">
              <div class="font-bold text-sm">\${t.name}</div>
              <div class="text-slate-500 font-mono text-[11px]">\${t.rif} • \${t.city || 'Venezuela'}</div>
              <div class="text-slate-400 text-[10px] mt-0.5">\${t.contactName || ''} (\${t.contactPhone || 'Sin tlf'})</div>
            </td>
            <td class="py-4 px-6">
              <div class="text-sky-400 font-bold">\${t.maxUsers || 10} <span class="text-slate-400 font-normal text-[11px]">Usuarios</span></div>
              <div class="text-amber-400 font-bold">\${t.maxWorkstations || 4} <span class="text-slate-400 font-normal text-[11px]">Cajas/POS</span></div>
            </td>
            <td class="py-4 px-6">
              <span class="font-bold text-white">\${t.plan}</span>
              <span class="text-emerald-400 font-black block">$\${monthlyUsd} USD / mes</span>
              <span class="text-[10px] text-slate-400 block font-mono">Bs. \${monthlyVes}</span>
            </td>
            <td class="py-4 px-6">
              <span class="bg-slate-800 border border-slate-700 text-sky-300 px-2.5 py-1 rounded-lg text-[11px] font-bold">
                🧩 \${modCount} / \${availableModulesList.length} Módulos
              </span>
            </td>
            <td class="py-4 px-6 text-slate-300 font-mono text-[11px]">
              \${t.nextDueDate ? new Date(t.nextDueDate).toLocaleDateString() : 'Sin fecha'}
            </td>
            <td class="py-4 px-6">
              \${isActive ? 
                '<span class="bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 px-2.5 py-1 rounded-full text-[10px] font-bold">● ACTIVO</span>' : 
                '<span class="bg-rose-950/80 text-rose-400 border border-rose-800/60 px-2.5 py-1 rounded-full text-[10px] font-bold">■ SUSPENDIDO</span>'
              }
            </td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">
              <button onclick="openEditTenantModal('\${t.id}')" title="Editar Supermercado, Límites y Módulos" class="bg-sky-600/20 hover:bg-sky-600 text-sky-300 hover:text-white border border-sky-600/40 px-3 py-1.5 rounded-xl font-bold transition">
                ✏️ Editar Módulos
              </button>
              <button onclick="copyPayLink('\${payUrl}')" title="Copiar Enlace de Pago" class="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded-xl font-bold transition">
                🔗 Link
              </button>
              <button onclick="sendWhatsappBill('\${t.name}', '\${t.contactPhone}', '\${monthlyUsd}', '\${monthlyVes}', '\${payUrl}')" title="Cobrar por WhatsApp" class="bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-600/40 px-2.5 py-1.5 rounded-xl font-bold transition">
                💬 WhatsApp
              </button>
              <button onclick="generateOfflineToken('\${t.id}')" title="Generar Licencia Offline 30 Días" class="bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white border border-amber-600/40 px-2.5 py-1.5 rounded-xl font-bold transition">
                🔑 Token
              </button>
              \${isActive ? 
                \`<button onclick="toggleTenant('\${t.id}', 'SUSPENDED')" class="bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-600/40 px-2.5 py-1.5 rounded-xl font-bold transition">🔒</button>\` : 
                \`<button onclick="toggleTenant('\${t.id}', 'ACTIVE')" class="bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-600/40 px-2.5 py-1.5 rounded-xl font-bold transition">🔓</button>\`
              }
            </td>
          \`;
          tbody.appendChild(row);
        });

        document.getElementById('stat-active').innerText = activeCount;
        document.getElementById('stat-suspended').innerText = suspendedCount;
        document.getElementById('stat-revenue').innerText = '$' + totalMRR;
        document.getElementById('stat-revenue-ves').innerText = 'Bs. ' + (totalMRR * currentBcvRate).toLocaleString('es-VE', { maximumFractionDigits: 2 }) + ' al BCV';
      } catch (e) {
        console.error(e);
      }
    }

    async function loadPayments() {
      try {
        const res = await fetch('/api/cloud/admin/payments');
        const payments = await res.json();
        const pending = (payments || []).filter(p => p.status === 'PENDING');
        
        document.getElementById('stat-pending-payments').innerText = pending.length;
        const section = document.getElementById('pending-payments-section');
        const tbody = document.getElementById('payments-tbody');
        tbody.innerHTML = '';

        if (pending.length > 0) {
          section.classList.remove('hidden');
          pending.forEach(p => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-800/40';
            tr.innerHTML = \`
              <td class="py-3 px-6 font-bold text-white">\${p.tenantId}</td>
              <td class="py-3 px-6 text-emerald-400 font-black">$\${p.amountUsd} USD <span class="text-slate-400 block font-normal text-[10px]">Bs. \${p.amountVes}</span></td>
              <td class="py-3 px-6"><span class="font-bold">\${p.paymentMethod}</span> <div class="font-mono text-slate-400 text-[10px]">Ref: \${p.referenceNumber}</div></td>
              <td class="py-3 px-6">
                \${p.voucherBase64 ? \`<a href="\${p.voucherBase64}" target="_blank" class="text-sky-400 underline font-bold">Ver Voucher</a>\` : 'Sin imagen'}
              </td>
              <td class="py-3 px-6 text-right">
                <button onclick="approvePayment('\${p.id}')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-xl">✅ Aprobar y Renovar</button>
              </td>
            \`;
            tbody.appendChild(tr);
          });
        } else {
          section.classList.add('hidden');
        }
      } catch (e) {}
    }

    async function approvePayment(paymentId) {
      if (!confirm('¿Confirma que ha verificado los fondos recibidos para aprobar esta renovación?')) return;
      try {
        const res = await fetch('/api/cloud/admin/approve-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId })
        });
        const data = await res.json();
        if (data.success) {
          alert('✅ ' + data.message);
          loadPayments();
          loadTenants();
        }
      } catch (e) {
        alert('Error aprobando pago');
      }
    }

    function copyPayLink(url) {
      navigator.clipboard.writeText(url);
      alert('📋 Enlace de pago copiado al portapapeles:\\n' + url);
    }

    function sendWhatsappBill(name, phone, usd, ves, payUrl) {
      const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
      const text = encodeURIComponent(
        '👋 Estimado cliente de ' + name + ':\\n\\n' +
        'Le recordamos el pago de su suscripción mensual de software SuperPOS SaaS.\\n\\n' +
        '💵 Monto: $' + usd + '.00 USD (Bs. ' + ves + ' a Tasa Oficial BCV)\\n' +
        '🔗 Portal de Pago Directo & Carga de Comprobante (Pago Móvil / Binance):\\n' + payUrl + '\\n\\n' +
        'Gracias por su confianza.'
      );
      const waUrl = cleanPhone ? 'https://wa.me/' + cleanPhone + '?text=' + text : 'https://wa.me/?text=' + text;
      window.open(waUrl, '_blank');
    }

    async function generateOfflineToken(tenantId) {
      try {
        const res = await fetch('/api/cloud/admin/generate-offline-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, days: 30 })
        });
        const data = await res.json();
        if (data.success) {
          prompt('🔑 Token Criptográfico Offline (Válido por 30 días):', data.token);
        }
      } catch (e) {
        alert('Error generando token');
      }
    }

    async function toggleTenant(tenantId, newStatus) {
      if (!confirm('¿Seguro que deseas cambiar el estado de este supermercado a: ' + newStatus + '?')) return;
      try {
        await fetch('/api/cloud/admin/toggle-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, status: newStatus })
        });
        loadTenants();
      } catch (e) {
        alert('Error al actualizar estado');
      }
    }

    function openNewTenantModal() { document.getElementById('newModal').classList.remove('hidden'); }
    function closeNewTenantModal() { document.getElementById('newModal').classList.add('hidden'); }
    function openConfigModal() { loadConfig(); document.getElementById('configModal').classList.remove('hidden'); }
    function closeConfigModal() { document.getElementById('configModal').classList.add('hidden'); }

    async function createTenant(e) {
      e.preventDefault();
      const body = {
        name: document.getElementById('t-name').value,
        rif: document.getElementById('t-rif').value,
        city: document.getElementById('t-city').value,
        plan: document.getElementById('t-plan').value,
        monthlyPrice: document.getElementById('t-price').value
      };
      await fetch('/api/cloud/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      closeNewTenantModal();
      loadTenants();
    }

    loadTenants();
    loadPayments();
  </script>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 4000;
const HOST = '0.0.0.0';

fastify.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`[SuperPOS Cloud Master] Servidor operativo en ${address}`);
});
