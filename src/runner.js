// Stage 2b: autonomous runner.
//
// Drives Claude Code headlessly through the Spec-Kit phases for a shot:
//   specify -> (pause only if open questions remain) -> plan -> tasks -> implement -> done
//
// "Least questions possible" is enforced two ways:
//   1. /speckit-clarify is skipped entirely.
//   2. A one-shot directive is injected (CLAUDE.md + --append-system-prompt) telling
//      the agent to resolve ambiguity with documented assumptions instead of asking.
// Any [NEEDS CLARIFICATION] markers that survive become the only intake questions.
//
// The executor is pluggable: a real one spawns `claude`/`specify`, a mock one
// produces canned artifacts so the whole pipeline is testable offline. Set
// ONESHOT_EXECUTOR=mock (env or settings) to force the mock.

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { ingestSpec, snapshotArtifact, locateSpecPath } from './speckit.js';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const workspacesDir = join(rootDir, 'data', 'workspaces');

// --- configuration (settings table overrides env overrides default) ----------
function setting(key, fallback) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || process.env[key] || fallback;
}
const claudeBin = () => setting('CLAUDE_BIN', 'claude');
const specifyBin = () => setting('SPECIFY_BIN', 'specify');
const permissionMode = () => setting('CLAUDE_PERMISSION_MODE', 'acceptEdits'); // or bypassPermissions in a sandbox
const maxTurns = () => Number(setting('CLAUDE_MAX_TURNS', '40'));
const templateDir = () => setting('SPEC_TEMPLATE_DIR', ''); // an existing `specify init` project to copy scaffolding from
const useMock = () => setting('ONESHOT_EXECUTOR', '') === 'mock';

const ONE_SHOT_DIRECTIVE =
  'You are running in autonomous one-shot mode inside an isolated workspace. ' +
  'Resolve every ambiguity by choosing the most reasonable option and recording it under the spec\'s Assumptions section. ' +
  'Do NOT write [NEEDS CLARIFICATION] markers unless a choice would materially change scope or architecture and cannot be safely assumed. ' +
  'Never pause to ask the user a question. Run the requested phase to completion.';

const CLAUDE_MD = `# One-Shot Cockpit run\n\n${ONE_SHOT_DIRECTIVE}\n`;

const PHASE_ORDER = ['brief', 'specify', 'plan', 'tasks', 'implement', 'done'];
const nextPhase = (current) => PHASE_ORDER[PHASE_ORDER.indexOf(current) + 1] || null;

// --- small db helpers ---------------------------------------------------------
const getShot = (id) => db.prepare('SELECT * FROM shots WHERE id = ?').get(id);
const setPhase = (id, phase) => db.prepare('UPDATE shots SET phase = ? WHERE id = ?').run(phase, id);
const setStatus = (id, status) => db.prepare('UPDATE shots SET status = ? WHERE id = ?').run(status, id);
const log = (id, body) => db.prepare("INSERT INTO messages (shot_id, role, body) VALUES (?, 'assistant', ?)").run(id, body);

// --- workspace ----------------------------------------------------------------
function ensureWorkspace(shotId) {
  const ws = join(workspacesDir, `shot-${shotId}`);
  if (!existsSync(ws)) {
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'CLAUDE.md'), CLAUDE_MD);

    const template = templateDir();
    if (template && existsSync(template)) {
      // Copy just the Spec-Kit scaffolding from an existing initialized project
      // (avoids the interactive `specify init` script-type prompt).
      for (const sub of ['.specify', '.claude']) {
        const src = join(template, sub);
        if (existsSync(src)) cpSync(src, join(ws, sub), { recursive: true });
      }
      try { rmSync(join(ws, '.specify', 'feature.json')); } catch { /* none to remove */ }
    } else if (!useMock()) {
      const r = spawnSync(specifyBin(), ['init', '.', '--integration', 'claude'], { cwd: ws, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`specify init failed: ${(r.stderr || r.stdout || '').slice(0, 400)}`);
    }
  }
  db.prepare('UPDATE shots SET spec_dir = ? WHERE id = ?').run(ws, shotId);
  return ws;
}

// --- executor: real -----------------------------------------------------------
function runClaude(cwd, prompt) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', prompt,
      '--permission-mode', permissionMode(),
      '--max-turns', String(maxTurns()),
      '--output-format', 'json',
      '--append-system-prompt', ONE_SHOT_DIRECTIVE
    ];
    const child = spawn(claudeBin(), args, { cwd, env: process.env });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 400)}`));
      let result = out;
      try { result = JSON.parse(out).result ?? out; } catch { /* plain text */ }
      resolve({ result });
    });
  });
}

// --- executor: mock (offline) -------------------------------------------------
function mockSpec(brief, ambiguous) {
  const clar = ambiguous ? '\n\nThe authentication approach is [NEEDS CLARIFICATION: which auth provider?].' : '';
  return `# Feature Specification: Mock Feature

**Feature Branch**: \`001-mock\`
**Created**: 2026-06-21
**Status**: Draft
**Input**: User description: "${brief}"${clar}

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST do the primary thing described in the brief
- **FR-002**: System MUST persist state locally

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The core flow works in under 3 seconds

## Assumptions

- Single-user, local-first; no accounts required
`;
}

function runMock(cwd, prompt) {
  const featureDir = join(cwd, 'specs', '001-mock');
  if (prompt.startsWith('/speckit-specify')) {
    const brief = prompt.replace('/speckit-specify', '').trim();
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, 'spec.md'), mockSpec(brief, /ambiguous/i.test(brief)));
    mkdirSync(join(cwd, '.specify'), { recursive: true });
    writeFileSync(join(cwd, '.specify', 'feature.json'), JSON.stringify({ feature_directory: 'specs/001-mock' }));
    return Promise.resolve({ result: 'spec written' });
  }
  if (prompt.startsWith('/speckit-plan')) {
    writeFileSync(join(featureDir, 'plan.md'), '# Implementation Plan\n\n- Stack: static HTML/CSS/JS\n- No backend\n');
    return Promise.resolve({ result: 'plan written' });
  }
  if (prompt.startsWith('/speckit-tasks')) {
    writeFileSync(join(featureDir, 'tasks.md'), '# Tasks\n\n- [ ] T001 Scaffold\n- [ ] T002 Implement core flow\n- [ ] T003 Persist state\n');
    return Promise.resolve({ result: 'tasks written' });
  }
  if (prompt.startsWith('/speckit-implement')) {
    const out = join(cwd, 'app');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Mock build</title><h1>Built by mock runner</h1>');
    return Promise.resolve({ result: 'implemented' });
  }
  return Promise.resolve({ result: 'noop' });
}

const agent = (cwd, prompt) => (useMock() ? runMock(cwd, prompt) : runClaude(cwd, prompt));

// --- artifact helpers ---------------------------------------------------------
function snapshotFeatureFile(shotId, ws, name) {
  const specPath = locateSpecPath(ws);
  if (!specPath) return;
  const p = join(dirname(specPath), name);
  if (existsSync(p)) snapshotArtifact(shotId, name, p, readFileSync(p, 'utf8'));
}

function finish(shotId, ws) {
  setPhase(shotId, 'done');
  db.prepare(
    "UPDATE shots SET status = 'done', result_summary = ?, result_artifact = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run('One-shot run complete. Spec, plan, tasks, and implementation are locked here.', ws, shotId);
  log(shotId, 'Done. This shot is now locked; follow-up belongs in a new shot.');
}

// --- one phase; returns true if the pipeline must pause for human input -------
async function runOnePhase(shotId, phase, ws) {
  log(shotId, `Phase: ${phase} (running)`);

  if (phase === 'specify') {
    const shot = getShot(shotId);
    await agent(ws, `/speckit-specify ${shot.prompt}`);
    const specPath = locateSpecPath(ws);
    if (!specPath) throw new Error('specify produced no spec.md');
    const { spec } = ingestSpec(shotId, { specPath });
    setPhase(shotId, 'specify');
    if (spec.needsClarification.length) {
      setStatus(shotId, 'intake');
      log(shotId, `Specify left ${spec.needsClarification.length} open question(s). Answer them, then continue.`);
      return true; // pause
    }
    return false;
  }

  if (phase === 'plan') {
    await agent(ws, '/speckit-plan');
    snapshotFeatureFile(shotId, ws, 'plan.md');
    setPhase(shotId, 'plan');
    return false;
  }

  if (phase === 'tasks') {
    await agent(ws, '/speckit-tasks');
    snapshotFeatureFile(shotId, ws, 'tasks.md');
    setPhase(shotId, 'tasks');
    return false;
  }

  if (phase === 'implement') {
    await agent(ws, '/speckit-implement');
    setPhase(shotId, 'implement');
    finish(shotId, ws);
    return false;
  }

  return false;
}

// --- the pipeline -------------------------------------------------------------
export async function runPipeline(shotId) {
  const start = getShot(shotId);
  if (!start) throw new Error('Shot not found.');
  if (start.status === 'done') throw new Error('Completed shots are locked.');

  setStatus(shotId, 'running');
  const ws = ensureWorkspace(shotId);

  try {
    while (true) {
      const phase = getShot(shotId).phase;
      const next = nextPhase(phase);
      if (!next || next === 'done') { finish(shotId, ws); return; }
      const paused = await runOnePhase(shotId, next, ws);
      if (paused) return;
    }
  } catch (error) {
    setStatus(shotId, 'intake');
    log(shotId, `Run failed during ${getShot(shotId).phase}: ${error.message}`);
    throw error;
  }
}

// Resume a paused run: fold the now-answered questions into the spec, then continue.
export async function continueRun(shotId) {
  const shot = getShot(shotId);
  if (!shot) throw new Error('Shot not found.');
  if (shot.status === 'done') throw new Error('Completed shots are locked.');

  const ws = shot.spec_dir || ensureWorkspace(shotId);
  const specPath = locateSpecPath(ws);
  const answered = db.prepare(
    "SELECT question, answer FROM clarifying_questions WHERE shot_id = ? AND answer <> ''"
  ).all(shotId);

  if (specPath && answered.length) {
    const block =
      `\n\n## Clarifications\n\n### Session ${new Date().toISOString().slice(0, 10)}\n\n` +
      answered.map((q) => `- Q: ${q.question} → A: ${q.answer}`).join('\n') + '\n';
    writeFileSync(specPath, readFileSync(specPath, 'utf8') + block);
    log(shotId, `Folded ${answered.length} answer(s) into the spec; continuing.`);
  }

  return runPipeline(shotId);
}
