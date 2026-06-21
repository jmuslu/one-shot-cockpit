# One-Shot Cockpit

A local prototype for a deliberately opinionated project harness: create a project brief once, answer only high-leverage clarifying questions, let the runner finish, then review a locked result.

The key product rule is that completed shots do not become normal follow-up chats. Refinement starts as a new shot or moves to a more serious external workspace.

## Current Prototype

- Local web dashboard
- SQLite persistence through Node's built-in `node:sqlite`
- One-shot project list
- Intake questions
- Running/done states
- Locked completed results
- Waiting-room entertainment panel for Reddit, YouTube, and web-game roulette integrations
- Integration plan placeholders for direct AI, Codex/Claude delegation, Bright Data MCP, and game roulette

## Run Locally

Requires Node 24 or newer.

```bash
npm start
```

Then open:

```text
http://localhost:3177
```

## Product Direction

This is not a general chat app. The goal is a "one-shot project cockpit":

1. The user starts a project shot with a strong brief.
2. The system asks a small number of clarifying questions when needed.
3. The runner works in the background.
4. The user can browse waiting-room content while it runs.
5. Completion triggers a notification.
6. The result locks inside this interface.
7. Follow-up work happens as a new shot or in an external workspace.

## Planned Integrations

- Direct LLM runner
- Codex or Claude Code delegation for real project execution
- Bright Data MCP for public Reddit, YouTube, search, and discovery feeds
- Web-game roulette for lightweight browser games while waiting
- Desktop/browser notifications when a shot completes

## Notes

The local SQLite database is generated under `data/` and intentionally ignored by git.
