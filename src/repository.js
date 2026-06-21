import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { RUNNER_PROVIDERS, findProvider, getAdapter } from './runners.js';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function runnerConnectedKey(id) {
  return `runner:${id}:connected`;
}

function getMessages(shotId) {
  return db.prepare(`
    SELECT * FROM messages
    WHERE shot_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(shotId);
}

function getQuestions(shotId) {
  return db.prepare(`
    SELECT * FROM clarifying_questions
    WHERE shot_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(shotId);
}

export function getDashboard() {
  const shots = db.prepare(`
    SELECT * FROM shots
    ORDER BY
      CASE status WHEN 'running' THEN 0 WHEN 'intake' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
      created_at DESC
  `).all().map((shot) => ({
    ...shot,
    messages: getMessages(shot.id),
    questions: getQuestions(shot.id)
  }));

  const entertainment = db.prepare(`
    SELECT e.*, s.title AS linked_shot_title
    FROM entertainment_items e
    LEFT JOIN shots s ON s.id = e.linked_shot_id
    ORDER BY e.created_at DESC
  `).all();

  const memory = db.prepare(`
    SELECT * FROM memory
    ORDER BY created_at DESC
  `).all();

  const settings = Object.fromEntries(db.prepare(`
    SELECT key, value FROM settings
  `).all().map((setting) => [setting.key, setting.value]));

  return {
    shots,
    entertainment,
    memory,
    settings: {
      onboardingComplete: settings.onboardingComplete === 'true'
    },
    stats: {
      running: shots.filter((shot) => shot.status === 'running').length,
      intake: shots.filter((shot) => shot.status === 'intake').length,
      done: shots.filter((shot) => shot.status === 'done').length,
      queuedEntertainment: entertainment.filter((item) => item.status === 'queued').length
    }
  };
}

export function updateSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(String(key), String(value));

  return getDashboard();
}

export function getSetting(key, fallback = '') {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || fallback;
}

// --- Runner providers (specs §2.1) ---------------------------------------
// Connection status is non-secret state (a boolean), so it is safe in the
// settings table. Tokens never touch SQLite — they stay with the provider.

export function getRunners() {
  const selected = getSetting('runner:selected', RUNNER_PROVIDERS[0]?.id || '');
  return {
    selected,
    providers: RUNNER_PROVIDERS.map((provider) => ({
      id: provider.id,
      name: provider.name,
      authMode: provider.authMode,
      tagline: provider.tagline,
      connected: getSetting(runnerConnectedKey(provider.id)) === 'true'
    }))
  };
}

export function connectRunner(id) {
  const provider = findProvider(id);
  if (!provider) {
    throw new Error('Unknown runner provider.');
  }
  // Stub for the provider's OAuth flow. A real adapter launches the provider
  // sign-in; the provider persists its own token. We store only a non-secret
  // connected status — never a token.
  updateSetting(runnerConnectedKey(id), 'true');
  updateSetting('runner:selected', id);
  return getRunners();
}

export function disconnectRunner(id) {
  const provider = findProvider(id);
  if (!provider) {
    throw new Error('Unknown runner provider.');
  }
  updateSetting(runnerConnectedKey(id), 'false');
  return getRunners();
}

export function createShot(input) {
  const title = String(input.title || '').trim();
  const prompt = String(input.prompt || '').trim();
  if (!title || !prompt) {
    throw new Error('A title and one-shot prompt are required.');
  }

  const provider = findProvider(String(input.runner_provider || input.model || '').trim());
  if (!provider) {
    throw new Error('Choose a runner provider.');
  }
  if (getSetting(runnerConnectedKey(provider.id)) !== 'true') {
    throw new Error(`Connect ${provider.name} before starting a shot.`);
  }

  const result = db.prepare(`
    INSERT INTO shots (title, prompt, status, model, mode, runner_provider)
    VALUES (?, ?, 'intake', ?, 'one-shot', ?)
  `).run(title, prompt, provider.id, provider.id);
  const shotId = Number(result.lastInsertRowid);

  db.prepare(`
    INSERT INTO messages (shot_id, role, body)
    VALUES (?, 'user', ?)
  `).run(shotId, prompt);

  // createShot starts the agent session (specs §1.1). The clarifying questions
  // are real adapter output, not hardcoded.
  const workspace = `outputs/shot-${shotId}`;
  mkdirSync(join(rootDir, workspace), { recursive: true });
  const session = getAdapter(provider.id).startSession(prompt, workspace);

  db.prepare('UPDATE shots SET session_id = ?, workspace = ? WHERE id = ?')
    .run(String(session.sessionId), workspace, shotId);

  // Seed the workspace with the brief so the build loop has an input file.
  writeFileSync(
    join(rootDir, workspace, 'prompt.md'),
    `# ${title}\n\n`
      + `- Runner: ${provider.name} (${provider.id})\n`
      + `- Session: ${session.sessionId}\n`
      + `- Workspace: ${workspace}\n\n`
      + `## Brief\n\n${prompt}\n`
  );

  db.prepare(`
    INSERT INTO messages (shot_id, role, body)
    VALUES (?, 'assistant', ?)
  `).run(
    shotId,
    session.questions.length
      ? `${provider.name} session started. A few clarifying questions first.`
      : `${provider.name} session started. No clarifying questions needed — running now.`
  );

  const insertQuestion = db.prepare(`
    INSERT INTO clarifying_questions (shot_id, question, answer)
    VALUES (?, ?, '')
  `);
  for (const question of session.questions) {
    insertQuestion.run(shotId, question);
  }

  // Zero-question case: flow straight intake -> running -> done.
  if (session.questions.length === 0) {
    runShot(shotId);
  }

  return getDashboard();
}

// Runs the agent loop to completion (specs §1.1). Auto-triggered, not a manual
// button. The agent runs asynchronously: the shot sits in 'running' until the
// agent process exits, then finalizeShot flips it to 'done'.
function runShot(id) {
  const shot = db.prepare('SELECT * FROM shots WHERE id = ?').get(id);
  if (!shot) {
    throw new Error('Shot not found.');
  }
  if (shot.status === 'done') {
    throw new Error('Completed shots are locked.');
  }

  db.prepare("UPDATE shots SET status = 'running' WHERE id = ?").run(id);
  db.prepare(`
    INSERT INTO messages (shot_id, role, body)
    VALUES (?, 'assistant', ?)
  `).run(id, 'Run started. The agent is building in the workspace until completion.');

  const provider = findProvider(shot.runner_provider);
  const adapter = getAdapter(shot.runner_provider);
  const answers = db.prepare('SELECT question, answer FROM clarifying_questions WHERE shot_id = ?').all(id);

  // Write the clarifying answers into the workspace as build input.
  const answered = answers.filter((item) => String(item.answer || '').trim());
  if (shot.workspace && answered.length) {
    writeFileSync(
      join(rootDir, shot.workspace, 'answers.md'),
      `# Clarifying answers\n\n${answered.map((item) => `**${item.question}**\n\n${item.answer}\n`).join('\n')}`
    );
  }

  adapter.answer(shot.session_id, answers);
  Promise.resolve(adapter.run(shot.session_id, {
    brief: shot.prompt,
    answers,
    workspace: shot.workspace,
    absWorkspace: shot.workspace ? join(rootDir, shot.workspace) : rootDir,
    providerName: provider?.name
  }))
    .then((outcome) => finalizeShot(id, outcome))
    .catch((error) => finalizeShot(id, { summary: `Run failed: ${error.message}`, artifact: shot.workspace || '' }));
}

function finalizeShot(id, outcome) {
  const result = db.prepare(`
    UPDATE shots
    SET status = 'done',
      result_summary = ?,
      result_artifact = ?,
      completed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status != 'done'
  `).run(outcome.summary, outcome.artifact || `outputs/shot-${id}`, id);

  if (result.changes === 0) {
    return;
  }
  db.prepare(`
    INSERT INTO messages (shot_id, role, body)
    VALUES (?, 'assistant', ?)
  `).run(id, 'Done. This shot is now locked; follow-up refinement belongs in a new shot or an external workspace.');
}

// Submitting the answered intake batch auto-triggers the run (specs §1.1).
export function submitAnswers(id) {
  const shot = db.prepare('SELECT * FROM shots WHERE id = ?').get(id);
  if (!shot) {
    throw new Error('Shot not found.');
  }
  if (shot.status === 'done') {
    throw new Error('Completed shots are locked.');
  }
  if (shot.status === 'running') {
    throw new Error('This shot is already running.');
  }
  const unanswered = getQuestions(shot.id).filter((question) => !String(question.answer || '').trim());
  if (unanswered.length) {
    throw new Error('Answer all clarifying questions before the run starts.');
  }
  runShot(id);
  return getDashboard();
}

export function startShot(id) {
  const shot = db.prepare('SELECT * FROM shots WHERE id = ?').get(id);
  if (!shot) {
    throw new Error('Shot not found.');
  }
  if (shot.status === 'done') {
    throw new Error('Completed shots are locked. Start a new shot for follow-up.');
  }

  db.prepare(`
    UPDATE shots SET status = 'running'
    WHERE id = ?
  `).run(id);
  db.prepare(`
    INSERT INTO messages (shot_id, role, body)
    VALUES (?, 'assistant', ?)
  `).run(id, 'Run started. The workspace is locked into one-shot mode until completion.');

  return getDashboard();
}

export function completeShot(id) {
  const shot = db.prepare('SELECT * FROM shots WHERE id = ?').get(id);
  if (!shot) {
    throw new Error('Shot not found.');
  }

  db.prepare(`
    UPDATE shots
    SET status = 'done',
      result_summary = ?,
      result_artifact = ?,
      completed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    'Mock completion: the real AI runner will write the artifact path, summary, test result, and handoff notes here.',
    `outputs/shot-${id}`,
    id
  );
  db.prepare(`
    INSERT INTO messages (shot_id, role, body)
    VALUES (?, 'assistant', ?)
  `).run(id, 'Done. This shot is now locked; follow-up refinement belongs in a new shot or an external workspace.');

  return getDashboard();
}

export function answerQuestion(id, questionId, answer) {
  const shot = db.prepare('SELECT * FROM shots WHERE id = ?').get(id);
  if (!shot) {
    throw new Error('Shot not found.');
  }
  if (shot.status === 'done') {
    throw new Error('Completed shots are locked.');
  }

  db.prepare(`
    UPDATE clarifying_questions
    SET answer = ?
    WHERE id = ? AND shot_id = ?
  `).run(String(answer || '').trim(), questionId, id);

  return getDashboard();
}

export function addEntertainment(input) {
  const kind = String(input.kind || 'link').trim();
  const title = String(input.title || '').trim();
  if (!title) {
    throw new Error('Entertainment item title is required.');
  }

  db.prepare(`
    INSERT INTO entertainment_items (kind, title, source, url, reason, linked_shot_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    kind,
    title,
    String(input.source || 'manual').trim(),
    String(input.url || '').trim(),
    String(input.reason || '').trim(),
    input.linked_shot_id || null
  );

  return getDashboard();
}

export function addEntertainmentItems(items) {
  const insert = db.prepare(`
    INSERT INTO entertainment_items (kind, title, source, url, reason, linked_shot_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const item of items) {
    insert.run(
      String(item.kind || 'link').trim(),
      String(item.title || 'Untitled item').trim(),
      String(item.source || 'discovery').trim(),
      String(item.url || '').trim(),
      String(item.reason || '').trim(),
      item.linked_shot_id || null
    );
  }

  return getDashboard();
}
