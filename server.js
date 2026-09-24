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
const BACKUPS_DIR = path.join(__dirname, 'backups_vault');
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

function getTenants() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = [
      {
        id: 'tenant-super-1',
        name: 'Supermercado Central Express, C.A.',
        rif: 'J-31456982-1',
        city: 'Maracay, Edo. Aragua',
        plan: 'PROFESIONAL',
        monthlyPrice: 60,
        status: 'ACTIVE',
        lastHeartbeat: new Date().toISOString(),
        nextDueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
        contact: 'Gerencia General (+58 412-1234567)'
      }
    ];
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { return []; }
}

function saveTenants(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// 1. API Heartbeat (El software del supermercado consulta aquí)
app.post('/api/cloud/license/heartbeat', (req, res) => {
  const { tenantId, machineFingerprint } = req.body || {};
  let tenants = getTenants();
  let tenant = tenants.find(t => t.id === tenantId);
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
      machineFingerprint
    };
    tenants.push(tenant);
  } else {
    tenant.lastHeartbeat = new Date().toISOString();
  }
  saveTenants(tenants);
  res.json({
    valid: tenant.status === 'ACTIVE',
    status: tenant.status,
    tenantId: tenant.id,
    plan: tenant.plan,
    nextDueDate: tenant.nextDueDate
  });
});

// 2. API Listar y Crear Clientes
app.get('/api/cloud/admin/tenants', (req, res) => res.json(getTenants()));

app.post('/api/cloud/admin/tenants', (req, res) => {
  const { name, rif, city, plan, monthlyPrice, contact } = req.body || {};
  let tenants = getTenants();
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
    contact: contact || ''
  };
  tenants.push(newTenant);
  saveTenants(tenants);
  res.json({ success: true, tenant: newTenant });
});

// 3. API Kill-Switch
app.post('/api/cloud/admin/toggle-status', (req, res) => {
  const { tenantId, status } = req.body || {};
  let tenants = getTenants();
  const idx = tenants.findIndex(t => t.id === tenantId);
  if (idx !== -1) {
    tenants[idx].status = status;
    saveTenants(tenants);
    res.json({ success: true, tenant: tenants[idx] });
  } else {
    res.status(404).json({ error: 'No encontrado' });
  }
});

// 4. API Generador de Token Offline
app.post('/api/cloud/admin/generate-offline-token', (req, res) => {
  const { tenantId, days } = req.body || {};
  const secretKey = 'SUPERPOS_SAAS_SECRET_KEY_2026';
  const durationDays = Number(days) || 3;
  const expiry = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
  const hash = crypto.createHmac('sha256', secretKey).update(`${tenantId}_${expiry}`).digest('hex').substring(0, 10).toUpperCase();
  const token = `SP-${hash}-${durationDays}D`;
  res.json({ success: true, token, expiry, durationDays });
});

// 5. Interfaz Visual Master Completa
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="es" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SuperPOS Master Cloud — Centro de Mando</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>body { font-family: 'Plus Jakarta Sans', sans-serif; }</style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
  <!-- Header -->
  <header class="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md p-4 sticky top-0 z-50">
    <div class="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-emerald-500 flex items-center justify-center font-black text-xl shadow-lg shadow-sky-500/20">⚡</div>
        <div>
          <span class="font-bold text-lg text-white">SuperPOS <span class="text-sky-400">Master Cloud</span></span>
          <span class="text-[10px] block text-emerald-400 font-mono font-semibold">● CENTRO DE MANDO SAAS VENEZUELA</span>
        </div>
      </div>
      <div class="flex gap-2">
        <button onclick="openModal()" class="bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition shadow-lg shadow-sky-600/30 flex items-center gap-1.5">
          <span>+</span> Registrar Supermercado
        </button>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
    <!-- Metricas -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
        <div class="text-slate-400 text-xs font-semibold uppercase">Supermercados Activos</div>
        <div id="sa" class="text-3xl font-black text-emerald-400 mt-2">0</div>
        <div class="text-[11px] text-slate-500 mt-1">Facturando al día</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
        <div class="text-slate-400 text-xs font-semibold uppercase">Clientes Suspendidos</div>
        <div id="ss" class="text-3xl font-black text-rose-400 mt-2">0</div>
        <div class="text-[11px] text-slate-500 mt-1">Bloqueados por falta de pago</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
        <div class="text-slate-400 text-xs font-semibold uppercase">Ingresos Mensuales (MRR)</div>
        <div id="sr" class="text-3xl font-black text-sky-400 mt-2">$0</div>
        <div class="text-[11px] text-slate-500 mt-1">Recurrencia mensual SaaS</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
        <div class="text-slate-400 text-xs font-semibold uppercase">Bóveda de Respaldos</div>
        <div class="text-3xl font-black text-amber-400 mt-2">NVMe Cloud</div>
        <div class="text-[11px] text-slate-500 mt-1">Sincronización automática</div>
      </div>
    </div>

    <!-- Pestañas de Control -->
    <div class="flex gap-2 border-b border-slate-800 pb-2">
      <button onclick="switchTab('tab-clients')" id="btn-tab-clients" class="px-4 py-2 rounded-xl text-xs font-bold bg-sky-600 text-white transition">🏢 Supermercados & Licencias</button>
      <button onclick="switchTab('tab-offline')" id="btn-tab-offline" class="px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-slate-400 hover:text-white transition">🔑 Generador Token Offline</button>
    </div>

    <!-- TAB 1: Supermercados -->
    <div id="tab-clients" class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      <div class="p-4 border-b border-slate-800 flex justify-between items-center">
        <div>
          <h2 class="font-bold text-base text-white">Supermercados y Comercios Conectados</h2>
          <p class="text-xs text-slate-400">Control de licencias, monitoreo de latidos en vivo y Kill-Switch remoto.</p>
        </div>
        <button onclick="load()" class="text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition">🔄 Actualizar</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
            <tr>
              <th class="p-4">Supermercado / RIF</th>
              <th class="p-4">Ubicación & Contacto</th>
              <th class="p-4">Plan & Canon</th>
              <th class="p-4">Última Conexión</th>
              <th class="p-4">Estado</th>
              <th class="p-4 text-right">Acción Kill-Switch</th>
            </tr>
          </thead>
          <tbody id="tb" class="divide-y divide-slate-800"></tbody>
        </table>
      </div>
    </div>

    <!-- TAB 2: Generador Offline -->
    <div id="tab-offline" class="bg-slate-900 border border-slate-800 rounded-2xl p-6 hidden space-y-4">
      <div>
        <h2 class="font-bold text-base text-white">Generador de Código de Emergencia Offline</h2>
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
          </select>
        </div>
        <button onclick="generateOfflineToken()" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 font-bold text-white rounded-xl transition">Generar Clave de Desbloqueo</button>
        <div id="off-result" class="hidden p-4 bg-emerald-950/80 border border-emerald-500/50 rounded-xl space-y-1">
          <div class="text-[10px] text-emerald-400 uppercase font-bold">Código para el cajero/gerente:</div>
          <div id="off-token-text" class="text-lg font-mono font-black text-emerald-300"></div>
          <div class="text-[10px] text-slate-400">El cliente lo ingresa en su pantalla de bloqueo para desbloquear el POS.</div>
        </div>
      </div>
    </div>
  </main>

  <!-- Modal Nuevo Supermercado -->
  <div id="modal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
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
          <label class="block text-slate-400 mb-1">Contacto / Teléfono</label>
          <input id="tcontact" placeholder="Gerente (+58 412-1234567)" class="w-full bg-slate-950 border border-slate-700 p-2.5 rounded-xl text-white outline-none">
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300">Cancelar</button>
          <button type="submit" class="px-4 py-2 bg-sky-600 hover:bg-sky-500 font-bold rounded-xl text-white">Guardar Supermercado</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    let globalTenants = [];

    async function load() {
      try {
        const r = await fetch('/api/cloud/admin/tenants');
        globalTenants = await r.json();
        let a = 0, s = 0, rev = 0;
        const tb = document.getElementById('tb');
        const offSelect = document.getElementById('off-tenant');
        tb.innerHTML = '';
        offSelect.innerHTML = '';

        globalTenants.forEach(t => {
          if (t.status === 'ACTIVE') { a++; rev += (t.monthlyPrice || 0); }
          else { s++; }
          const act = t.status === 'ACTIVE';

          const opt = document.createElement('option');
          opt.value = t.id;
          opt.innerText = t.name + ' (' + t.rif + ')';
          offSelect.appendChild(opt);

          const tr = document.createElement('tr');
          tr.className = 'hover:bg-slate-800/40 transition';
          tr.innerHTML = \`
            <td class="p-4 font-bold text-white">
              \${t.name}
              <div class="text-[10px] text-slate-500 font-mono">\${t.rif}</div>
            </td>
            <td class="p-4 text-slate-400">
              <div>\${t.city}</div>
              <div class="text-[10px] text-slate-500">\${t.contact || ''}</div>
            </td>
            <td class="p-4">
              <span class="font-bold">\${t.plan}</span>
              <div class="text-emerald-400 font-bold">$\${t.monthlyPrice}/mes</div>
            </td>
            <td class="p-4 text-slate-400 font-mono text-[10px]">\${t.lastHeartbeat ? new Date(t.lastHeartbeat).toLocaleTimeString() : 'Nunca'}</td>
            <td class="p-4">
              \${act ? '<span class="bg-emerald-950 text-emerald-400 border border-emerald-800 px-2.5 py-1 rounded-full text-[10px] font-bold">● ACTIVO</span>' : '<span class="bg-rose-950 text-rose-400 border border-rose-800 px-2.5 py-1 rounded-full text-[10px] font-bold">■ SUSPENDIDO</span>'}
            </td>
            <td class="p-4 text-right">
              \${act ? 
                \`<button onclick="toggle('\${t.id}','SUSPENDED')" class="bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-600 px-3 py-1.5 rounded-xl font-bold transition">🔒 Suspender</button>\` : 
                \`<button onclick="toggle('\${t.id}','ACTIVE')" class="bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-600 px-3 py-1.5 rounded-xl font-bold transition">🔓 Reactivar</button>\`
              }
            </td>
          \`;
          tb.appendChild(tr);
        });

        document.getElementById('sa').innerText = a;
        document.getElementById('ss').innerText = s;
        document.getElementById('sr').innerText = '$' + rev;
      } catch (e) { console.error(e); }
    }

    async function toggle(id, st) {
      if (!confirm('¿Deseas cambiar el estado a: ' + st + '?')) return;
      await fetch('/api/cloud/admin/toggle-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: id, status: st })
      });
      load();
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
      document.getElementById('tab-offline').classList.add('hidden');
      document.getElementById('btn-tab-clients').className = 'px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-slate-400 hover:text-white transition';
      document.getElementById('btn-tab-offline').className = 'px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-slate-400 hover:text-white transition';

      document.getElementById(tabId).classList.remove('hidden');
      document.getElementById(tabId === 'tab-clients' ? 'btn-tab-clients' : 'btn-tab-offline').className = 'px-4 py-2 rounded-xl text-xs font-bold bg-sky-600 text-white transition';
    }

    function openModal() { document.getElementById('modal').classList.remove('hidden'); }
    function closeModal() { document.getElementById('modal').classList.add('hidden'); }

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
          contact: document.getElementById('tcontact').value
        })
      });
      closeModal();
      load();
    }

    load();
    setInterval(load, 10000);
  </script>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('SuperPOS Master Cloud corriendo en puerto ' + PORT);
});
