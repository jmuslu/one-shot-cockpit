import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(rootDir, 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'oneshot.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS shots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'intake',
    model TEXT NOT NULL DEFAULT 'direct-ai',
    mode TEXT NOT NULL DEFAULT 'one-shot',
    result_summary TEXT NOT NULL DEFAULT '',
    result_artifact TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shot_id INTEGER NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS clarifying_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shot_id INTEGER NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS entertainment_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    linked_shot_id INTEGER REFERENCES shots(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    detail TEXT NOT NULL,
    memory_type TEXT NOT NULL DEFAULT 'preference',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const shotCount = db.prepare('SELECT COUNT(*) AS count FROM shots').get().count;

if (shotCount === 0) {
  const now = new Date().toISOString();
  const insertShot = db.prepare(`
    INSERT INTO shots (title, prompt, status, result_summary, result_artifact, completed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMessage = db.prepare(`
    INSERT INTO messages (shot_id, role, body)
    VALUES (?, ?, ?)
  `);
  const insertQuestion = db.prepare(`
    INSERT INTO clarifying_questions (shot_id, question, answer)
    VALUES (?, ?, ?)
  `);
  const insertEntertainment = db.prepare(`
    INSERT INTO entertainment_items (kind, title, source, url, reason, linked_shot_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMemory = db.prepare(`
    INSERT INTO memory (label, detail, memory_type)
    VALUES (?, ?, ?)
  `);

  insertShot.run(
    'Personal landing page',
    'One-shot a polished personal landing page with a strong visual identity, contact section, and project highlights.',
    'running',
    '',
    '',
    null
  );
  insertShot.run(
    'Tiny habit tracker',
    'Build a tiny habit tracker app with local persistence and a clean review screen.',
    'done',
    'Completed as a focused single-pass app. Follow-up is locked here; refinement should start as a new shot or move to an external serious workspace.',
    'outputs/tiny-habit-tracker',
    now
  );

  insertMessage.run(1, 'user', 'Make it feel sharp, modern, and not like a generic template.');
  insertMessage.run(1, 'assistant', 'I need just enough shape to avoid guessing: audience, tone, and must-have sections.');
  insertQuestion.run(1, 'Who is this for?', '');
  insertQuestion.run(1, 'What should the visitor do next?', '');

  insertMessage.run(2, 'user', 'Make me a tiny habit tracker. I want it done in one pass.');
  insertMessage.run(2, 'assistant', 'Done. This shot is now locked.');

  insertEntertainment.run('reddit', 'r/InternetIsBeautiful rabbit-hole batch', 'Bright Data MCP planned', 'https://www.reddit.com/r/InternetIsBeautiful/', 'Something to browse while a shot runs.', 1);
  insertEntertainment.run('youtube', 'Short game-dev video queue', 'YouTube pull planned', 'https://www.youtube.com/', 'Relevant to project-building mood without being work.', 1);
  insertEntertainment.run('game', 'Diep.io', 'io game picker', 'https://diep.io/', 'Tank arena classic. Good quick background chaos.', null);

  insertMemory.run('one-shot rule', 'Completed shots are locked. Follow-up refinement happens by starting a new shot or opening the artifact in a serious external tool.', 'product-rule');
  insertMemory.run('waiting-room layer', 'The entertainment panel exists to occupy attention while the project runs, not to become the project itself.', 'product-rule');
  insertMemory.run('clarify lightly', 'Ask a few high-leverage clarifying questions only when needed; otherwise start the run quickly.', 'behavior');
}
