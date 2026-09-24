const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const DATA_FILE = path.join(__dirname, 'tenants.json');

function getTenants() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = [{
      id: 'tenant-super-1',
      name: 'Supermercado Central Express, C.A.',
      rif: 'J-31456982-1',
      city: 'Maracay, Edo. Aragua',
      plan: 'PROFESIONAL',
      monthlyPrice: 60,
      status: 'ACTIVE',
      lastHeartbeat: new Date().toISOString()
    }];
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { return []; }
}

function saveTenants(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// 1. API Heartbeat para validar si el supermercado está activo
app.post('/api/cloud/license/heartbeat', (req, res) => {
  const { tenantId } = req.body || {};
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
      lastHeartbeat: new Date().toISOString()
    };
    tenants.push(tenant);
  } else {
    tenant.lastHeartbeat = new Date().toISOString();
  }
  saveTenants(tenants);
  res.json({ valid: tenant.status === 'ACTIVE', status: tenant.status, tenantId: tenant.id });
});

// 2. API para listar clientes en el panel
app.get('/api/cloud/admin/tenants', (req, res) => {
  res.json(getTenants());
});

// 3. API Kill-Switch (Suspender o Reactivar con 1 clic)
app.post('/api/cloud/admin/toggle-status', (req, res) => {
  const { tenantId, status } = req.body || {};
  let tenants = getTenants();
  const idx = tenants.findIndex(t => t.id === tenantId);
  if (idx !== -1) {
    tenants[idx].status = status;
    saveTenants(tenants);
    res.json({ success: true, tenant: tenants[idx] });
  } else {
    res.status(404).json({ error: 'Cliente no encontrado' });
  }
});

// 4. Panel Visual Web de Control Master
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="es" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SuperPOS Master Cloud</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>body{font-family:'Plus Jakarta Sans',sans-serif;}</style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
  <header class="border-b border-slate-800 bg-slate-900/80 p-4 sticky top-0 z-50">
    <div class="max-w-7xl mx-auto flex justify-between items-center">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-emerald-500 flex items-center justify-center font-black text-xl shadow-lg shadow-sky-500/20">⚡</div>
        <div>
          <span class="font-bold text-lg text-white">SuperPOS <span class="text-sky-400">Master Cloud</span></span>
          <span class="text-[10px] block text-emerald-400 font-mono font-semibold">● SERVIDOR CLOUD ACTIVO EN PRODUCCIÓN</span>
        </div>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto p-6 space-y-6">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
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
        <div class="text-slate-400 text-xs font-semibold uppercase">Ingresos Recurrentes (MRR)</div>
        <div id="sr" class="text-3xl font-black text-sky-400 mt-2">$0</div>
        <div class="text-[11px] text-slate-500 mt-1">Facturación SaaS activa</div>
      </div>
    </div>

    <div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      <div class="p-4 border-b border-slate-800 flex justify-between items-center">
        <div>
          <h2 class="font-bold text-base text-white">Supermercados y Comercios Conectados</h2>
          <p class="text-xs text-slate-400">Control de licencias y activación remota de Kill-Switch.</p>
        </div>
        <button onclick="load()" class="text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition">🔄 Actualizar</button>
      </div>
      <table class="w-full text-left text-xs">
        <thead class="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
          <tr>
            <th class="p-4">Supermercado / RIF</th>
            <th class="p-4">Ubicación</th>
            <th class="p-4">Plan & Canon</th>
            <th class="p-4">Último Latido</th>
            <th class="p-4">Estado</th>
            <th class="p-4 text-right">Acción Kill-Switch</th>
          </tr>
        </thead>
        <tbody id="tb" class="divide-y divide-slate-800"></tbody>
      </table>
    </div>
  </main>

  <script>
    async function load() {
      try {
        const r = await fetch('/api/cloud/admin/tenants');
        const d = await r.json();
        let a = 0, s = 0, rev = 0;
        const tb = document.getElementById('tb');
        tb.innerHTML = '';
        d.forEach(t => {
          if (t.status === 'ACTIVE') { a++; rev += (t.monthlyPrice || 0); }
          else { s++; }
          const act = t.status === 'ACTIVE';
          const tr = document.createElement('tr');
          tr.className = 'hover:bg-slate-800/40 transition';
          tr.innerHTML = \`
            <td class="p-4 font-bold text-white">\${t.name}<div class="text-[10px] text-slate-500 font-mono">\${t.rif}</div></td>
            <td class="p-4 text-slate-400">\${t.city}</td>
            <td class="p-4"><span class="font-bold">\${t.plan}</span><div class="text-emerald-400 font-bold">$\${t.monthlyPrice}/mes</div></td>
            <td class="p-4 text-slate-400 font-mono text-[10px]">\${t.lastHeartbeat ? new Date(t.lastHeartbeat).toLocaleTimeString() : 'Nunca'}</td>
            <td class="p-4">\${act ? '<span class="bg-emerald-950 text-emerald-400 border border-emerald-800 px-2.5 py-1 rounded-full text-[10px] font-bold">● ACTIVO</span>' : '<span class="bg-rose-950 text-rose-400 border border-rose-800 px-2.5 py-1 rounded-full text-[10px] font-bold">■ SUSPENDIDO</span>'}</td>
            <td class="p-4 text-right">\${act ? \`<button onclick="toggle('\${t.id}','SUSPENDED')" class="bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-600/40 px-3 py-1.5 rounded-xl font-bold transition">🔒 Suspender</button>\` : \`<button onclick="toggle('\${t.id}','ACTIVE')" class="bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-600/40 px-3 py-1.5 rounded-xl font-bold transition">🔓 Reactivar</button>\`}</td>
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
    load();
    setInterval(load, 10000);
  </script>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('SuperPOS Master Cloud listo en puerto ' + PORT);
});
