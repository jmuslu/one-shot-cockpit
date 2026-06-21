// Spec-Kit integration for One-Shot Cockpit.
//
// Stage 2a: parse a Spec-Kit `spec.md` and ingest it into a shot.
//   - clarifications  -> clarifying_questions (question + answer already resolved)
//   - the full spec    -> artifacts (snapshot kept with the shot)
//   - structured fields available for plan/tasks phases later
//
// This module deliberately does NOT drive Claude Code itself (that is Stage 2b).
// It ingests the artifacts Spec-Kit already produced, which keeps it pure and
// testable offline.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { db } from './db.js';

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const TITLE_RE = /^#\s+Feature Specification:\s*(.*)$/;
const H2_RE = /^##\s+(.+?)\s*$/;
const H3_RE = /^###\s+(.+?)\s*$/;
const HEADER_RE = /^\*\*(.+?)\*\*:\s*(.*)$/; // **Key**: value
const ITEM_RE = /^[-*]\s+\*\*(.+?)\*\*:\s*(.*)$/; // - **FR-001**: text / - **Name**: desc
const BULLET_RE = /^[-*]\s+(.*)$/;
const NUMBERED_RE = /^\d+\.\s+(.*)$/;
const STORY_RE = /^User Story\s+\d+\s*-\s*(.+?)\s*\(Priority:\s*(P\d+)\)\s*$/;
const SESSION_RE = /^Session\s+(.+)$/;
const CLARIFY_SPLIT_RE = /\s*→\s*A:\s*/; // "Q: ... → A: ..."

// Strip trailing markdown annotations like " *(mandatory)*".
function stripAnnotation(text) {
  return text.replace(/\s*\*\(.*\)\*\s*$/, '').trim();
}

export function parseSpec(markdown) {
  const lines = String(markdown).split(/\r?\n/);

  const spec = {
    title: '',
    featureBranch: '',
    created: '',
    status: '',
    input: '',
    userStories: [],
    edgeCases: [],
    functionalRequirements: [],
    keyEntities: [],
    successCriteria: [],
    clarifications: [],
    assumptions: [],
    needsClarification: []
  };

  let section = ''; // current `##` heading (annotation stripped)
  let sub = ''; // current `###` heading
  let story = null; // user story being filled
  let sessionDate = '';

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;

    const title = line.match(TITLE_RE);
    if (title) {
      spec.title = title[1].trim();
      continue;
    }

    const h2 = line.match(H2_RE);
    if (h2) {
      section = stripAnnotation(h2[1]);
      sub = '';
      story = null;
      continue;
    }

    const h3 = line.match(H3_RE);
    if (h3) {
      sub = stripAnnotation(h3[1]);
      story = null;
      const s = sub.match(STORY_RE);
      if (s) {
        story = {
          name: s[1].trim(),
          priority: s[2],
          description: '',
          why: '',
          independentTest: '',
          acceptanceScenarios: []
        };
        spec.userStories.push(story);
      }
      const sess = sub.match(SESSION_RE);
      if (sess) sessionDate = sess[1].trim();
      continue;
    }

    // Top-of-file header key/value pairs (before the first `##`).
    if (!section) {
      const hm = line.match(HEADER_RE);
      if (hm) {
        const key = hm[1].trim();
        const value = hm[2].trim();
        if (key === 'Feature Branch') spec.featureBranch = value.replace(/^`|`$/g, '');
        else if (key === 'Created') spec.created = value;
        else if (key === 'Status') spec.status = value;
        else if (key === 'Input') spec.input = value;
      }
      continue;
    }

    // Section-scoped content.
    if (section.startsWith('Requirements') && sub.startsWith('Functional Requirements')) {
      const m = line.match(ITEM_RE);
      if (m && /^FR-/i.test(m[1])) spec.functionalRequirements.push({ id: m[1], text: m[2].trim() });
      continue;
    }

    if (section.startsWith('Requirements') && sub.startsWith('Key Entities')) {
      const m = line.match(ITEM_RE);
      if (m) spec.keyEntities.push({ name: m[1].trim(), description: m[2].trim() });
      continue;
    }

    if (section.startsWith('Success Criteria')) {
      const m = line.match(ITEM_RE);
      if (m && /^SC-/i.test(m[1])) spec.successCriteria.push({ id: m[1], text: m[2].trim() });
      continue;
    }

    if (section.startsWith('Clarifications')) {
      const b = line.match(BULLET_RE);
      if (b) {
        const parts = b[1].split(CLARIFY_SPLIT_RE);
        if (parts.length >= 2) {
          const question = parts[0].replace(/^Q:\s*/, '').trim();
          const answer = parts.slice(1).join(' ').trim();
          spec.clarifications.push({ question, answer, session: sessionDate });
        }
      }
      continue;
    }

    if (section.startsWith('Assumptions')) {
      const b = line.match(BULLET_RE);
      if (b) spec.assumptions.push(b[1].trim());
      continue;
    }

    if (section.startsWith('User Scenarios')) {
      if (sub === 'Edge Cases') {
        const b = line.match(BULLET_RE);
        if (b) spec.edgeCases.push(b[1].trim());
        continue;
      }
      if (story) {
        const hm = line.match(HEADER_RE);
        if (hm) {
          const k = hm[1].trim();
          if (k === 'Why this priority') story.why = hm[2].trim();
          else if (k === 'Independent Test') story.independentTest = hm[2].trim();
          continue;
        }
        const num = line.match(NUMBERED_RE);
        if (num) {
          story.acceptanceScenarios.push(num[1].trim());
          continue;
        }
        // First plain paragraph after the heading is the narrative.
        if (!story.description) story.description = line.trim();
      }
    }
  }

  // Inline ambiguity markers the agent left unresolved — these become the
  // only "high-leverage" questions surfaced in the cockpit's intake panel.
  const markerRe = /\[NEEDS CLARIFICATION:?\s*([^\]]*)\]/gi;
  let marker;
  while ((marker = markerRe.exec(markdown))) {
    spec.needsClarification.push((marker[1] || 'Unspecified detail').trim());
  }

  return spec;
}

// ---------------------------------------------------------------------------
// Locating the active spec via Spec-Kit's pointer file
// ---------------------------------------------------------------------------

// Reads `<projectDir>/.specify/feature.json` -> { feature_directory }
// and returns the absolute path to that feature's spec.md, or null.
export function locateSpecPath(projectDir) {
  if (!projectDir) return null;
  const pointer = join(projectDir, '.specify', 'feature.json');
  if (!existsSync(pointer)) return null;

  let featureDir;
  try {
    ({ feature_directory: featureDir } = JSON.parse(readFileSync(pointer, 'utf8')));
  } catch {
    return null;
  }
  if (!featureDir) return null;

  const dir = isAbsolute(featureDir) ? featureDir : join(projectDir, featureDir);
  const specPath = join(dir, 'spec.md');
  return existsSync(specPath) ? specPath : null;
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

// Ingest a spec into a shot. Pass { specText } directly, or { specPath } to read
// from disk. Clarifications become answered clarifying_questions; the raw spec is
// snapshotted as an artifact; the shot advances into the `specify` phase.
export function ingestSpec(shotId, { specText, specPath = '' } = {}) {
  const shot = db.prepare('SELECT * FROM shots WHERE id = ?').get(shotId);
  if (!shot) throw new Error('Shot not found.');
  if (shot.status === 'done') throw new Error('Completed shots are locked. Start a new shot for follow-up.');

  const markdown = typeof specText === 'string' && specText.length
    ? specText
    : readFileSync(specPath, 'utf8');

  const spec = parseSpec(markdown);

  db.exec('BEGIN');
  try {
    // Spec is the source of truth for clarifications — replace any prior set.
    db.prepare('DELETE FROM clarifying_questions WHERE shot_id = ?').run(shotId);
    const insertQuestion = db.prepare(
      'INSERT INTO clarifying_questions (shot_id, question, answer) VALUES (?, ?, ?)'
    );
    for (const c of spec.clarifications) insertQuestion.run(shotId, c.question, c.answer);
    // Unresolved markers become OPEN (unanswered) questions for the intake panel.
    for (const open of spec.needsClarification) insertQuestion.run(shotId, open, '');

    // Snapshot the spec artifact (replace any prior snapshot of the same name).
    db.prepare('DELETE FROM artifacts WHERE shot_id = ? AND name = ?').run(shotId, 'spec.md');
    db.prepare(
      'INSERT INTO artifacts (shot_id, name, path, content) VALUES (?, ?, ?, ?)'
    ).run(shotId, 'spec.md', specPath, markdown);

    db.prepare(
      "UPDATE shots SET phase = 'specify', spec_dir = ? WHERE id = ?"
    ).run(specPath ? dirname(specPath) : '', shotId);

    const summary =
      `Spec ingested: ${spec.functionalRequirements.length} functional requirements, ` +
      `${spec.successCriteria.length} success criteria, ` +
      `${spec.clarifications.length} clarifications, ` +
      `${spec.userStories.length} user stories.`;
    db.prepare("INSERT INTO messages (shot_id, role, body) VALUES (?, 'assistant', ?)").run(shotId, summary);

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { spec };
}

// Store (or replace) a named artifact snapshot for a shot — used for plan.md,
// tasks.md, and any other phase output beyond spec.md.
export function snapshotArtifact(shotId, name, path, content) {
  db.prepare('DELETE FROM artifacts WHERE shot_id = ? AND name = ?').run(shotId, name);
  db.prepare(
    'INSERT INTO artifacts (shot_id, name, path, content) VALUES (?, ?, ?, ?)'
  ).run(shotId, name, path || '', content || '');
}
