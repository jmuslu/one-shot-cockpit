# One-Shot Cockpit — Specs

> Living document. We add sections iteratively as the design firms up.
> Status legend: 🟢 agreed · 🟡 proposed/needs confirmation · ⚪ placeholder for later.

## 1. One-shot layer overview 🟢

The one-shot layer turns a brief into a finished, locked artifact through a single
agent session. There is no open-ended follow-up chat: completed shots lock, and
refinement starts as a new shot or moves to an external workspace.

### 1.1 Lifecycle

```
choose runner
      │
createShot(brief, runner_provider)
      │  └─ start the agent session (bound to this shot)
      ▼
intake ── agent's first output = clarifying questions
      │  (zero questions → skip intake entirely)
      ▼
user submits answers (batch)
      │  └─ auto-triggers the run in the SAME resumable session
      ▼
running ── adapter.run(session_id)
      ▼
done ── result_summary + result_artifact written, shot LOCKED
```

Key rules:
- **Create starts the session.** The first thing `createShot` does after persisting
  the shot is start the agent session. The clarifying questions are *real agent
  output*, not hardcoded.
- **Answers auto-trigger the run.** No explicit "Start run" button. The run fires
  when all clarifying questions are answered and the batch is submitted
  (`intake → running`).
- **Zero-question case.** If the agent returns no clarifying questions, the shot
  flows straight `intake → running` with no intake screen — a true one-shot.
- **Done is locked.** Existing rule preserved: completed shots are read-only.

## 2. Delegate to the runner (Q3.1) 🟢

The runner is an **agent / provider**, not a raw LLM completion. The cockpit does
not call a model directly — it **dispatches to a runner-provider adapter** that
owns its own execution and authentication.

### 2.1 OAuth-only options, configured per provider

The cockpit is **not a secret store**, and it does not assume a single reference
provider. It offers a **configured list of runner options**, and the user picks one
and connects it.

**Inclusion rule (resolved):** a provider appears in the options list **only if it
supports OAuth sign-in.** Providers that authenticate solely via a pre-existing host
CLI login (`session`) or a pasted API key (`apiKey`) are **not** listed as runner
options. OAuth gives a clean in-app "Connect <provider>" flow without assuming a
pre-logged-in machine or asking the user to paste secrets.

| Auth mode | Listed as an option? | Where the credential lives | Cockpit's role |
|-----------|----------------------|----------------------------|----------------|
| `oauth`   | **yes** | the provider's own auth store after its login flow | trigger the provider's OAuth/login flow; store only a status |
| `session` | no | host CLI login (`~/.claude`, `~/.codex`) | — excluded from options |
| `apiKey`  | no | pasted key / `.env` | — excluded from options |

**Invariants:**
- **Connect = OAuth.** Selecting a runner that isn't connected yet kicks off that
  provider's OAuth flow. The provider persists its own token in its own auth store;
  the cockpit never holds the raw token.
- **Secrets never enter SQLite.** The `settings` table is echoed to every dashboard
  response, so anything there reaches the browser. Tokens live only in the provider's
  own auth store (or a gitignored local file at worst), never in the DB.
- **Status-only to the client.** The UI sees per-provider status
  *connected · needs connect*, never a raw token. Reuse the existing
  `getDiscoveryStatus()` status-only pattern from `discovery.js`.

> The `session`/`apiKey` modes stay in the adapter abstraction for completeness, but
> are not surfaced as selectable options under this rule.

### 2.2 Session persistence: resumable id, not a live process 🟢

Starting a session is async and the server can restart, so the cockpit must **not**
keep a long-lived subprocess per shot.

- Store a **resumable `session_id`** on the shot plus its workspace path.
- Each step (start → answer → run) is a fresh invocation that resumes that session
  (e.g. `claude -p --resume <session_id>` against the workspace). The agent keeps its
  context; the cockpit stays stateless between calls. Survives restarts, easy to
  inspect, no zombie processes.

### 2.3 Runner-provider adapter interface 🟡

```
adapter.startSession(brief, workspace)  → { sessionId, questions[] }
adapter.answer(sessionId, answers)      → void        // resumes the session
adapter.run(sessionId)                  → { summary, artifact }
```

Provider descriptor (static config or a small table):

```
id, name, authMode (session | apiKey | oauth),
command/endpoint, configured (derived), selected
```

Build the interface up front, but ship exactly **one** working provider behind it so
later feature branches can each add another.

### 2.4 Schema additions 🟡

```
shots:  + runner_provider TEXT    -- which agent ran this shot (replaces/extends `model`)
        + session_id      TEXT    -- resumable provider session
        + workspace       TEXT    -- per-shot working dir, e.g. outputs/shot-<id>/
```

## 3. Resolved decisions 🟢

- **No reference provider.** The cockpit ships a configured list of runner options
  rather than wiring one "first" provider. (resolved)
- **OAuth-only options.** A provider is listed only if it supports OAuth sign-in;
  `session`- and `apiKey`-only providers are excluded from the options list. (resolved)
- This makes "in-app key entry vs `.env`-only" moot for listed runners — connection is
  always OAuth, no key entry. (resolved)

### 3.1 Still to pick ⚪

- **Which OAuth-capable providers** populate the initial options list (e.g. Claude,
  OpenAI/Codex, GitHub Copilot, Gemini). To be configured iteratively.

## 5. Agent build loop 🟢

The run step actually drives an agent that builds files into the shot's workspace.

### 5.1 Provider-agnostic shell adapter

The cockpit is agnostic to *which* agent runs. A single configured shell command
is the agent — set via `ONESHOT_AGENT_CMD` (in `.env`):

- The built prompt (brief + clarifying answers) is **piped to the command's stdin**,
  or substituted for `{prompt}` if the template contains that token.
- The command runs with `cwd` = the shot's workspace, so the agent writes real
  files there.
- Works with any CLI agent: `claude -p ...`, `codex exec {prompt}`, etc.
- If `ONESHOT_AGENT_CMD` is unset, the run falls back to a simulated outcome so the
  flow never breaks.

### 5.2 Permissions 🟢

Headless `-p` runs can't prompt mid-run, so the agent needs standing permission.
Default is **`acceptEdits`** (file writes only, no arbitrary shell) — the safest
practical setting. `bypassPermissions` (full autonomy) is available but unconfined;
choose per risk tolerance.

### 5.3 Async lifecycle

- `runShot` sets the shot to `running`, writes `answers.md` into the workspace, then
  spawns the agent **asynchronously** and returns immediately (shot stays `running`).
- On process exit, `finalizeShot` flips the shot to `done` with the agent's output as
  the summary. A 5-minute timeout kills a hung agent and finalizes anyway.
- The frontend **polls** `/api/dashboard` while any shot is `running` and plays the
  completion sound on the `running → done` transition.

### 5.4 Workspace inputs

Each shot's `outputs/shot-<id>/` is seeded with:
- `prompt.md` — title, runner, session id, and the brief (written at create).
- `answers.md` — the clarifying Q&A (written at run, when answered).
The agent's deliverables land alongside these. `outputs/` is gitignored.

## 6. Later ⚪

Reserved for specs we add iteratively (intake heuristics, run progress/streaming,
notifications, entertainment layer, Bright Data MCP binding, etc.).

## 5. Prep graph dispatch 🟢

The cockpit now treats chat as input to a lightweight prep graph, not as the
builder chat itself. The graph is populated before dispatch and contains:

- goal
- audience
- stack
- scope
- acceptance criteria
- validation plan
- export/artifact expectation

Only missing or low-confidence graph nodes become visible clarifying questions.
When the graph is ready, the runner receives a finalized `OneShotSpec` and should
not ask follow-up questions. The default runner behavior writes a dispatch package
to the shot workspace; local command execution is opt-in with
`ONESHOT_RUNNER_EXECUTE=true`.
