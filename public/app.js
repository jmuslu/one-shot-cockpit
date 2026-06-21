const state = {
  dashboard: null,
  integrations: null,
  activeShotId: null
};

const $ = (selector) => document.querySelector(selector);

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }
  return payload;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function selectedShot() {
  return state.dashboard?.shots.find((shot) => shot.id === state.activeShotId) || state.dashboard?.shots[0] || null;
}

function pill(status) {
  return `<span class="pill ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function renderStats(stats) {
  $('#stats').innerHTML = [
    ['running', stats.running],
    ['intake', stats.intake],
    ['done', stats.done],
    ['queued fun', stats.queuedEntertainment]
  ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('');
}

function renderShotList(shots) {
  $('#shotList').innerHTML = shots.map((shot) => `
    <button class="shot-tab ${shot.id === state.activeShotId ? 'active' : ''}" data-select-shot="${shot.id}">
      <span>${escapeHtml(shot.title)}</span>
      ${pill(shot.status)}
    </button>
  `).join('');
}

function renderMessages(shot) {
  if (!shot) {
    $('#messages').innerHTML = '<div class="empty">No active shot.</div>';
    return;
  }

  const result = shot.status === 'done' ? [{
    role: 'result',
    body: `${shot.result_summary}\nArtifact: ${shot.result_artifact || 'not attached yet'}`
  }] : [];
  const messages = [...shot.messages, ...result];

  $('#messages').innerHTML = messages.map((message) => `
    <article class="message ${escapeHtml(message.role)}">
      <strong>${escapeHtml(message.role)}</strong>
      <p>${escapeHtml(message.body)}</p>
    </article>
  `).join('');
}

function renderQuestions(shot) {
  const unanswered = shot?.questions.filter((question) => !question.answer) || [];
  const answered = shot?.questions.filter((question) => question.answer) || [];

  if (!shot || shot.status === 'done') {
    $('#questionBox').innerHTML = '';
    return;
  }

  $('#questionBox').innerHTML = [
    ...unanswered.map((question) => `
      <form class="inline-question" data-question-form="${question.id}">
        <label>
          ${escapeHtml(question.question)}
          <input name="answer" placeholder="Short answer">
        </label>
        <button type="submit">Save</button>
      </form>
    `),
    ...answered.map((question) => `
      <div class="answered">
        <strong>${escapeHtml(question.question)}</strong>
        <span>${escapeHtml(question.answer)}</span>
      </div>
    `)
  ].join('');
}

function renderActions(shot) {
  if (!shot) {
    $('#shotActions').innerHTML = '';
    return;
  }
  if (shot.status === 'done') {
    $('#shotActions').innerHTML = `
      <button class="secondary" data-fork-shot="${shot.id}">Start refinement as new shot</button>
      <span class="subtle">Follow-up is intentionally disabled here.</span>
    `;
    return;
  }
  if (shot.status === 'running') {
    $('#shotActions').innerHTML = `
      <button class="primary" data-complete-shot="${shot.id}">Mock complete and ping</button>
      <span class="subtle">Real runner will notify you when done.</span>
    `;
    return;
  }
  $('#shotActions').innerHTML = `
    <button class="primary" data-start-shot="${shot.id}">Start one-shot run</button>
    <span class="subtle">Ask only high-leverage questions, then run.</span>
  `;
}

function renderActiveShot() {
  const shot = selectedShot();
  if (shot && !state.activeShotId) {
    state.activeShotId = shot.id;
  }

  $('#activeTitle').textContent = shot ? shot.title : 'Select a shot';
  $('#activePrompt').textContent = shot ? shot.prompt : 'Create a one-shot project to begin.';
  $('#lockPill').outerHTML = shot ? pill(shot.status) : '<span id="lockPill" class="pill">No shot</span>';
  const livePill = document.querySelector('.hero .pill, .surface .pill');
  if (livePill) {
    livePill.id = 'lockPill';
  }
  renderMessages(shot);
  renderQuestions(shot);
  renderActions(shot);
}

function renderEntertainment(items) {
  $('#entertainmentList').innerHTML = items.map((item) => `
    <article class="fun-card">
      <div class="fun-kind">${escapeHtml(item.kind)}</div>
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.reason || 'Queued for while a shot runs.')}</p>
      <div class="subtle">${escapeHtml(item.source)}${item.linked_shot_title ? ` / ${escapeHtml(item.linked_shot_title)}` : ''}</div>
      ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open</a>` : ''}
    </article>
  `).join('');
}

function renderMemory(items) {
  $('#memoryGrid').innerHTML = items.map((item) => `
    <article class="memory">
      <strong>${escapeHtml(item.label)}</strong>
      <p>${escapeHtml(item.detail)}</p>
      <span class="pill">${escapeHtml(item.memory_type)}</span>
    </article>
  `).join('');
}

function render() {
  renderStats(state.dashboard.stats);
  renderShotList(state.dashboard.shots);
  renderActiveShot();
  renderEntertainment(state.dashboard.entertainment);
  renderMemory(state.dashboard.memory);
}

async function load() {
  const [dashboard, integrations] = await Promise.all([
    request('/api/dashboard'),
    request('/api/integrations')
  ]);
  state.dashboard = dashboard;
  state.integrations = integrations;
  if (!state.activeShotId && dashboard.shots[0]) {
    state.activeShotId = dashboard.shots[0].id;
  }
  render();
}

$('#shotForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  state.dashboard = await request('/api/shots', {
    method: 'POST',
    body: JSON.stringify(formData(event.currentTarget))
  });
  state.activeShotId = state.dashboard.shots[0]?.id || null;
  event.currentTarget.reset();
  render();
});

$('#newShotButton').addEventListener('click', () => {
  $('#shotForm input[name="title"]').focus();
});

$('#addGameButton').addEventListener('click', async () => {
  state.dashboard = await request('/api/entertainment', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'game',
      title: 'Random io game slot',
      source: 'manual roulette',
      reason: 'Placeholder for a web-game picker integration.'
    })
  });
  render();
});

document.body.addEventListener('click', async (event) => {
  const selectShot = event.target.closest('[data-select-shot]')?.dataset.selectShot;
  if (selectShot) {
    state.activeShotId = Number(selectShot);
    render();
    return;
  }

  const startShot = event.target.dataset.startShot;
  if (startShot) {
    state.dashboard = await request(`/api/shots/${startShot}/start`, { method: 'POST' });
    render();
    return;
  }

  const completeShot = event.target.dataset.completeShot;
  if (completeShot) {
    state.dashboard = await request(`/api/shots/${completeShot}/complete`, { method: 'POST' });
    render();
    return;
  }

  const forkShot = event.target.dataset.forkShot;
  if (forkShot) {
    const shot = state.dashboard.shots.find((item) => item.id === Number(forkShot));
    $('#shotForm input[name="title"]').value = `${shot.title} refinement`;
    $('#shotForm textarea[name="prompt"]').value = `Refine the completed shot externally:\n\n${shot.prompt}\n\nChange request: `;
    $('#shotForm textarea[name="prompt"]').focus();
  }
});

document.body.addEventListener('submit', async (event) => {
  const questionId = event.target.dataset.questionForm;
  if (!questionId) {
    return;
  }
  event.preventDefault();
  const shot = selectedShot();
  state.dashboard = await request(`/api/shots/${shot.id}/questions/${questionId}`, {
    method: 'PATCH',
    body: JSON.stringify(formData(event.target))
  });
  render();
});

load().catch((error) => {
  document.body.innerHTML = `<main class="workspace"><div class="empty">${escapeHtml(error.message)}</div></main>`;
});
