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
- Same-page entertainment preview stage with external-link fallback for sources that block embedding
- Generated WebAudio feedback sounds for selection, run start, and completion
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

## Collaboration Split

- One-shot effectiveness research: identify what makes a prompt/run succeed in one pass, including intake patterns, project boundaries, evaluation criteria, and handoff format.
- Entertainment layer: build the waiting-room surface, embedded previews, satisfying feedback, game roulette, and public-content discovery.

## Entertainment Embeds

The waiting-room panel should prefer same-page previews, but not every source allows iframe embedding. The current behavior is:

- YouTube watch URLs are converted into embed URLs when possible.
- Web/game URLs can load in the stage if the source permits it.
- Reddit and many normal web pages may block embedding; those show a calm fallback card with an external link.
- Sound effects are generated with WebAudio rather than bundled from copyrighted meme packs.

## Notes

The local SQLite database is generated under `data/` and intentionally ignored by git.
