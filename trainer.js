'use strict';

/* ── Init Firebase ───────────────────────────────────── */
firebase.initializeApp(FIREBASE_CONFIG);
const db   = firebase.firestore();
const auth = firebase.auth();

/* ── State ───────────────────────────────────────────── */
const S = {
  user: null, userData: null,
  clients: [], workouts: [], assignments: [],
  view: 'dashboard',
  aiMessages: [],
  builderWorkoutId: null,  // null = new
};

/* ── Helpers ─────────────────────────────────────────── */
function qs(sel, ctx)  { return (ctx || document).querySelector(sel); }
function qsa(sel, ctx) { return [...(ctx || document).querySelectorAll(sel)]; }
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls)  e.className   = cls;
  if (text) e.textContent = text;
  return e;
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function fmt(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' });
}
function today() { return new Date().toISOString().slice(0, 10); }

const SPORT_LABEL = { fuerza:'Fuerza', running:'Running', ciclismo:'Ciclismo', hiit:'HIIT', personalizado:'Personalizado' };
const SPORT_BADGE = { fuerza:'badge-blue', running:'badge-green', ciclismo:'badge-yellow', hiit:'badge-red', personalizado:'badge-muted' };
const KIND_LABEL = {
  warmup:'Calentamiento', easy:'Suave', tempo:'Tempo', interval:'Intervalo',
  race:'Carrera', cooldown:'Enfriamiento',
  z2:'Z2 — Aeróbico', threshold:'Umbral', sprint:'Sprint',
};

/* ── Auth ────────────────────────────────────────────── */
auth.onAuthStateChanged(async user => {
  if (!user) { location.href = 'login.html'; return; }
  const snap = await db.collection('users').doc(user.uid).get();
  if (!snap.exists || snap.data().role !== 'trainer') {
    await auth.signOut(); location.href = 'login.html'; return;
  }
  S.user = user; S.userData = snap.data();
  document.getElementById('trainer-name').textContent = S.userData.name || 'Entrenador';
  document.getElementById('trainer-avatar').textContent = (S.userData.name || 'B')[0].toUpperCase();
  document.getElementById('logout-btn').onclick = () => { auth.signOut(); location.href = 'login.html'; };
  setupNav();
  navigate('dashboard');
});

/* ── Navigation ──────────────────────────────────────── */
function setupNav() {
  qsa('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });
}
function navigate(view) {
  S.view = view;
  qsa('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  qsa('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  ({ dashboard: loadDashboard, clients: loadClients, builder: loadBuilder,
     workouts: loadWorkouts, assignments: loadAssignments, ai: loadAI })[view]?.();
}

/* ══════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════ */
async function loadDashboard() {
  const wrap = document.getElementById('view-dashboard');
  wrap.innerHTML = '<div style="color:var(--muted);font-size:.88rem">Cargando...</div>';

  const [clientsSnap, assignSnap] = await Promise.all([
    db.collection('clients').where('trainerId', '==', S.user.uid).get(),
    db.collection('assignments').where('trainerId', '==', S.user.uid).orderBy('createdAt', 'desc').limit(8).get(),
  ]);
  const clients     = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const assignments = assignSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const done = assignments.filter(a => a.status === 'done').length;

  wrap.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Dashboard</h1><p class="page-subtitle">Bienvenido, ${S.userData.name}</p></div>
      <button class="btn btn-primary" onclick="navigate('builder')">+ Nuevo entrenamiento</button>
    </div>
    <div class="stats-row">
      <div class="stat-card"><div class="stat-label">Clientes activos</div><div class="stat-value">${clients.length}</div></div>
      <div class="stat-card"><div class="stat-label">Asignaciones totales</div><div class="stat-value">${assignments.length}</div></div>
      <div class="stat-card"><div class="stat-label">Completadas</div><div class="stat-value">${done}</div></div>
      <div class="stat-card"><div class="stat-label">Pendientes</div><div class="stat-value">${assignments.filter(a => a.status === 'pending').length}</div></div>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-header"><h2>Clientes</h2><button class="btn btn-ghost btn-sm" onclick="navigate('clients')">Ver todos</button></div>
        <div id="dash-clients"></div>
      </div>
      <div class="card">
        <div class="card-header"><h2>Actividad reciente</h2></div>
        <div class="activity-list" id="dash-activity"></div>
      </div>
    </div>`;

  // Mini client list
  const dc = document.getElementById('dash-clients');
  if (!clients.length) {
    dc.innerHTML = '<div class="empty-state"><div class="empty-title">Sin clientes</div><div class="empty-sub">Añade tu primer cliente</div></div>';
  } else {
    dc.innerHTML = clients.slice(0, 5).map(c => `
      <div class="activity-item" style="cursor:pointer" onclick="openClientDetail('${c.clientId || c.id}')">
        <div class="activity-sport">${(c.name||'?')[0].toUpperCase()}</div>
        <div><div class="activity-name">${c.name}</div><div class="activity-meta">${c.goal||'—'}</div></div>
        <span class="badge badge-muted" style="margin-left:auto">Ver</span>
      </div>`).join('');
  }

  // Recent assignments
  const da = document.getElementById('dash-activity');
  if (!assignments.length) {
    da.innerHTML = '<div class="empty-state"><div class="empty-title">Sin asignaciones</div></div>';
  } else {
    const workoutIds = [...new Set(assignments.map(a => a.workoutId))];
    const wDocs = await Promise.all(workoutIds.map(id => db.collection('workouts').doc(id).get()));
    const wMap = {}; wDocs.forEach(d => { if (d.exists) wMap[d.id] = d.data(); });
    da.innerHTML = assignments.map(a => {
      const w = wMap[a.workoutId] || {};
      const statusDot = { done:'dot-green', pending:'dot-yellow', skipped:'dot-muted' }[a.status] || 'dot-muted';
      return `<div class="activity-item">
        <span class="dot ${statusDot}"></span>
        <div>
          <div class="activity-name">${w.title || 'Entrenamiento'}</div>
          <div class="activity-meta">${a.clientName || '—'} · ${a.scheduledDate || '—'}</div>
        </div>
        <span class="badge ${SPORT_BADGE[w.sport] || 'badge-muted'}" style="margin-left:auto">${SPORT_LABEL[w.sport] || '—'}</span>
      </div>`;
    }).join('');
  }
}

/* ══════════════════════════════════════════
   CLIENTS
══════════════════════════════════════════ */
async function loadClients() {
  const wrap = document.getElementById('view-clients');
  wrap.innerHTML = '<div style="color:var(--muted);font-size:.88rem">Cargando...</div>';

  const snap = await db.collection('clients').where('trainerId', '==', S.user.uid).get();
  S.clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  wrap.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Clientes</h1><p class="page-subtitle">${S.clients.length} cliente${S.clients.length !== 1 ? 's' : ''}</p></div>
      <button class="btn btn-primary" onclick="openModal('modal-add-client')">+ Añadir cliente</button>
    </div>
    <div class="client-grid" id="client-grid"></div>`;

  renderClientGrid();
}

function renderClientGrid() {
  const grid = document.getElementById('client-grid');
  if (!S.clients.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-title">Sin clientes todavía</div>
      <div class="empty-sub">Añade tu primer cliente para empezar a asignar entrenamientos.</div>
    </div>`;
    return;
  }
  grid.innerHTML = S.clients.map(c => `
    <div class="client-card" onclick="openClientDetail('${c.clientId || ''}', '${c.id}')">
      <div style="display:flex;align-items:center;gap:.7rem;margin-bottom:.75rem">
        <div class="user-avatar" style="width:38px;height:38px;font-size:.9rem">${(c.name||'?')[0].toUpperCase()}</div>
        <div>
          <div class="client-card-name">${c.name}</div>
          <div class="client-card-email">${c.email}</div>
        </div>
      </div>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap">
        <span class="badge badge-muted">${c.goal || '—'}</span>
        <span class="badge ${c.clientId ? 'badge-green' : 'badge-yellow'}">${c.clientId ? 'Registrado' : 'Pendiente'}</span>
      </div>
    </div>`).join('');
}

async function saveClient(e) {
  e.preventDefault();
  const name  = document.getElementById('ac-name').value.trim();
  const email = document.getElementById('ac-email').value.trim().toLowerCase();
  const goal  = document.getElementById('ac-goal').value;
  const notes = document.getElementById('ac-notes').value.trim();
  try {
    // Create pending invite
    await db.collection('pendingClients').doc(email).set({
      name, email, goal, notes, trainerId: S.user.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    // Create client record
    const ref = await db.collection('clients').add({
      name, email, goal, notes,
      trainerId: S.user.uid, clientId: '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    S.clients.push({ id: ref.id, name, email, goal, notes, trainerId: S.user.uid, clientId: '' });
    renderClientGrid();
    closeModal('modal-add-client');
    e.target.reset();
    toast('Cliente añadido. Puede registrarse con ' + email);
  } catch(err) { toast('Error: ' + err.message); }
}

async function openClientDetail(clientId, docId) {
  const content = document.getElementById('client-detail-content');
  content.innerHTML = '<div style="color:var(--muted)">Cargando...</div>';
  openModal('modal-client-detail');

  const clientDoc = docId
    ? await db.collection('clients').doc(docId).get()
    : null;

  let clientData = clientDoc?.data() || S.clients.find(c => c.clientId === clientId || c.id === docId) || {};

  // Load assignments for this client
  let assignSnap;
  if (clientData.clientId) {
    assignSnap = await db.collection('assignments')
      .where('trainerId', '==', S.user.uid)
      .where('clientId', '==', clientData.clientId)
      .orderBy('scheduledDate', 'desc').limit(10).get();
  } else { assignSnap = { docs: [] }; }

  const assigns = assignSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem">
      <div class="user-avatar" style="width:46px;height:46px;font-size:1rem">${(clientData.name||'?')[0].toUpperCase()}</div>
      <div>
        <h2>${clientData.name || '—'}</h2>
        <div style="font-size:.82rem;color:var(--muted);margin-top:.2rem">${clientData.email || ''}</div>
      </div>
      <span class="badge ${clientData.clientId ? 'badge-green' : 'badge-yellow'}" style="margin-left:auto">
        ${clientData.clientId ? 'Registrado' : 'Pendiente registro'}
      </span>
    </div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1.5rem">
      <span class="badge badge-muted">${clientData.goal || '—'}</span>
    </div>
    ${clientData.notes ? `<p style="margin-bottom:1.5rem">${clientData.notes}</p>` : ''}
    <div class="divider"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin:1rem 0">
      <h3>Entrenamientos asignados</h3>
      <button class="btn btn-primary btn-sm" onclick="closeModal('modal-client-detail');navigate('workouts')">Asignar</button>
    </div>
    ${assigns.length ? assigns.map(a => `
      <div class="assignment-row">
        <span class="assignment-date">${a.scheduledDate || '—'}</span>
        <span class="assignment-name">${a.workoutTitle || 'Entrenamiento'}</span>
        <span class="badge ${a.status==='done'?'badge-green':a.status==='skipped'?'badge-red':'badge-yellow'}">${a.status==='done'?'Completado':a.status==='skipped'?'Omitido':'Pendiente'}</span>
      </div>`).join('') : '<div style="color:var(--muted);font-size:.88rem;padding:.5rem 0">Sin asignaciones</div>'}
  `;
}

/* ══════════════════════════════════════════
   BUILDER
══════════════════════════════════════════ */
function loadBuilder(workoutId) {
  S.builderWorkoutId = workoutId || null;
  const wrap = document.getElementById('view-builder');
  wrap.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">${workoutId ? 'Editar entrenamiento' : 'Crear entrenamiento'}</h1></div>
      <div style="display:flex;gap:.6rem">
        <button class="btn btn-ghost" onclick="navigate('workouts')">Cancelar</button>
        <button class="btn btn-primary" onclick="saveWorkout()">Guardar</button>
      </div>
    </div>
    <div class="builder-wrapper">
      <div class="card builder-meta">
        <input id="builder-title" placeholder="Nombre del entrenamiento..." />
        <div style="margin:.75rem 0 .4rem;font-size:.78rem;font-weight:500;color:var(--muted2)">Tipo de deporte</div>
        <div class="sport-selector">
          <button class="sport-pill active" data-sport="fuerza" onclick="selectSport(this)">Fuerza</button>
          <button class="sport-pill" data-sport="running" onclick="selectSport(this)">Running</button>
          <button class="sport-pill" data-sport="ciclismo" onclick="selectSport(this)">Ciclismo</button>
          <button class="sport-pill" data-sport="hiit" onclick="selectSport(this)">HIIT</button>
          <button class="sport-pill" data-sport="personalizado" onclick="selectSport(this)">Personalizado</button>
        </div>
        <div class="form-group" style="margin-top:.85rem;margin-bottom:0">
          <label>Descripcion / notas generales</label>
          <textarea id="builder-desc" rows="2" placeholder="Objetivos de la sesion, instrucciones generales..."></textarea>
        </div>
      </div>

      <div id="builder-blocks"></div>

      <div class="add-block-panel">
        <span>Añadir bloque:</span>
        <button class="btn-add-block" onclick="addBlock('strength')">Fuerza</button>
        <button class="btn-add-block" onclick="addBlock('running')">Running</button>
        <button class="btn-add-block" onclick="addBlock('cycling')">Ciclismo</button>
        <button class="btn-add-block" onclick="addBlock('hiit')">HIIT</button>
        <button class="btn-add-block" onclick="addBlock('notes')">Notas</button>
      </div>
    </div>`;
}

function selectSport(btn) {
  qsa('.sport-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
}

function addBlock(type) {
  const container = document.getElementById('builder-blocks');
  const card = document.createElement('div');
  card.className = 'block-card';
  card.dataset.blockType = type;

  const labels = { strength:'Fuerza', running:'Running', cycling:'Ciclismo', hiit:'HIIT', notes:'Notas' };
  card.innerHTML = `
    <div class="block-header">
      <span class="block-type-label">${labels[type]}</span>
      <button class="btn btn-danger btn-xs" onclick="this.closest('.block-card').remove()">Eliminar</button>
    </div>
    <div class="block-body">${renderBlockEditor(type)}</div>`;
  container.appendChild(card);
}

function renderBlockEditor(type) {
  if (type === 'strength') return `
    <table class="strength-table">
      <thead><tr>
        <th>Ejercicio</th><th>Series</th><th>Reps</th><th>Peso (kg)</th><th>Descanso (s)</th><th>Notas</th><th></th>
      </tr></thead>
      <tbody id="str-body-${Date.now()}">
        ${strengthRow()}
      </tbody>
    </table>
    <button class="btn btn-ghost btn-xs" style="margin-top:.6rem" onclick="addStrengthRow(this)">+ Ejercicio</button>`;

  if (type === 'running') return `
    <div style="display:grid;grid-template-columns:120px 90px 90px 110px 100px 1fr 24px;gap:.3rem;margin-bottom:.4rem;padding:0 .4rem">
      <span class="text-xs text-muted">Tipo</span><span class="text-xs text-muted">Duración (min)</span>
      <span class="text-xs text-muted">Distancia (km)</span><span class="text-xs text-muted">Ritmo (/km)</span>
      <span class="text-xs text-muted">Esfuerzo</span><span class="text-xs text-muted">Descripción</span><span></span>
    </div>
    <div class="segments-list" data-sport="running">
      ${runningSegmentRow()}
    </div>
    <button class="btn btn-ghost btn-xs" style="margin-top:.6rem" onclick="addSegmentRow(this,'running')">+ Segmento</button>`;

  if (type === 'cycling') return `
    <div style="display:grid;grid-template-columns:130px 90px 80px 80px 90px 1fr 24px;gap:.3rem;margin-bottom:.4rem;padding:0 .4rem">
      <span class="text-xs text-muted">Tipo</span><span class="text-xs text-muted">Duración (min)</span>
      <span class="text-xs text-muted">Vatios</span><span class="text-xs text-muted">% FTP</span>
      <span class="text-xs text-muted">Cadencia</span><span class="text-xs text-muted">Descripción</span><span></span>
    </div>
    <div class="segments-list" data-sport="cycling">
      ${cyclingSegmentRow()}
    </div>
    <button class="btn btn-ghost btn-xs" style="margin-top:.6rem" onclick="addSegmentRow(this,'cycling')">+ Segmento</button>`;

  if (type === 'hiit') return `
    <div class="hiit-config">
      <div class="form-group"><label>Rondas</label><input type="number" class="hiit-rounds" value="4" min="1" /></div>
      <div class="form-group"><label>Trabajo (seg)</label><input type="number" class="hiit-work" value="40" min="5" /></div>
      <div class="form-group"><label>Descanso (seg)</label><input type="number" class="hiit-rest" value="20" min="5" /></div>
    </div>
    <div style="font-size:.8rem;font-weight:500;color:var(--muted2);margin-bottom:.4rem">Ejercicios</div>
    <div class="hiit-exercises">
      <div class="hiit-exercise-row"><input type="text" placeholder="Ejercicio..." /><button class="btn btn-ghost btn-xs" onclick="this.closest('.hiit-exercise-row').remove()">x</button></div>
    </div>
    <button class="btn btn-ghost btn-xs" style="margin-top:.5rem" onclick="addHiitExercise(this)">+ Ejercicio</button>`;

  if (type === 'notes') return `<textarea class="notes-content" rows="4" placeholder="Instrucciones, contexto, recordatorios para el cliente..."></textarea>`;

  return '';
}

function strengthRow() {
  return `<tr>
    <td><input type="text" placeholder="Nombre del ejercicio" style="min-width:150px" /></td>
    <td><input type="number" value="3" min="1" max="20" style="width:60px" /></td>
    <td><input type="text" value="8-10" style="width:65px" /></td>
    <td><input type="number" value="" min="0" step="0.5" placeholder="0" style="width:70px" /></td>
    <td><input type="number" value="90" min="0" style="width:70px" /></td>
    <td><input type="text" placeholder="Notas..." /></td>
    <td class="td-remove"><button class="btn-remove-row" onclick="this.closest('tr').remove()">x</button></td>
  </tr>`;
}
function addStrengthRow(btn) {
  btn.previousElementSibling.querySelector('tbody').insertAdjacentHTML('beforeend', strengthRow());
}

function runningSegmentRow() {
  return `<div class="segment-row running-seg">
    <select>
      <option value="warmup">Calentamiento</option><option value="easy">Suave</option>
      <option value="tempo">Tempo</option><option value="interval">Intervalo</option>
      <option value="race">Carrera</option><option value="cooldown">Enfriamiento</option>
    </select>
    <input type="number" placeholder="Min" min="0" step="0.5" />
    <input type="number" placeholder="km" min="0" step="0.1" />
    <input type="text" placeholder="5:30/km" />
    <input type="text" placeholder="Z2 / RPE 7" />
    <input type="text" placeholder="Descripción..." />
    <button class="btn-remove-seg" onclick="this.closest('.segment-row').remove()">x</button>
  </div>`;
}
function cyclingSegmentRow() {
  return `<div class="segment-row cycling-seg">
    <select>
      <option value="warmup">Calentamiento</option><option value="z2">Z2 Aeróbico</option>
      <option value="threshold">Umbral</option><option value="interval">Intervalo</option>
      <option value="sprint">Sprint</option><option value="cooldown">Enfriamiento</option>
    </select>
    <input type="number" placeholder="Min" min="0" step="0.5" />
    <input type="number" placeholder="W" min="0" />
    <input type="number" placeholder="%" min="0" max="200" />
    <input type="number" placeholder="rpm" min="0" />
    <input type="text" placeholder="Descripción..." />
    <button class="btn-remove-seg" onclick="this.closest('.segment-row').remove()">x</button>
  </div>`;
}
function addSegmentRow(btn, sport) {
  const list = btn.previousElementSibling;
  list.insertAdjacentHTML('beforeend', sport === 'running' ? runningSegmentRow() : cyclingSegmentRow());
}
function addHiitExercise(btn) {
  const list = btn.previousElementSibling;
  list.insertAdjacentHTML('beforeend', `<div class="hiit-exercise-row"><input type="text" placeholder="Ejercicio..." /><button class="btn btn-ghost btn-xs" onclick="this.closest('.hiit-exercise-row').remove()">x</button></div>`);
}

function readWorkoutFromDOM() {
  const title   = document.getElementById('builder-title').value.trim();
  const sport   = qs('.sport-pill.active')?.dataset.sport || 'personalizado';
  const desc    = document.getElementById('builder-desc').value.trim();
  const blocks  = [];

  qsa('.block-card').forEach(card => {
    const type = card.dataset.blockType;
    if (type === 'strength') {
      const exercises = [];
      qsa('tbody tr', card).forEach(row => {
        const inputs = qsa('input', row);
        const name = inputs[0]?.value.trim();
        if (!name) return;
        exercises.push({
          name,
          sets: Number(inputs[1]?.value) || 3,
          reps: inputs[2]?.value || '—',
          weight: Number(inputs[3]?.value) || 0,
          rest: Number(inputs[4]?.value) || 90,
          notes: inputs[5]?.value.trim() || '',
        });
      });
      if (exercises.length) blocks.push({ type: 'strength', exercises });
    } else if (type === 'running') {
      const segments = [];
      qsa('.segment-row', card).forEach(row => {
        const sel  = row.querySelector('select');
        const inps = qsa('input', row);
        segments.push({
          kind: sel?.value || 'easy',
          duration: Number(inps[0]?.value) || null,
          distance: Number(inps[1]?.value) || null,
          pace:     inps[2]?.value.trim() || '',
          effort:   inps[3]?.value.trim() || '',
          description: inps[4]?.value.trim() || '',
        });
      });
      if (segments.length) blocks.push({ type: 'running', segments });
    } else if (type === 'cycling') {
      const segments = [];
      qsa('.segment-row', card).forEach(row => {
        const sel  = row.querySelector('select');
        const inps = qsa('input', row);
        segments.push({
          kind: sel?.value || 'z2',
          duration:  Number(inps[0]?.value) || null,
          watts:     Number(inps[1]?.value) || null,
          ftp_pct:   Number(inps[2]?.value) || null,
          cadence:   Number(inps[3]?.value) || null,
          description: inps[4]?.value.trim() || '',
        });
      });
      if (segments.length) blocks.push({ type: 'cycling', segments });
    } else if (type === 'hiit') {
      const exercises = qsa('.hiit-exercise-row input', card).map(i => i.value.trim()).filter(Boolean);
      blocks.push({
        type: 'hiit',
        rounds:       Number(qs('.hiit-rounds', card)?.value) || 4,
        work_seconds: Number(qs('.hiit-work', card)?.value)   || 40,
        rest_seconds: Number(qs('.hiit-rest', card)?.value)   || 20,
        exercises,
      });
    } else if (type === 'notes') {
      const content = qs('.notes-content', card)?.value.trim();
      if (content) blocks.push({ type: 'notes', content });
    }
  });
  return { title, sport, description: desc, blocks };
}

async function saveWorkout() {
  const data = readWorkoutFromDOM();
  if (!data.title) { toast('Escribe un nombre para el entrenamiento'); return; }
  if (!data.blocks.length) { toast('Añade al menos un bloque'); return; }
  try {
    const payload = { ...data, trainerId: S.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
    if (S.builderWorkoutId) {
      await db.collection('workouts').doc(S.builderWorkoutId).update(payload);
      toast('Entrenamiento actualizado');
    } else {
      await db.collection('workouts').add(payload);
      toast('Entrenamiento guardado');
    }
    navigate('workouts');
  } catch(err) { toast('Error: ' + err.message); }
}

/* ══════════════════════════════════════════
   WORKOUTS LIBRARY
══════════════════════════════════════════ */
async function loadWorkouts() {
  const wrap = document.getElementById('view-workouts');
  wrap.innerHTML = '<div style="color:var(--muted);font-size:.88rem">Cargando...</div>';
  const snap = await db.collection('workouts').where('trainerId', '==', S.user.uid).orderBy('createdAt', 'desc').get();
  S.workouts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  wrap.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Biblioteca</h1><p class="page-subtitle">${S.workouts.length} entrenamiento${S.workouts.length !== 1 ? 's' : ''}</p></div>
      <button class="btn btn-primary" onclick="navigate('builder')">+ Crear</button>
    </div>
    <div class="workout-grid" id="workout-grid"></div>`;

  const grid = document.getElementById('workout-grid');
  if (!S.workouts.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-title">Sin entrenamientos</div>
      <div class="empty-sub">Crea tu primer plan y asígnalo a un cliente.</div>
    </div>`;
    return;
  }
  grid.innerHTML = S.workouts.map(w => `
    <div class="workout-card">
      <div class="workout-card-name">${w.title}</div>
      <div class="workout-card-meta">
        <span class="badge ${SPORT_BADGE[w.sport] || 'badge-muted'}">${SPORT_LABEL[w.sport] || w.sport}</span>
        <span class="badge badge-muted">${w.blocks?.length || 0} bloques</span>
      </div>
      ${w.description ? `<p style="margin-top:.6rem;font-size:.8rem">${w.description.slice(0,80)}${w.description.length>80?'...':''}</p>` : ''}
      <div class="workout-card-footer">
        <span>${fmt(w.createdAt)}</span>
        <div style="display:flex;gap:.4rem">
          <button class="btn btn-ghost btn-xs" onclick="openWorkoutDetail('${w.id}')">Ver</button>
          <button class="btn btn-primary btn-xs" onclick="openAssignModal('${w.id}','${w.title}')">Asignar</button>
        </div>
      </div>
    </div>`).join('');
}

function openWorkoutDetail(id) {
  const w = S.workouts.find(x => x.id === id);
  if (!w) return;
  const content = document.getElementById('workout-detail-content');
  content.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1.5rem">
      <div>
        <h2 style="font-size:1.2rem">${w.title}</h2>
        <div style="display:flex;gap:.4rem;margin-top:.5rem">
          <span class="badge ${SPORT_BADGE[w.sport] || 'badge-muted'}">${SPORT_LABEL[w.sport] || w.sport}</span>
        </div>
      </div>
      <div style="display:flex;gap:.5rem;flex-shrink:0">
        <button class="btn btn-ghost btn-sm" onclick="closeModal('modal-workout-detail');loadBuilder('${w.id}')">Editar</button>
        <button class="btn btn-primary btn-sm" onclick="closeModal('modal-workout-detail');openAssignModal('${w.id}','${w.title}')">Asignar</button>
      </div>
    </div>
    ${w.description ? `<p style="margin-bottom:1.5rem">${w.description}</p>` : ''}
    ${renderBlocksReadonly(w.blocks || [])}`;
  openModal('modal-workout-detail');
}

function renderBlocksReadonly(blocks) {
  return blocks.map(b => {
    if (b.type === 'strength') {
      return `<div class="block-card" style="margin-bottom:.75rem">
        <div class="block-header"><span class="block-type-label">Fuerza</span></div>
        <div class="block-body">
          <table class="strength-table">
            <thead><tr><th>Ejercicio</th><th>Series</th><th>Reps</th><th>Peso</th><th>Descanso</th><th>Notas</th></tr></thead>
            <tbody>${(b.exercises||[]).map(ex => `<tr>
              <td style="padding:.35rem .5rem">${ex.name}</td>
              <td style="padding:.35rem .5rem;color:var(--muted2)">${ex.sets}</td>
              <td style="padding:.35rem .5rem;color:var(--muted2)">${ex.reps}</td>
              <td style="padding:.35rem .5rem;color:var(--muted2)">${ex.weight ? ex.weight+'kg' : '—'}</td>
              <td style="padding:.35rem .5rem;color:var(--muted2)">${ex.rest}s</td>
              <td style="padding:.35rem .5rem;color:var(--muted);">${ex.notes||'—'}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;
    }
    if (b.type === 'running' || b.type === 'cycling') {
      const isRun = b.type === 'running';
      return `<div class="block-card" style="margin-bottom:.75rem">
        <div class="block-header"><span class="block-type-label">${isRun ? 'Running' : 'Ciclismo'}</span></div>
        <div class="block-body">
          ${(b.segments||[]).map(s => `
            <div style="padding:.5rem 0;border-bottom:1px solid var(--border)">
              <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:.2rem">
                ${KIND_LABEL[s.kind] || s.kind}
              </div>
              <div style="font-size:.88rem">
                ${[s.duration ? s.duration+'min' : '', s.distance ? s.distance+'km' : '',
                   s.pace || '', s.effort || '', isRun ? '' : (s.watts ? s.watts+'W' : ''),
                   isRun ? '' : (s.ftp_pct ? s.ftp_pct+'%FTP' : ''),
                   isRun ? '' : (s.cadence ? s.cadence+'rpm' : '')
                  ].filter(Boolean).join(' · ')}
              </div>
              ${s.description ? `<div style="font-size:.78rem;color:var(--muted);margin-top:.15rem">${s.description}</div>` : ''}
            </div>`).join('')}
        </div>
      </div>`;
    }
    if (b.type === 'hiit') return `<div class="block-card" style="margin-bottom:.75rem">
      <div class="block-header"><span class="block-type-label">HIIT</span></div>
      <div class="block-body">
        <div style="font-size:.88rem;color:var(--muted2);margin-bottom:.5rem">
          ${b.rounds} rondas · ${b.work_seconds}s trabajo · ${b.rest_seconds}s descanso
        </div>
        <ul style="padding-left:1rem;font-size:.88rem;color:var(--text2)">${(b.exercises||[]).map(e=>`<li>${e}</li>`).join('')}</ul>
      </div>
    </div>`;
    if (b.type === 'notes') return `<div class="notes-display" style="margin-bottom:.75rem">${b.content}</div>`;
    return '';
  }).join('');
}

/* ══════════════════════════════════════════
   ASSIGNMENTS
══════════════════════════════════════════ */
async function openAssignModal(workoutId, workoutTitle) {
  document.getElementById('assign-workout-id').value = workoutId;
  // Load clients into select
  const clientsSnap = await db.collection('clients').where('trainerId', '==', S.user.uid).get();
  const clients = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const sel = document.getElementById('assign-client');
  sel.innerHTML = clients.length
    ? clients.map(c => `<option value="${c.clientId || ''}" data-name="${c.name}">${c.name}${!c.clientId ? ' (pendiente registro)' : ''}</option>`).join('')
    : '<option value="">Sin clientes registrados</option>';
  document.getElementById('assign-date').value = today();
  openModal('modal-assign');
}

async function saveAssignment(e) {
  e.preventDefault();
  const workoutId  = document.getElementById('assign-workout-id').value;
  const clientSel  = document.getElementById('assign-client');
  const clientId   = clientSel.value;
  const clientName = clientSel.options[clientSel.selectedIndex]?.dataset.name || '';
  const date       = document.getElementById('assign-date').value;
  const notes      = document.getElementById('assign-notes').value.trim();
  if (!clientId) { toast('El cliente aún no se ha registrado'); return; }
  const workout = S.workouts.find(w => w.id === workoutId) || {};
  try {
    await db.collection('assignments').add({
      workoutId, clientId, clientName,
      workoutTitle: workout.title || '',
      workoutSport: workout.sport || '',
      trainerId: S.user.uid,
      scheduledDate: date, notes, status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    closeModal('modal-assign');
    document.getElementById('form-assign').reset();
    toast('Entrenamiento asignado a ' + clientName);
    if (S.view === 'assignments') loadAssignments();
  } catch(err) { toast('Error: ' + err.message); }
}

async function loadAssignments() {
  const wrap = document.getElementById('view-assignments');
  wrap.innerHTML = '<div style="color:var(--muted);font-size:.88rem">Cargando...</div>';
  const snap = await db.collection('assignments')
    .where('trainerId', '==', S.user.uid)
    .orderBy('scheduledDate', 'desc').limit(50).get();
  S.assignments = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  wrap.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Asignaciones</h1><p class="page-subtitle">${S.assignments.length} en total</p></div>
    </div>
    <div class="assignment-list">
      ${!S.assignments.length ? '<div class="empty-state"><div class="empty-title">Sin asignaciones</div><div class="empty-sub">Asigna entrenamientos desde la biblioteca.</div></div>' :
        S.assignments.map(a => `
          <div class="assignment-row">
            <span class="assignment-date">${a.scheduledDate || '—'}</span>
            <span class="assignment-name">${a.workoutTitle || 'Entrenamiento'}</span>
            <span class="assignment-client text-muted">${a.clientName || '—'}</span>
            <span class="badge ${a.status==='done'?'badge-green':a.status==='skipped'?'badge-red':'badge-yellow'}" style="margin-left:auto">
              ${a.status==='done'?'Completado':a.status==='skipped'?'Omitido':'Pendiente'}
            </span>
          </div>`).join('')}
    </div>`;
}

/* ══════════════════════════════════════════
   AI CHAT
══════════════════════════════════════════ */
function loadAI() {
  const wrap = document.getElementById('view-ai');
  wrap.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Asistente IA</h1><p class="page-subtitle">Pregunta sobre programación, cargas o planificación</p></div>
    </div>
    <div class="ai-layout">
      <div class="ai-messages" id="ai-messages">
        <div class="msg msg-ai">
          <div class="msg-bubble">Hola. Soy tu asistente de entrenamiento. Puedo ayudarte a diseñar programas, calcular cargas, planificar mesociclos, resolver dudas sobre fuerza, running o ciclismo. ¿En qué trabajamos?</div>
        </div>
      </div>
      <div class="ai-input-row">
        <textarea id="ai-input" placeholder="Escribe tu pregunta..." rows="1"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendAI()}"></textarea>
        <button class="btn btn-primary" onclick="sendAI()">Enviar</button>
      </div>
    </div>`;
  // Restore history
  if (S.aiMessages.length > 1) rerenderAIHistory();
}

function rerenderAIHistory() {
  const container = document.getElementById('ai-messages');
  container.innerHTML = '';
  S.aiMessages.forEach(m => appendAIMessage(m.role === 'user' ? m.content : m.content, m.role === 'user'));
}

function appendAIMessage(text, isUser) {
  const container = document.getElementById('ai-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = `msg ${isUser ? 'msg-user' : 'msg-ai'}`;
  div.innerHTML = `<div class="msg-bubble">${text.replace(/\n/g,'<br>')}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function sendAI() {
  const input = document.getElementById('ai-input');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';

  if (!S.aiMessages.length) {
    S.aiMessages.push({ role: 'system', content: `Eres el asistente de entrenamiento personal de ByronFit. Ayudas al entrenador ${S.userData?.name || ''} a diseñar programas de entrenamiento, planificar cargas, estructurar mesociclos y responder cualquier duda sobre fuerza, running, ciclismo y preparación física en general. Responde de forma directa y profesional. Sé específico y da recomendaciones concretas.` });
  }
  S.aiMessages.push({ role: 'user', content: text });
  appendAIMessage(text, true);

  // Typing indicator
  const container = document.getElementById('ai-messages');
  const typingEl  = document.createElement('div');
  typingEl.className = 'msg msg-ai';
  typingEl.innerHTML = '<div class="ai-typing"><span></span><span></span><span></span></div>';
  container.appendChild(typingEl);
  container.scrollTop = container.scrollHeight;

  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        system: S.aiMessages[0].content,
        messages: S.aiMessages.slice(1),
      }),
    });
    const data = await res.json();
    typingEl.remove();
    if (data.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    const reply = data.content?.[0]?.text || 'Sin respuesta';
    S.aiMessages.push({ role: 'assistant', content: reply });
    appendAIMessage(reply, false);
  } catch(err) {
    typingEl.remove();
    const errMsg = err.message.includes('fetch') ? 'No se puede conectar. ¿Está server.js en marcha?' : err.message;
    appendAIMessage('Error: ' + errMsg, false);
    S.aiMessages.pop();
  }
}
