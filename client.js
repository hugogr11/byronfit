'use strict';

/* ── Init Firebase ───────────────────────────────────── */
firebase.initializeApp(FIREBASE_CONFIG);
const db   = firebase.firestore();
const auth = firebase.auth();

/* ── State ───────────────────────────────────────────── */
const S = {
  user: null, userData: null,
  assignments: [], sessions: [],
  view: 'today',
  aiMessages: [],
  currentWorkout: null,   // workout data for AI context
};

/* ── Helpers ─────────────────────────────────────────── */
function qs(sel, ctx)  { return (ctx || document).querySelector(sel); }
function qsa(sel, ctx) { return [...(ctx || document).querySelectorAll(sel)]; }
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}
function openClientModal(id)  { document.getElementById(id).classList.add('open'); }
function closeClientModal(id) { document.getElementById(id).classList.remove('open'); }
function today() { return new Date().toISOString().slice(0, 10); }
function fmtDate(str) {
  if (!str) return '—';
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('es-ES', { weekday:'short', day:'2-digit', month:'short' });
}
function fmtTs(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' });
}

const KIND_LABEL_RUN = {
  warmup:'Calentamiento', easy:'Suave', tempo:'Tempo',
  interval:'Intervalo', race:'Carrera', cooldown:'Enfriamiento',
};
const KIND_LABEL_CYC = {
  warmup:'Calentamiento', z2:'Z2 — Aeróbico', threshold:'Umbral',
  interval:'Intervalo', sprint:'Sprint', cooldown:'Enfriamiento',
};
const KIND_CSS = {
  warmup:'segment-kind-warmup', easy:'segment-kind-easy', tempo:'segment-kind-tempo',
  interval:'segment-kind-interval', race:'segment-kind-race', cooldown:'segment-kind-cooldown',
  z2:'segment-kind-z2', threshold:'segment-kind-threshold', sprint:'segment-kind-sprint',
};
const SPORT_BADGE = { fuerza:'badge-blue', running:'badge-green', ciclismo:'badge-yellow', hiit:'badge-red', personalizado:'badge-muted' };
const SPORT_LABEL = { fuerza:'Fuerza', running:'Running', ciclismo:'Ciclismo', hiit:'HIIT', personalizado:'Personalizado' };

/* ── Auth ────────────────────────────────────────────── */
auth.onAuthStateChanged(async user => {
  if (!user) { location.href = 'login.html'; return; }
  const snap = await db.collection('users').doc(user.uid).get();
  if (!snap.exists) { await auth.signOut(); location.href = 'login.html'; return; }
  const data = snap.data();
  if (data.role === 'trainer') { location.href = 'trainer.html'; return; }
  if (data.role !== 'client') {
    document.body.innerHTML = `<div class="waiting-screen">
      <h2>Acceso pendiente</h2>
      <p>Tu entrenador aún no ha configurado tu cuenta. Contacta con ByronFit.</p>
      <button class="btn btn-ghost" onclick="firebase.auth().signOut().then(()=>location.href='login.html')">Volver</button>
    </div>`; return;
  }
  S.user = user; S.userData = data;
  const initial = (data.name || '?')[0].toUpperCase();
  document.getElementById('client-user-btn').textContent = initial;
  document.getElementById('menu-user-name').textContent  = data.name || '';
  setupBottomNav();
  navigate('today');
});

/* ── Navigation ──────────────────────────────────────── */
function setupBottomNav() {
  qsa('.bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });
}
function navigate(view) {
  S.view = view;
  qsa('.bottom-nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  ({ today: loadToday, plan: loadPlan, history: loadHistory, ai: loadAI })[view]?.();
}

function toggleUserMenu() {
  const m = document.getElementById('user-menu');
  m.style.display = m.style.display === 'block' ? 'none' : 'block';
}
document.addEventListener('click', e => {
  if (!e.target.closest('#client-user-btn') && !e.target.closest('#user-menu')) {
    const m = document.getElementById('user-menu');
    if (m) m.style.display = 'none';
  }
});
function clientLogout() { auth.signOut(); location.href = 'login.html'; }

/* ══════════════════════════════════════════
   TODAY
══════════════════════════════════════════ */
async function loadToday() {
  const content = document.getElementById('client-content');
  content.innerHTML = '<div style="color:var(--muted);font-size:.88rem;padding:.5rem 0">Cargando...</div>';

  const t = today();
  const snap = await db.collection('assignments')
    .where('clientId', '==', S.user.uid)
    .where('scheduledDate', '==', t)
    .where('status', '==', 'pending')
    .get();

  if (snap.empty) {
    content.innerHTML = `
      <div style="padding:2rem 0;text-align:center">
        <div style="font-size:1.1rem;font-weight:600;margin-bottom:.4rem">Sin entrenamiento hoy</div>
        <div style="font-size:.88rem;color:var(--muted)">Revisa tu plan para los próximos días.</div>
        <button class="btn btn-ghost btn-sm" style="margin-top:1.25rem" onclick="navigate('plan')">Ver plan</button>
      </div>`;
    return;
  }

  const assignment = { id: snap.docs[0].id, ...snap.docs[0].data() };
  const workoutSnap = await db.collection('workouts').doc(assignment.workoutId).get();
  if (!workoutSnap.exists) {
    content.innerHTML = '<div style="color:var(--red)">Error: entrenamiento no encontrado.</div>';
    return;
  }
  const workout = { id: workoutSnap.id, ...workoutSnap.data() };
  S.currentWorkout = workout;

  content.innerHTML = `
    <div class="workout-display-header">
      <div class="workout-display-title">${workout.title}</div>
      <div class="workout-display-meta">
        <span class="badge ${SPORT_BADGE[workout.sport] || 'badge-muted'}">${SPORT_LABEL[workout.sport] || workout.sport}</span>
        <span class="badge badge-muted">${fmtDate(assignment.scheduledDate)}</span>
      </div>
      ${workout.description ? `<p style="margin-top:.75rem">${workout.description}</p>` : ''}
      ${assignment.notes ? `<div style="margin-top:.75rem;padding:.65rem .9rem;background:var(--raised);border-radius:var(--r);font-size:.85rem;color:var(--muted2);border-left:3px solid var(--accent)">Nota del entrenador: ${assignment.notes}</div>` : ''}
    </div>
    ${renderWorkoutForClient(workout.blocks || [])}
    <div class="complete-section">
      <button class="complete-btn" onclick="openCompleteModal('${assignment.id}','${workout.id}')">
        Marcar como completado
      </button>
    </div>`;
}

/* ══════════════════════════════════════════
   WORKOUT DISPLAY (client-facing)
══════════════════════════════════════════ */
function renderWorkoutForClient(blocks) {
  return blocks.map(b => {
    if (b.type === 'strength') return renderStrengthBlock(b);
    if (b.type === 'running')  return renderRunningBlock(b);
    if (b.type === 'cycling')  return renderCyclingBlock(b);
    if (b.type === 'hiit')     return renderHiitBlock(b);
    if (b.type === 'notes')    return `<div class="notes-display">${b.content}</div>`;
    return '';
  }).join('');
}

function renderStrengthBlock(b) {
  return `<div class="block-display">
    <div class="block-display-label">Ejercicios</div>
    ${(b.exercises || []).map(ex => `
      <div class="exercise-display-row">
        <div class="exercise-display-name">${ex.name}</div>
        <div class="exercise-display-detail">
          ${ex.sets} series &times; ${ex.reps} reps${ex.weight ? ' &mdash; ' + ex.weight + ' kg' : ''}${ex.rest ? ' &mdash; ' + ex.rest + 's descanso' : ''}
        </div>
        ${ex.notes ? `<div class="exercise-display-notes">${ex.notes}</div>` : ''}
      </div>`).join('')}
  </div>`;
}

function renderRunningBlock(b) {
  return `<div class="block-display">
    <div class="block-display-label">Running</div>
    <div class="segment-display">
      ${(b.segments || []).map(s => {
        const kindCss = KIND_CSS[s.kind] || 'segment-kind-warmup';
        const label   = KIND_LABEL_RUN[s.kind] || s.kind;
        const details = [
          s.duration ? s.duration + ' min' : '',
          s.distance ? s.distance + ' km'  : '',
          s.pace     ? '@ ' + s.pace       : '',
          s.effort   ? s.effort            : '',
        ].filter(Boolean).join(' · ');
        return `<div class="segment-display-item ${kindCss}">
          <div class="segment-kind-label">${label}</div>
          <div class="segment-display-detail">${details || '—'}</div>
          ${s.description ? `<div class="segment-display-desc">${s.description}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderCyclingBlock(b) {
  return `<div class="block-display">
    <div class="block-display-label">Ciclismo</div>
    <div class="segment-display">
      ${(b.segments || []).map(s => {
        const kindCss = KIND_CSS[s.kind] || 'segment-kind-warmup';
        const label   = KIND_LABEL_CYC[s.kind] || s.kind;
        const details = [
          s.duration ? s.duration + ' min' : '',
          s.watts    ? s.watts + ' W'      : '',
          s.ftp_pct  ? s.ftp_pct + '% FTP' : '',
          s.cadence  ? s.cadence + ' rpm'  : '',
        ].filter(Boolean).join(' · ');
        return `<div class="segment-display-item ${kindCss}">
          <div class="segment-kind-label">${label}</div>
          <div class="segment-display-detail">${details || '—'}</div>
          ${s.description ? `<div class="segment-display-desc">${s.description}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderHiitBlock(b) {
  return `<div class="block-display">
    <div class="block-display-label">HIIT</div>
    <div class="hiit-display">
      <div class="hiit-display-config">
        <div><strong>${b.rounds}</strong>rondas</div>
        <div><strong>${b.work_seconds}s</strong>trabajo</div>
        <div><strong>${b.rest_seconds}s</strong>descanso</div>
      </div>
      <ul class="hiit-display-exercises">
        ${(b.exercises || []).map(e => `<li>${e}</li>`).join('')}
      </ul>
    </div>
  </div>`;
}

/* ══════════════════════════════════════════
   PLAN
══════════════════════════════════════════ */
async function loadPlan() {
  const content = document.getElementById('client-content');
  content.innerHTML = '<div style="color:var(--muted);font-size:.88rem;padding:.5rem 0">Cargando...</div>';

  const snap = await db.collection('assignments')
    .where('clientId', '==', S.user.uid)
    .where('scheduledDate', '>=', today())
    .orderBy('scheduledDate', 'asc')
    .limit(30)
    .get();

  const assignments = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (!assignments.length) {
    content.innerHTML = `
      <h2 style="margin-bottom:1rem">Mi plan</h2>
      <div class="empty-state">
        <div class="empty-title">Sin entrenamientos próximos</div>
        <div class="empty-sub">Tu entrenador todavía no ha asignado sesiones futuras.</div>
      </div>`;
    return;
  }

  content.innerHTML = `
    <h2 style="margin-bottom:1rem">Mi plan</h2>
    <div class="plan-list">
      ${assignments.map(a => {
        const isToday = a.scheduledDate === today();
        return `<div class="plan-item" onclick="openPlanDetail('${a.workoutId}','${a.id}','${a.scheduledDate}')">
          <div class="plan-item-date">${isToday ? 'Hoy' : fmtDate(a.scheduledDate)}</div>
          <div class="plan-item-name">${a.workoutTitle || 'Entrenamiento'}</div>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap">
            <span class="badge ${SPORT_BADGE[a.workoutSport] || 'badge-muted'}">${SPORT_LABEL[a.workoutSport] || '—'}</span>
            <span class="badge ${a.status==='done'?'badge-green':a.status==='skipped'?'badge-red':'badge-yellow'}">
              ${a.status==='done'?'Completado':a.status==='skipped'?'Omitido':'Pendiente'}
            </span>
            ${isToday ? '<span class="badge badge-blue">Hoy</span>' : ''}
          </div>
          ${a.notes ? `<div style="margin-top:.4rem;font-size:.78rem;color:var(--muted2)">${a.notes}</div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
}

async function openPlanDetail(workoutId, assignmentId, scheduledDate) {
  // Navigate to today view if it's today, else show a mini modal
  if (scheduledDate === today()) { navigate('today'); return; }

  const workoutSnap = await db.collection('workouts').doc(workoutId).get();
  if (!workoutSnap.exists) return;
  const workout = { id: workoutSnap.id, ...workoutSnap.data() };

  // Show inline expanded view
  const item = document.querySelector(`.plan-item[onclick*="${assignmentId}"]`);
  const existing = item?.nextElementSibling;
  if (existing?.classList.contains('plan-detail-expand')) { existing.remove(); return; }

  const detail = document.createElement('div');
  detail.className = 'plan-detail-expand';
  detail.style.cssText = 'background:var(--surface);border:1px solid var(--border2);border-radius:var(--r-lg);padding:1rem;margin-top:.4rem';
  detail.innerHTML = renderWorkoutForClient(workout.blocks || []);
  item?.after(detail);
}

/* ══════════════════════════════════════════
   HISTORY
══════════════════════════════════════════ */
async function loadHistory() {
  const content = document.getElementById('client-content');
  content.innerHTML = '<div style="color:var(--muted);font-size:.88rem;padding:.5rem 0">Cargando...</div>';

  const snap = await db.collection('sessions')
    .where('clientId', '==', S.user.uid)
    .orderBy('completedAt', 'desc')
    .limit(30)
    .get();

  S.sessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (!S.sessions.length) {
    content.innerHTML = `
      <h2 style="margin-bottom:1rem">Historial</h2>
      <div class="empty-state">
        <div class="empty-title">Sin sesiones completadas</div>
        <div class="empty-sub">Cuando completes un entrenamiento aparecerá aquí.</div>
      </div>`;
    return;
  }

  content.innerHTML = `
    <h2 style="margin-bottom:1rem">Historial</h2>
    <div class="history-list">
      ${S.sessions.map(s => `
        <div class="history-item">
          <div class="history-item-date">${fmtTs(s.completedAt)}</div>
          <div>
            <div class="history-item-name">${s.workoutTitle || 'Entrenamiento'}</div>
            <div class="history-item-meta">${s.duration ? s.duration + ' min' : '—'}${s.notes ? ' · ' + s.notes.slice(0, 40) : ''}</div>
          </div>
          <div class="history-item-rpe">RPE ${s.rpe || '—'}</div>
        </div>`).join('')}
    </div>`;
}

/* ══════════════════════════════════════════
   COMPLETE SESSION
══════════════════════════════════════════ */
function openCompleteModal(assignmentId, workoutId) {
  document.getElementById('complete-assignment-id').value = assignmentId;
  document.getElementById('complete-workout-id').value    = workoutId;
  document.getElementById('session-rpe').value = 7;
  document.getElementById('rpe-label').textContent = '7';
  document.getElementById('session-notes').value = '';
  openClientModal('modal-complete');
}

async function submitSession(e) {
  e.preventDefault();
  const assignmentId = document.getElementById('complete-assignment-id').value;
  const workoutId    = document.getElementById('complete-workout-id').value;
  const duration     = Number(document.getElementById('session-duration').value) || 60;
  const rpe          = Number(document.getElementById('session-rpe').value);
  const notes        = document.getElementById('session-notes').value.trim();
  const workout      = S.currentWorkout || {};
  try {
    await db.collection('sessions').add({
      clientId: S.user.uid, assignmentId, workoutId,
      workoutTitle: workout.title || '',
      workoutSport: workout.sport || '',
      duration, rpe, notes,
      completedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await db.collection('assignments').doc(assignmentId).update({ status: 'done' });
    closeClientModal('modal-complete');
    toast('Sesion completada. ¡Buen trabajo!');
    navigate('today');
  } catch(err) { toast('Error: ' + err.message); }
}

/* ══════════════════════════════════════════
   AI CHAT
══════════════════════════════════════════ */
function loadAI() {
  const content = document.getElementById('client-content');
  content.innerHTML = `
    <div class="ai-layout" style="height:calc(100dvh - 10rem)">
      <div class="ai-messages" id="ai-messages">
        <div class="msg msg-ai">
          <div class="msg-bubble">Hola. Soy tu asistente de ByronFit. Puedo resolver dudas sobre tu entrenamiento: técnica, nutrición, recuperación, o lo que necesites. ¿En qué te ayudo?</div>
        </div>
      </div>
      <div class="ai-input-row">
        <textarea id="ai-input" placeholder="Escribe tu pregunta..." rows="1"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendAI()}"></textarea>
        <button class="btn btn-primary" onclick="sendAI()">Enviar</button>
      </div>
    </div>`;
  if (S.aiMessages.length > 1) rerenderAIHistory();
}

function rerenderAIHistory() {
  const container = document.getElementById('ai-messages');
  if (!container) return;
  container.innerHTML = '';
  S.aiMessages.slice(1).forEach(m => appendAIMessage(m.content, m.role === 'user'));
}

function appendAIMessage(text, isUser) {
  const container = document.getElementById('ai-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = `msg ${isUser ? 'msg-user' : 'msg-ai'}`;
  div.innerHTML = `<div class="msg-bubble">${text.replace(/\n/g, '<br>')}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function sendAI() {
  const input = document.getElementById('ai-input');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';

  if (!S.aiMessages.length) {
    // Build system prompt with workout context
    let workoutContext = '';
    if (S.currentWorkout) {
      workoutContext = `\n\nEl entrenamiento asignado hoy al cliente es:\nTítulo: ${S.currentWorkout.title}\nDeporte: ${S.currentWorkout.sport}\n`;
      (S.currentWorkout.blocks || []).forEach(b => {
        if (b.type === 'strength') {
          workoutContext += '\nEjercicios de fuerza:\n';
          (b.exercises || []).forEach(ex => {
            workoutContext += `- ${ex.name}: ${ex.sets} series x ${ex.reps} reps${ex.weight ? ' @ ' + ex.weight + 'kg' : ''}${ex.rest ? ', ' + ex.rest + 's descanso' : ''}\n`;
          });
        } else if (b.type === 'running') {
          workoutContext += '\nSegmentos de running:\n';
          (b.segments || []).forEach(s => {
            workoutContext += `- ${KIND_LABEL_RUN[s.kind] || s.kind}: ${[s.duration ? s.duration + 'min' : '', s.distance ? s.distance + 'km' : '', s.pace || '', s.effort || ''].filter(Boolean).join(', ')}\n`;
          });
        } else if (b.type === 'cycling') {
          workoutContext += '\nSegmentos de ciclismo:\n';
          (b.segments || []).forEach(s => {
            workoutContext += `- ${KIND_LABEL_CYC[s.kind] || s.kind}: ${[s.duration ? s.duration + 'min' : '', s.watts ? s.watts + 'W' : '', s.ftp_pct ? s.ftp_pct + '%FTP' : '', s.cadence ? s.cadence + 'rpm' : ''].filter(Boolean).join(', ')}\n`;
          });
        } else if (b.type === 'hiit') {
          workoutContext += `\nHIIT: ${b.rounds} rondas, ${b.work_seconds}s trabajo, ${b.rest_seconds}s descanso. Ejercicios: ${(b.exercises || []).join(', ')}\n`;
        }
      });
    }
    S.aiMessages.push({
      role: 'system',
      content: `Eres el asistente de entrenamiento personal de ByronFit. El cliente se llama ${S.userData?.name || 'Cliente'}.${workoutContext}\n\nResponde sus preguntas sobre el entrenamiento, técnica, recuperación y nutrición de forma clara y motivadora. Sé preciso y directo. Si te preguntan por cambios en el plan, explica el concepto pero recomiéndales consultar con su entrenador antes de modificarlo.`,
    });
  }

  S.aiMessages.push({ role: 'user', content: text });
  appendAIMessage(text, true);

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
    const msg = err.message.includes('fetch') ? 'No se puede conectar al asistente. Contacta con tu entrenador.' : err.message;
    appendAIMessage('Error: ' + msg, false);
    S.aiMessages.pop();
  }
}
