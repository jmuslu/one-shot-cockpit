import { db } from './db.js';

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

  return {
    shots,
    entertainment,
    memory,
    stats: {
      running: shots.filter((shot) => shot.status === 'running').length,
      intake: shots.filter((shot) => shot.status === 'intake').length,
      done: shots.filter((shot) => shot.status === 'done').length,
      queuedEntertainment: entertainment.filter((item) => item.status === 'queued').length
    }
  };
}

export function createShot(input) {
  const title = String(input.title || '').trim();
  const prompt = String(input.prompt || '').trim();
  if (!title || !prompt) {
    throw new Error('A title and one-shot prompt are required.');
  }

  const result = db.prepare(`
    INSERT INTO shots (title, prompt, status, model, mode)
    VALUES (?, ?, 'intake', ?, 'one-shot')
  `).run(title, prompt, String(input.model || 'direct-ai').trim());

  db.prepare(`
    INSERT INTO messages (shot_id, role, body)
    VALUES (?, 'user', ?)
  `).run(result.lastInsertRowid, prompt);

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
