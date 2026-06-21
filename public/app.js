const state = {
  dashboard: null,
  integrations: null,
  activeShotId: null,
  activeEntertainmentId: null,
  sound: true,
  audioContext: null,
  ambient: false,
  ambientTimer: null,
  holdTimer: null,
  heldSound: localStorage.getItem('heldSound') || 'random',
  ambientFrequency: Number(localStorage.getItem('ambientFrequency') || 2),
  casinoSamples: []
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

function selectedEntertainment() {
  return state.dashboard?.entertainment.find((item) => item.id === state.activeEntertainmentId) || state.dashboard?.entertainment[0] || null;
}

function audio() {
  state.audioContext ||= new AudioContext();
  return state.audioContext;
}

const casinoSamplePaths = [
  '/sounds/casino/chips-collide-1.ogg',
  '/sounds/casino/chips-collide-2.ogg',
  '/sounds/casino/chips-collide-3.ogg',
  '/sounds/casino/chips-collide-4.ogg',
  '/sounds/casino/chips-handle-1.ogg',
  '/sounds/casino/chips-handle-2.ogg',
  '/sounds/casino/chips-handle-3.ogg',
  '/sounds/casino/chips-stack-1.ogg'
];

function preloadCasinoSamples() {
  state.casinoSamples = casinoSamplePaths.map((path) => {
    const sample = new Audio(path);
    sample.preload = 'auto';
    sample.volume = 0.8;
    return sample;
  });
}

function playCasinoSample(index, delay = 0, volume = 0.8, rate = 1) {
  if (!state.sound || state.casinoSamples.length === 0) {
    return;
  }
  window.setTimeout(() => {
    const base = state.casinoSamples[index % state.casinoSamples.length];
    const sample = base.cloneNode();
    sample.volume = volume;
    sample.playbackRate = rate;
    void sample.play().catch(() => {});
  }, delay);
}

function tone(frequency, start, duration, gain, type = 'sine') {
  if (!state.sound) {
    return;
  }
  const ctx = audio();
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime + start);
  amp.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  amp.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.03);
}

function noise(start, duration, gain) {
  if (!state.sound) {
    return;
  }
  const ctx = audio();
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const amp = ctx.createGain();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2200, ctx.currentTime + start);
  amp.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  amp.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  source.buffer = buffer;
  source.connect(filter).connect(amp).connect(ctx.destination);
  source.start(ctx.currentTime + start);
  source.stop(ctx.currentTime + start + duration + 0.02);
}

function filteredNoise(start, duration, gain, frequency, type = 'bandpass') {
  if (!state.sound) {
    return;
  }
  const ctx = audio();
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const amp = ctx.createGain();
  filter.type = type;
  filter.frequency.setValueAtTime(frequency, ctx.currentTime + start);
  amp.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  amp.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  source.buffer = buffer;
  source.connect(filter).connect(amp).connect(ctx.destination);
  source.start(ctx.currentTime + start);
  source.stop(ctx.currentTime + start + duration + 0.02);
}

function playSound(name) {
  if (!state.sound) {
    return;
  }
  const ctx = audio();
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }
  if (name === 'complete') {
    tone(523.25, 0, 0.12, 0.08, 'triangle');
    tone(659.25, 0.09, 0.12, 0.08, 'triangle');
    tone(987.77, 0.18, 0.22, 0.09, 'sine');
    return;
  }
  if (name === 'select') {
    tone(440, 0, 0.07, 0.045, 'square');
    tone(660, 0.045, 0.08, 0.035, 'triangle');
    return;
  }
  if (name === 'start') {
    tone(220, 0, 0.1, 0.06, 'sawtooth');
    tone(330, 0.075, 0.12, 0.055, 'triangle');
    return;
  }
  if (name === 'cash') {
    [0, 1, 2, 3, 4, 5, 6, 7].forEach((sample, index) => {
      playCasinoSample(sample, index * 42, 0.82 - index * 0.035, 0.94 + Math.random() * 0.24);
    });
    filteredNoise(0, 0.3, 0.045, 6200, 'highpass');
    tone(1174.66, 0, 0.06, 0.07, 'square');
    tone(1567.98, 0.052, 0.075, 0.08, 'triangle');
    tone(2093, 0.118, 0.08, 0.075, 'sine');
    tone(2637.02, 0.178, 0.1, 0.075, 'triangle');
    tone(3135.96, 0.246, 0.13, 0.07, 'sine');
    tone(4186.01, 0.355, 0.18, 0.055, 'triangle');
    filteredNoise(0.18, 0.32, 0.04, 8200, 'highpass');
    return;
  }
  if (name === 'hype') {
    tone(146.83, 0, 0.18, 0.08, 'sawtooth');
    tone(293.66, 0.02, 0.18, 0.055, 'square');
    noise(0, 0.11, 0.045);
    return;
  }
  if (name === 'ambient') {
    const choice = Math.random();
    if (choice < 0.34) {
      tone(880, 0, 0.06, 0.025, 'sine');
      tone(1174.66, 0.05, 0.08, 0.022, 'triangle');
    } else if (choice < 0.67) {
      noise(0, 0.08, 0.018);
      tone(392, 0.04, 0.08, 0.02, 'triangle');
    } else {
      tone(659.25, 0, 0.05, 0.02, 'square');
    }
    return;
  }
  tone(740, 0, 0.08, 0.05, 'sine');
}

function scheduleAmbient() {
  window.clearTimeout(state.ambientTimer);
  if (!state.ambient || !state.sound) {
    return;
  }
  const ranges = {
    1: [30000, 65000],
    2: [18000, 36000],
    3: [9000, 19000],
    4: [4500, 9500],
    5: [1600, 4200]
  };
  const [min, max] = ranges[state.ambientFrequency] || ranges[2];
  const delay = min + Math.random() * (max - min);
  state.ambientTimer = window.setTimeout(() => {
    playSound(nextAmbientSound());
    scheduleAmbient();
  }, delay);
}

function nextAmbientSound() {
  if (state.heldSound && state.heldSound !== 'random') {
    return state.heldSound;
  }
  const pool = ['select', 'complete', 'cash', 'hype', 'ambient', 'cash'];
  return pool[Math.floor(Math.random() * pool.length)];
}

function frequencyLabel(value) {
  return {
    1: 'Rare',
    2: 'Normal',
    3: 'Busy',
    4: 'Casino floor',
    5: 'Unhinged'
  }[value] || 'Normal';
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
  $('#lockPill').className = shot ? `pill ${shot.status}` : 'pill';
  $('#lockPill').textContent = shot ? shot.status : 'No shot';
  renderMessages(shot);
  renderQuestions(shot);
  renderActions(shot);
}

function embedUrl(item) {
  if (!item?.url) {
    return null;
  }
  try {
    const url = new URL(item.url);
    if (url.hostname.includes('youtube.com')) {
      const videoId = url.searchParams.get('v');
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    }
    if (url.hostname === 'youtu.be') {
      return `https://www.youtube.com/embed/${url.pathname.slice(1)}`;
    }
    if (item.kind === 'game' || item.kind === 'web' || item.kind === 'music') {
      return item.url;
    }
  } catch {
    return null;
  }
  return null;
}

function renderEntertainmentStage() {
  const item = selectedEntertainment();
  if (!item) {
    $('#entertainmentStage').innerHTML = '<div class="stage-empty">Pick something from the feed.</div>';
    return;
  }

  const src = embedUrl(item);
  if (src) {
    $('#entertainmentStage').innerHTML = `
      <iframe
        title="${escapeHtml(item.title)}"
        src="${escapeHtml(src)}"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
    `;
    return;
  }

  $('#entertainmentStage').innerHTML = `
    <div class="stage-empty">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${item.url ? 'This source resists embedding, so keep the app calm and open it beside the cockpit.' : 'This roulette item needs a playable URL from the picker.'}</span>
      ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open externally</a>` : ''}
    </div>
  `;
}

function renderEntertainment(items) {
  $('#entertainmentList').innerHTML = items.map((item) => `
    <article class="fun-card ${item.id === state.activeEntertainmentId ? 'active' : ''}" data-entertainment="${item.id}">
      <div class="fun-kind ${escapeHtml(item.kind)}">${escapeHtml(item.kind)}</div>
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.reason || 'Queued for while a shot runs.')}</p>
      <div class="subtle">${escapeHtml(item.source)}${item.linked_shot_title ? ` / ${escapeHtml(item.linked_shot_title)}` : ''}</div>
      <div class="button-row">
        <button class="secondary" data-entertainment="${item.id}">Preview</button>
        ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open</a>` : ''}
      </div>
    </article>
  `).join('');
  renderEntertainmentStage();
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

function renderIntegrations() {
  const discovery = state.integrations?.discovery || {};
  const cards = [
    {
      name: 'Default Mode',
      status: 'included',
      body: 'Local shots, mock runs, generated sounds, manual entertainment, and fallback links work immediately.'
    },
    {
      name: 'Bright Data MCP',
      status: discovery.configured ? 'connected' : 'configure',
      body: discovery.configured ? 'Ready for real public web discovery.' : 'Add BRIGHT_DATA_API_TOKEN in .env to replace fallback discovery.'
    },
    {
      name: 'AI Runner',
      status: 'configure',
      body: 'Add an LLM provider or delegate runner when you want real one-shot builds instead of mock completion.'
    },
    {
      name: 'Notifications',
      status: 'user permission',
      body: 'Browser notifications should be requested only when a user enables completion pings.'
    },
    {
      name: 'Sound Packs',
      status: 'optional',
      body: 'Generated sounds ship by default as a native vibe layer. User-provided clean-license packs can come later.'
    }
  ];

  $('#integrationGrid').innerHTML = cards.map((card) => `
    <article class="integration-card ${escapeHtml(card.status.replaceAll(' ', '-'))}">
      <span class="pill">${escapeHtml(card.status)}</span>
      <strong>${escapeHtml(card.name)}</strong>
      <p>${escapeHtml(card.body)}</p>
    </article>
  `).join('');
}

function renderSoundMode() {
  const label = state.heldSound === 'random' ? 'random sounds' : `${state.heldSound} only`;
  $('#heldSoundStatus').textContent = `Intermittent mode: ${label}`;
  document.querySelectorAll('[data-sound-pad]').forEach((pad) => {
    pad.classList.toggle('held', pad.dataset.soundPad === state.heldSound);
  });
}

function renderOnboarding() {
  $('#onboarding').hidden = Boolean(state.dashboard.settings?.onboardingComplete);
}

function render() {
  renderStats(state.dashboard.stats);
  renderShotList(state.dashboard.shots);
  renderActiveShot();
  renderEntertainment(state.dashboard.entertainment);
  renderMemory(state.dashboard.memory);
  renderIntegrations();
  renderOnboarding();
  renderSoundMode();
  if (state.integrations?.discovery) {
    const discovery = state.integrations.discovery;
    $('#discoveryStatus').textContent = `${discovery.provider}: ${discovery.mode}`;
  }
  $('#ambientFrequency').value = state.ambientFrequency;
  $('#ambientFrequencyLabel').textContent = frequencyLabel(state.ambientFrequency);
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
  if (!state.activeEntertainmentId && dashboard.entertainment[0]) {
    state.activeEntertainmentId = dashboard.entertainment[0].id;
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
  playSound('start');
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
  state.activeEntertainmentId = state.dashboard.entertainment[0]?.id || null;
  playSound('select');
  render();
});

$('#discoverButton').addEventListener('click', async () => {
  const result = await request('/api/entertainment/discover', { method: 'POST' });
  state.dashboard = result;
  if (result.discovery) {
    state.integrations.discovery = result.discovery;
  }
  state.activeEntertainmentId = state.dashboard.entertainment[0]?.id || null;
  playSound('complete');
  render();
});

document.body.addEventListener('click', async (event) => {
  if (event.target.closest('a')) {
    return;
  }

  const selectShot = event.target.closest('[data-select-shot]')?.dataset.selectShot;
  if (selectShot) {
    state.activeShotId = Number(selectShot);
    playSound('select');
    render();
    return;
  }

  const entertainment = event.target.closest('[data-entertainment]')?.dataset.entertainment;
  if (entertainment) {
    state.activeEntertainmentId = Number(entertainment);
    playSound('select');
    render();
    return;
  }

  const startShot = event.target.dataset.startShot;
  if (startShot) {
    state.dashboard = await request(`/api/shots/${startShot}/start`, { method: 'POST' });
    playSound('start');
    render();
    return;
  }

  const completeShot = event.target.dataset.completeShot;
  if (completeShot) {
    state.dashboard = await request(`/api/shots/${completeShot}/complete`, { method: 'POST' });
    playSound('complete');
    render();
    return;
  }

  const forkShot = event.target.dataset.forkShot;
  if (forkShot) {
    const shot = state.dashboard.shots.find((item) => item.id === Number(forkShot));
    $('#shotForm input[name="title"]').value = `${shot.title} refinement`;
    $('#shotForm textarea[name="prompt"]').value = `Refine the completed shot externally:\n\n${shot.prompt}\n\nChange request: `;
    $('#shotForm textarea[name="prompt"]').focus();
    playSound('select');
  }
});

$('#soundToggle').addEventListener('click', () => {
  state.sound = !state.sound;
  $('#soundToggle').textContent = state.sound ? 'Sound on' : 'Sound off';
  $('#soundToggle').setAttribute('aria-pressed', String(state.sound));
  if (state.sound) {
    playSound('select');
  }
  scheduleAmbient();
});

$('#ambientToggle').addEventListener('click', () => {
  state.ambient = !state.ambient;
  $('#ambientToggle').textContent = state.ambient ? 'Intermittent on' : 'Intermittent off';
  $('#ambientToggle').classList.toggle('active', state.ambient);
  playSound(state.ambient ? 'cash' : 'select');
  scheduleAmbient();
});

$('#ambientFrequency').addEventListener('input', (event) => {
  state.ambientFrequency = Number(event.target.value);
  localStorage.setItem('ambientFrequency', String(state.ambientFrequency));
  $('#ambientFrequencyLabel').textContent = frequencyLabel(state.ambientFrequency);
  if (state.ambient) {
    playSound('select');
    scheduleAmbient();
  }
});

document.body.addEventListener('click', (event) => {
  const sound = event.target.closest('[data-sound-pad]')?.dataset.soundPad;
  if (!sound) {
    return;
  }
  if (sound === 'random') {
    playSound('select');
    return;
  }
  playSound(sound);
});

document.body.addEventListener('pointerdown', (event) => {
  const pad = event.target.closest('[data-sound-pad]');
  if (!pad) {
    return;
  }
  window.clearTimeout(state.holdTimer);
  state.holdTimer = window.setTimeout(() => {
    state.heldSound = pad.dataset.soundPad;
    localStorage.setItem('heldSound', state.heldSound);
    playSound(state.heldSound === 'random' ? 'complete' : state.heldSound);
    renderSoundMode();
    scheduleAmbient();
  }, 650);
});

document.body.addEventListener('pointerup', () => {
  window.clearTimeout(state.holdTimer);
});

document.body.addEventListener('pointercancel', () => {
  window.clearTimeout(state.holdTimer);
});

$('#dismissOnboarding').addEventListener('click', async () => {
  state.dashboard = await request('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ key: 'onboardingComplete', value: 'true' })
  });
  playSound('select');
  render();
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
  playSound('select');
  render();
});

load().catch((error) => {
  document.body.innerHTML = `<main class="workspace"><div class="empty">${escapeHtml(error.message)}</div></main>`;
});

preloadCasinoSamples();
