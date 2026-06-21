// Autonomous, agent-agnostic Spec-Kit runner.
//
// Drives a configured agent (ONESHOT_AGENT_CMD) through the Spec-Kit phases:
//   specify -> (pause only if [NEEDS CLARIFICATION] remains) -> plan -> tasks -> implement -> done
//
// "Least questions possible" is enforced by a one-shot directive embedded in each
// phase prompt: resolve ambiguity with documented assumptions instead of asking.
// Any [NEEDS CLARIFICATION] markers that survive become the only intake questions.
//
// There is NO agent-specific tooling here: each phase is a plain-text prompt and
// the artifacts are fixed files (spec.md / plan.md / tasks.md), so any agent CLI
// that reads a prompt and writes files works. Execution goes through the same
// shared executor (runAgentCommand) used by the prep-graph workflow.

import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { ingestSpec, snapshotArtifact, locateSpecPath } from './speckit.js';
import { runAgentCommand } from './runners.js';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const workspacesDir = join(rootDir, 'data', 'workspaces');

const ONE_SHOT_DIRECTIVE =
  'You are running in autonomous one-shot mode inside an isolated workspace. ' +
  "Resolve every ambiguity by choosing the most reasonable option and recording it under the spec's Assumptions section. " +
  'Do NOT write [NEEDS CLARIFICATION] markers unless a choice would materially change scope or architecture and cannot be safely assumed. ' +
  'Never pause to ask the user a question. Run the requested phase to completion and write the required files.';

// Dropped into the workspace so file-aware agents (incl. Claude Code via CLAUDE.md)
// pick up the one-shot directive as project context.
const AGENT_MD = `# One-Shot Cockpit run\n\n${ONE_SHOT_DIRECTIVE}\n`;

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
    writeFileSync(join(ws, 'AGENT.md'), AGENT_MD);
    writeFileSync(join(ws, 'CLAUDE.md'), AGENT_MD);
  }
  db.prepare('UPDATE shots SET spec_dir = ? WHERE id = ?').run(ws, shotId);
  return ws;
}

// --- phase prompts (agent-agnostic plain text) --------------------------------
function specifyPrompt(brief) {
  return `${ONE_SHOT_DIRECTIVE}

# Phase: SPECIFY

Write a Spec-Kit feature specification to a file named "spec.md" in the current directory, for this brief:

"${brief}"

Use exactly this Markdown structure so it can be parsed:

# Feature Specification: <short title>

**Feature Branch**: \`001-<slug>\`
**Created**: <today's date>
**Status**: Draft
**Input**: User description: "${brief}"

## Requirements

### Functional Requirements

- **FR-001**: System MUST <requirement>
- **FR-002**: System MUST <requirement>

## Success Criteria

### Measurable Outcomes

- **SC-001**: <measurable, testable outcome>

## Assumptions

- <every assumption you made instead of asking a question>

Only add an inline "[NEEDS CLARIFICATION: <question>]" marker if a decision would materially change scope or architecture and cannot be safely assumed. Write the file now.`;
}

function planPrompt() {
  return `${ONE_SHOT_DIRECTIVE}

# Phase: PLAN

Read "spec.md" in the current directory, then write an implementation plan to "plan.md" covering: the chosen stack/architecture, key components, data model, and the build approach. Keep it concise and buildable. Write the file now.`;
}

function tasksPrompt() {
  return `${ONE_SHOT_DIRECTIVE}

# Phase: TASKS

Read "spec.md" and "plan.md" in the current directory, then write "tasks.md": an ordered checklist of implementation tasks, one per line as "- [ ] T001 <task>" (T001, T002, ...). Write the file now.`;
}

function implementPrompt() {
  return `${ONE_SHOT_DIRECTIVE}

# Phase: IMPLEMENT

Read "spec.md", "plan.md", and "tasks.md" in the current directory, then build the actual project: create every source file needed for a working, runnable deliverable in this directory (for a web app, an index.html plus its assets). Implement every task. Build it now.`;
}

// --- run a phase through the shared agnostic executor -------------------------
async function runAgent(ws, prompt) {
  const out = await runAgentCommand({ cwd: ws, prompt, timeoutMs: 1000 * 60 * 20 });
  if (out.code !== 0) {
    throw new Error(`agent exited ${out.code ?? 'with no code'}${out.timedOut ? ' (timed out)' : ''}: ${(out.stderr || '').slice(0, 300)}`);
  }
  return out;
}

function snapshotFeatureFile(shotId, ws, name) {
  const p = join(ws, name);
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
    await runAgent(ws, specifyPrompt(shot.prompt));
    const specPath = locateSpecPath(ws);
    if (!specPath) throw new Error('specify phase produced no spec.md');
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
    await runAgent(ws, planPrompt());
    snapshotFeatureFile(shotId, ws, 'plan.md');
    setPhase(shotId, 'plan');
    return false;
  }

  if (phase === 'tasks') {
    await runAgent(ws, tasksPrompt());
    snapshotFeatureFile(shotId, ws, 'tasks.md');
    setPhase(shotId, 'tasks');
    return false;
  }

  if (phase === 'implement') {
    await runAgent(ws, implementPrompt());
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
      if (phase === 'done') return; // implement already finished it
      const next = nextPhase(phase);
      if (!next) { finish(shotId, ws); return; }
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
