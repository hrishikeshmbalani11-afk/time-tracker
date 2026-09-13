/* ═══════════════════════════════════════════════════════
   TimeFlow — Application Logic
   Timer · To-Do · Analytics · Firebase / localStorage
   ═══════════════════════════════════════════════════════ */

;(function () {
  'use strict';

  // ─── Constants ───
  const STORAGE_KEYS = { logs: 'tf_logs', todos: 'tf_todos', firebase: 'tf_firebase_config' };
  const TOPIC_COLORS = [
    '#6c63ff','#00c897','#ff6b6b','#ffc107','#17a2b8',
    '#e056a0','#ff8c42','#4ecdc4','#a29bfe','#fd79a8',
    '#00b894','#e17055','#74b9ff','#fab1a0','#81ecec',
  ];

  // ─── State ───
  let state = {
    logs: [],
    todos: [],
    activeTimer: null,       // { topic, startedAt, pausedElapsed, paused }
    timerInterval: null,
  };

  let firebaseDB = null;
  let unsubLogs = null;
  let unsubTodos = null;

  // ────────────────────────────────────────────────────
  // STORAGE — localStorage with Firebase overlay
  // ────────────────────────────────────────────────────

  function loadLocal() {
    try {
      state.logs = JSON.parse(localStorage.getItem(STORAGE_KEYS.logs)) || [];
      state.todos = JSON.parse(localStorage.getItem(STORAGE_KEYS.todos)) || [];
    } catch { state.logs = []; state.todos = []; }
  }

  function saveLocal() {
    localStorage.setItem(STORAGE_KEYS.logs, JSON.stringify(state.logs));
    localStorage.setItem(STORAGE_KEYS.todos, JSON.stringify(state.todos));
  }

  // ────────────────────────────────────────────────────
  // FIREBASE — optional real-time sync
  // ────────────────────────────────────────────────────

  async function initFirebase(config) {
    try {
      // Dynamically load Firebase SDK
      if (!window.firebase) {
        await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
        await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js');
        await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js');
      }

      // Guard against re-initialization
      if (unsubLogs) { unsubLogs(); unsubLogs = null; }
      if (unsubTodos) { unsubTodos(); unsubTodos = null; }

      const app = firebase.apps.length
        ? firebase.app()
        : firebase.initializeApp(config);

      // Sign in with Google (popup)
      const auth = firebase.auth();
      if (!auth.currentUser) {
        const provider = new firebase.auth.GoogleAuthProvider();
        await auth.signInWithPopup(provider);
      }

      firebaseDB = firebase.firestore();

      // Enable offline persistence
      try { await firebaseDB.enablePersistence({ synchronizeTabs: true }); } catch {}

      // Listen to logs collection
      unsubLogs = firebaseDB.collection('logs').orderBy('date', 'desc').onSnapshot(snap => {
        state.logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        saveLocal();
        renderLogs();
        renderAnalytics();
        updateTopicSuggestions();
      });

      // Listen to todos collection
      unsubTodos = firebaseDB.collection('todos').orderBy('createdAt', 'desc').onSnapshot(snap => {
        state.todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        saveLocal();
        renderTodos();
      });

      setSyncStatus(true);
      localStorage.setItem(STORAGE_KEYS.firebase, JSON.stringify(config));
      return true;
    } catch (err) {
      console.error('Firebase init failed:', err);
      setSyncStatus(false);
      return false;
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Firestore helpers
  async function updateDoc(collection, id, data) {
    if (firebaseDB) {
      await firebaseDB.collection(collection).doc(id).update(data);
    }
  }

  async function deleteDoc(collection, id) {
    if (firebaseDB) {
      await firebaseDB.collection(collection).doc(id).delete();
    }
  }

  function setSyncStatus(online) {
    const dot = document.querySelector('.sync-dot');
    dot.classList.toggle('online', online);
    dot.classList.toggle('offline', !online);
  }

  // ────────────────────────────────────────────────────
  // HELPERS
  // ────────────────────────────────────────────────────

  function uid() { return crypto.randomUUID(); }

  function formatDuration(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  function formatDurationShort(ms) {
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function topicColor(topic) {
    let hash = 0;
    for (let i = 0; i < topic.length; i++) hash = topic.charCodeAt(i) + ((hash << 5) - hash);
    return TOPIC_COLORS[Math.abs(hash) % TOPIC_COLORS.length];
  }

  function todayStr() { return new Date().toISOString().slice(0, 10); }

  function toast(msg) {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // ────────────────────────────────────────────────────
  // TAB NAVIGATION
  // ────────────────────────────────────────────────────

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`section-${tab.dataset.tab}`).classList.add('active');
      if (tab.dataset.tab === 'analytics') renderAnalytics();
    });
  });

  // ────────────────────────────────────────────────────
  // TIMER
  // ────────────────────────────────────────────────────

  const $timerCard    = document.getElementById('active-timer-card');
  const $timerDisplay = document.getElementById('timer-display');
  const $timerLabel   = document.getElementById('timer-topic-label');
  const $timerInput   = document.getElementById('timer-topic');
  const $btnStart     = document.getElementById('btn-start');
  const $btnPause     = document.getElementById('btn-pause');
  const $btnStop      = document.getElementById('btn-stop');

  function startTimer(topic) {
    if (!topic.trim()) { toast('Please enter a topic'); return; }
    if (state.activeTimer) { toast('A timer is already running'); return; }

    state.activeTimer = {
      topic: topic.trim(),
      startedAt: Date.now(),
      pausedElapsed: 0,
      paused: false,
    };

    $timerLabel.textContent = state.activeTimer.topic;
    $timerCard.classList.remove('hidden');
    $timerInput.value = '';
    $btnPause.textContent = 'Pause';

    state.timerInterval = setInterval(updateTimerDisplay, 500);
    updateTimerDisplay();
  }

  function updateTimerDisplay() {
    if (!state.activeTimer) return;
    const t = state.activeTimer;
    let elapsed = t.pausedElapsed;
    if (!t.paused) elapsed += Date.now() - t.startedAt;
    $timerDisplay.textContent = formatDuration(elapsed);
  }

  $btnStart.addEventListener('click', () => startTimer($timerInput.value));
  $timerInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') startTimer($timerInput.value);
  });

  $btnPause.addEventListener('click', () => {
    const t = state.activeTimer;
    if (!t) return;
    if (t.paused) {
      t.startedAt = Date.now();
      t.paused = false;
      $btnPause.textContent = 'Pause';
    } else {
      t.pausedElapsed += Date.now() - t.startedAt;
      t.paused = true;
      $btnPause.textContent = 'Resume';
    }
  });

  $btnStop.addEventListener('click', async () => {
    const t = state.activeTimer;
    if (!t) return;

    let elapsed = t.pausedElapsed;
    if (!t.paused) elapsed += Date.now() - t.startedAt;

    if (elapsed < 1000) { toast('Too short to log'); return; }

    const entry = {
      id: uid(),
      topic: t.topic,
      date: todayStr(),
      startTime: new Date(Date.now() - elapsed).toTimeString().slice(0,5),
      endTime: new Date().toTimeString().slice(0,5),
      duration: elapsed,
      createdAt: Date.now(),
    };

    state.logs.unshift(entry);
    saveLocal();

    if (firebaseDB) {
      const { id, ...data } = entry;
      try {
        const ref = await firebaseDB.collection('logs').doc(id).set(data);
      } catch (err) { console.error(err); }
    }

    clearInterval(state.timerInterval);
    state.activeTimer = null;
    $timerCard.classList.add('hidden');
    $timerDisplay.textContent = '00:00:00';

    renderLogs();
    updateTopicSuggestions();
    toast(`Logged ${formatDurationShort(elapsed)} on "${entry.topic}"`);
  });

  // ─── Manual Log ───
  const $manualTopic = document.getElementById('manual-topic');
  const $manualDate  = document.getElementById('manual-date');
  const $manualStart = document.getElementById('manual-start');
  const $manualEnd   = document.getElementById('manual-end');

  // Default date to today
  $manualDate.value = todayStr();

  document.getElementById('btn-manual-log').addEventListener('click', async () => {
    const topic = $manualTopic.value.trim();
    const date  = $manualDate.value;
    const start = $manualStart.value;
    const end   = $manualEnd.value;

    if (!topic || !date || !start || !end) {
      toast('Please fill in all fields'); return;
    }

    const startMs = new Date(`${date}T${start}`).getTime();
    const endMs   = new Date(`${date}T${end}`).getTime();
    const duration = endMs - startMs;

    if (duration <= 0) { toast('End time must be after start time'); return; }

    const entry = {
      id: uid(),
      topic,
      date,
      startTime: start,
      endTime: end,
      duration,
      createdAt: Date.now(),
    };

    state.logs.unshift(entry);
    saveLocal();

    if (firebaseDB) {
      const { id, ...data } = entry;
      try { await firebaseDB.collection('logs').doc(id).set(data); } catch {}
    }

    $manualTopic.value = '';
    $manualStart.value = '';
    $manualEnd.value = '';
    renderLogs();
    updateTopicSuggestions();
    toast(`Logged ${formatDurationShort(duration)} on "${topic}"`);
  });

  // ─── Render Logs ───
  function renderLogs() {
    const $list = document.getElementById('recent-logs');
    const sorted = [...state.logs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 30);

    if (sorted.length === 0) {
      $list.innerHTML = '<p class="empty-state">No time entries yet.</p>';
      return;
    }

    $list.innerHTML = sorted.map(log => `
      <div class="log-entry" data-id="${log.id}">
        <div class="log-color" style="background:${topicColor(log.topic)}"></div>
        <div class="log-info">
          <div class="log-topic">${esc(log.topic)}</div>
          <div class="log-meta">${log.date} · ${log.startTime} – ${log.endTime}</div>
        </div>
        <div class="log-duration">${formatDurationShort(log.duration)}</div>
        <button class="btn-delete-log" data-id="${log.id}" title="Delete">✕</button>
      </div>
    `).join('');

    $list.querySelectorAll('.btn-delete-log').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        state.logs = state.logs.filter(l => l.id !== id);
        saveLocal();
        if (firebaseDB) { try { await firebaseDB.collection('logs').doc(id).delete(); } catch {} }
        renderLogs();
        toast('Entry deleted');
      });
    });
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function updateTopicSuggestions() {
    const topics = [...new Set(state.logs.map(l => l.topic))];
    const $dl = document.getElementById('topic-suggestions');
    $dl.innerHTML = topics.map(t => `<option value="${esc(t)}">`).join('');
  }

  // ────────────────────────────────────────────────────
  // TO-DO LIST
  // ────────────────────────────────────────────────────

  const $todoInput  = document.getElementById('todo-input');
  const $todoList   = document.getElementById('todo-list');
  let todoFilter = 'all';
  let editingTodoId = null;

  document.getElementById('btn-add-todo').addEventListener('click', () => addTodo());
  $todoInput.addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });

  async function addTodo() {
    const text = $todoInput.value.trim();
    if (!text) { toast('Please enter a task'); return; }

    const todo = { id: uid(), text, done: false, createdAt: Date.now() };
    state.todos.unshift(todo);
    saveLocal();

    if (firebaseDB) {
      const { id, ...data } = todo;
      try { await firebaseDB.collection('todos').doc(todo.id).set(data); } catch {}
    }

    $todoInput.value = '';
    renderTodos();
  }

  function renderTodos() {
    let items = [...state.todos];
    if (todoFilter === 'active') items = items.filter(t => !t.done);
    if (todoFilter === 'done') items = items.filter(t => t.done);

    if (items.length === 0) {
      const msg = todoFilter === 'all' ? 'No tasks yet. Add one above!' :
                  todoFilter === 'active' ? 'No active tasks.' : 'No completed tasks.';
      $todoList.innerHTML = `<li class="empty-state">${msg}</li>`;
      return;
    }

    $todoList.innerHTML = items.map(t => `
      <li class="todo-item ${t.done ? 'done' : ''}" data-id="${t.id}">
        <button class="todo-check" data-action="toggle" data-id="${t.id}">${t.done ? '✓' : ''}</button>
        <span class="todo-text">${esc(t.text)}</span>
        <div class="todo-actions">
          <button class="btn btn-sm btn-primary" data-action="track" data-id="${t.id}" title="Start timer">▶</button>
          <button class="btn btn-sm btn-ghost" data-action="edit" data-id="${t.id}" title="Edit">✎</button>
          <button class="btn btn-sm btn-ghost" data-action="delete" data-id="${t.id}" title="Delete" style="color:var(--danger)">✕</button>
        </div>
      </li>
    `).join('');

    // Event delegation
    $todoList.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleTodoAction(btn.dataset.action, btn.dataset.id));
    });
  }

  async function handleTodoAction(action, id) {
    const todo = state.todos.find(t => t.id === id);
    if (!todo) return;

    switch (action) {
      case 'toggle':
        todo.done = !todo.done;
        saveLocal();
        if (firebaseDB) { try { await updateDoc('todos', id, { done: todo.done }); } catch {} }
        renderTodos();
        break;

      case 'track':
        // Switch to timer tab and start
        document.querySelector('[data-tab="timer"]').click();
        startTimer(todo.text);
        break;

      case 'edit':
        editingTodoId = id;
        document.getElementById('edit-todo-text').value = todo.text;
        document.getElementById('modal-edit-todo').classList.remove('hidden');
        document.getElementById('edit-todo-text').focus();
        break;

      case 'delete':
        state.todos = state.todos.filter(t => t.id !== id);
        saveLocal();
        if (firebaseDB) { try { await deleteDoc('todos', id); } catch {} }
        renderTodos();
        toast('Task deleted');
        break;
    }
  }

  // Edit modal
  document.getElementById('btn-save-edit').addEventListener('click', async () => {
    const text = document.getElementById('edit-todo-text').value.trim();
    if (!text || !editingTodoId) return;

    const todo = state.todos.find(t => t.id === editingTodoId);
    if (todo) {
      todo.text = text;
      saveLocal();
      if (firebaseDB) { try { await updateDoc('todos', editingTodoId, { text }); } catch {} }
      renderTodos();
    }
    document.getElementById('modal-edit-todo').classList.add('hidden');
    editingTodoId = null;
  });

  document.getElementById('modal-edit-close').addEventListener('click', () => {
    document.getElementById('modal-edit-todo').classList.add('hidden');
  });

  // Todo filter tabs
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      todoFilter = btn.dataset.filter;
      renderTodos();
    });
  });

  // ────────────────────────────────────────────────────
  // ANALYTICS
  // ────────────────────────────────────────────────────

  let activePeriod = 'today';
  let chartBar = null, chartDoughnut = null, chartLine = null;

  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activePeriod = btn.dataset.period;
      renderAnalytics();
    });
  });

  function getFilteredLogs() {
    const now = new Date();
    const today = todayStr();

    return state.logs.filter(log => {
      const d = new Date(log.date);
      switch (activePeriod) {
        case 'today':
          return log.date === today;
        case 'week': {
          const weekAgo = new Date(now);
          weekAgo.setDate(weekAgo.getDate() - 7);
          return d >= weekAgo;
        }
        case 'month': {
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }
        case 'year': {
          return d.getFullYear() === now.getFullYear();
        }
        default: return true;
      }
    });
  }

  function renderAnalytics() {
    const logs = getFilteredLogs();

    // Summary
    const totalMs = logs.reduce((s, l) => s + l.duration, 0);
    const topics = [...new Set(logs.map(l => l.topic))];
    document.getElementById('summary-total').textContent = formatDurationShort(totalMs);
    document.getElementById('summary-topics').textContent = topics.length;
    document.getElementById('summary-sessions').textContent = logs.length;

    // Data by topic
    const byTopic = {};
    logs.forEach(l => {
      byTopic[l.topic] = (byTopic[l.topic] || 0) + l.duration;
    });

    const sortedTopics = Object.entries(byTopic).sort((a, b) => b[1] - a[1]);
    const labels = sortedTopics.map(([t]) => t);
    const values = sortedTopics.map(([, v]) => Math.round(v / 60000)); // minutes
    const colors = labels.map(l => topicColor(l));

    // Chart.js global defaults adapting to current theme
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    Chart.defaults.color = isDark ? '#9CA3AF' : '#6B7280';
    Chart.defaults.borderColor = isDark ? '#333333' : '#E5E7EB';
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";

    // Bar chart
    const ctxBar = document.getElementById('chart-bar');
    if (chartBar) chartBar.destroy();
    chartBar = new Chart(ctxBar, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Minutes',
          data: values,
          backgroundColor: colors.map(c => c + 'cc'),
          borderColor: colors,
          borderWidth: 1,
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => formatDurationShort(ctx.raw * 60000)
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: v => `${v}m` },
            grid: { color: isDark ? '#33333388' : '#E5E7EB88' },
          },
          x: {
            ticks: { maxRotation: 45 },
            grid: { display: false },
          }
        }
      }
    });

    // Doughnut chart
    const ctxD = document.getElementById('chart-doughnut');
    if (chartDoughnut) chartDoughnut.destroy();
    chartDoughnut = new Chart(ctxD, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors.map(c => c + 'cc'),
          borderColor: 'transparent',
          borderWidth: 2,
          hoverOffset: 8,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '55%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 16,
              usePointStyle: true,
              pointStyleWidth: 10,
            }
          },
          tooltip: {
            callbacks: {
              label: ctx => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total ? Math.round(ctx.raw / total * 100) : 0;
                return `${ctx.label}: ${formatDurationShort(ctx.raw * 60000)} (${pct}%)`;
              }
            }
          }
        }
      }
    });

    // Line chart — daily trend
    renderLineChart(logs);
  }

  function renderLineChart(logs) {
    // Group by date
    const byDate = {};
    logs.forEach(l => {
      byDate[l.date] = (byDate[l.date] || 0) + l.duration;
    });

    const dates = Object.keys(byDate).sort();
    const lineValues = dates.map(d => Math.round(byDate[d] / 60000));

    const ctxL = document.getElementById('chart-line');
    if (chartLine) chartLine.destroy();
    const isDark = document.body.getAttribute('data-theme') === 'dark';

    chartLine = new Chart(ctxL, {
      type: 'line',
      data: {
        labels: dates.map(d => {
          const dt = new Date(d);
          return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }),
        datasets: [{
          label: 'Minutes',
          data: lineValues,
          borderColor: '#6366F1',
          backgroundColor: isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.25)',
          fill: true,
          tension: .35,
          pointRadius: 4,
          pointBackgroundColor: '#6366F1',
          pointBorderColor: isDark ? '#1E1E1E' : '#FFFFFF',
          pointBorderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: ctx => formatDurationShort(ctx.raw * 60000) }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: v => `${v}m` },
            grid: { color: isDark ? '#33333388' : '#E5E7EB88' },
          },
          x: {
            ticks: { maxRotation: 45 },
            grid: { display: false },
          }
        }
      }
    });
  }

  // ────────────────────────────────────────────────────
  // IMPORT / EXPORT
  // ────────────────────────────────────────────────────

  document.getElementById('btn-import-export').addEventListener('click', () => {
    document.getElementById('modal-sync').classList.remove('hidden');
  });
  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('modal-sync').classList.add('hidden');
  });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });

  // Export
  document.getElementById('btn-export').addEventListener('click', () => {
    const data = { logs: state.logs, todos: state.todos, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timeflow-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Data exported!');
  });

  // Import
  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.logs && !data.todos) {
        toast('Invalid file format'); return;
      }

      // Merge, dedup by id
      if (data.logs) {
        const existingIds = new Set(state.logs.map(l => l.id));
        const newLogs = data.logs.filter(l => !existingIds.has(l.id));
        state.logs = [...state.logs, ...newLogs];
      }
      if (data.todos) {
        const existingIds = new Set(state.todos.map(t => t.id));
        const newTodos = data.todos.filter(t => !existingIds.has(t.id));
        state.todos = [...state.todos, ...newTodos];
      }

      saveLocal();

      // Push to Firebase if connected
      if (firebaseDB) {
        for (const log of state.logs) {
          const { id, ...d } = log;
          try { await firebaseDB.collection('logs').doc(id).set(d, { merge: true }); } catch {}
        }
        for (const todo of state.todos) {
          const { id, ...d } = todo;
          try { await firebaseDB.collection('todos').doc(id).set(d, { merge: true }); } catch {}
        }
      }

      renderLogs();
      renderTodos();
      updateTopicSuggestions();
      toast(`Imported! ${data.logs?.length || 0} logs, ${data.todos?.length || 0} tasks`);
      document.getElementById('modal-sync').classList.add('hidden');
    } catch (err) {
      toast('Failed to import: ' + err.message);
    }
    e.target.value = '';
  });

  // ─── Firebase Connect ───
  document.getElementById('btn-connect-firebase').addEventListener('click', async () => {
    const $status = document.getElementById('firebase-status');
    const raw = document.getElementById('firebase-config').value.trim();
    if (!raw) { $status.textContent = '⚠ Please paste your Firebase config JSON.'; return; }

    try {
      const config = JSON.parse(raw);
      $status.textContent = '⏳ Connecting…';
      $status.style.color = 'var(--warning)';

      const ok = await initFirebase(config);
      if (ok) {
        $status.textContent = '✓ Connected! Real-time sync is active.';
        $status.style.color = 'var(--success)';

        // Push existing local data to Firestore
        for (const log of state.logs) {
          const { id, ...data } = log;
          try { await firebaseDB.collection('logs').doc(id).set(data, { merge: true }); } catch {}
        }
        for (const todo of state.todos) {
          const { id, ...data } = todo;
          try { await firebaseDB.collection('todos').doc(id).set(data, { merge: true }); } catch {}
        }
      } else {
        $status.textContent = '✕ Connection failed. Check your config.';
        $status.style.color = 'var(--danger)';
      }
    } catch {
      $status.textContent = '✕ Invalid JSON. Please check format.';
      $status.style.color = 'var(--danger)';
    }
  });

  // ────────────────────────────────────────────────────
  // SERVICE WORKER
  // ────────────────────────────────────────────────────

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('SW registered:', reg.scope))
        .catch(err => console.log('SW failed:', err));
    });
  }

  // ────────────────────────────────────────────────────
  // THEME TOGGLE
  // ────────────────────────────────────────────────────

  const btnThemeToggle = document.getElementById('theme-toggle');

  function initTheme() {
    const savedTheme = localStorage.getItem('tf_theme');
    if (savedTheme) {
      document.body.setAttribute('data-theme', savedTheme);
      updateThemeIcon(savedTheme);
    } else {
      const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      const theme = prefersLight ? 'light' : 'dark';
      document.body.setAttribute('data-theme', theme);
      updateThemeIcon(theme);
    }
  }

  function updateThemeIcon(theme) {
    if (theme === 'light') {
      btnThemeToggle.textContent = '🌙';
    } else {
      btnThemeToggle.textContent = '☀️';
    }
  }

  btnThemeToggle.addEventListener('click', () => {
    const currentTheme = document.body.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('tf_theme', newTheme);
    updateThemeIcon(newTheme);

    // Redraw charts with new theme colors if we are in analytics tab
    if (document.querySelector('.tab[data-tab="analytics"]').classList.contains('active')) {
      renderAnalytics();
    }
  });

  // ────────────────────────────────────────────────────
  // INIT
  // ────────────────────────────────────────────────────

  function init() {
    initTheme();
    loadLocal();
    renderLogs();
    renderTodos();
    updateTopicSuggestions();

    // Try to reconnect Firebase from stored config
    const savedConfig = localStorage.getItem(STORAGE_KEYS.firebase);
    if (savedConfig) {
      try {
        const config = JSON.parse(savedConfig);
        document.getElementById('firebase-config').value = JSON.stringify(config, null, 2);
        initFirebase(config);
      } catch {}
    }
  }

  init();

})();
