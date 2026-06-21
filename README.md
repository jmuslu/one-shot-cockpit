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
- Native generated WebAudio feedback sounds for selection, run start, completion, obnoxious casino-style ca-ching, hype hits, original arcade vocal stingers, and optional intermittent stingers with adjustable frequency plus held-sound mode
- Bundled Kenney Casino Audio chip clips as the physical coin/chip layer for ca-ching
- Bundled Kenney Voiceover Pack clips as real recorded CC0 voice stingers
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

## Onboarding Boundary

The app should feel alive out of the box, then become more powerful when users connect services.

Out of the box:

- Local dashboard
- SQLite state
- Mock one-shot completion
- Manual entertainment queue
- Generated UI sounds
- Fallback discovery links

User-configured:

- Bright Data MCP for live public discovery
- LLM provider or external runner for real builds
- Browser notification permission
- User-provided sound packs
- Personal interests and login-backed browsing

The UI includes a first-run setup banner and an Integrations section to make this boundary explicit.

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

Entertainment cards are for browsable content: YouTube, Reddit, io games, and web links. Sounds and meme cues are native app controls in the Vibe Layer, not entertainment cards.

## Bright Data MCP

Bright Data MCP is the intended discovery source for the entertainment layer. The app now has a discovery endpoint and fallback queue:

```text
POST /api/entertainment/discover
```

To configure Bright Data, copy `.env.example` to `.env` and set:

```text
BRIGHT_DATA_API_TOKEN=...
BRIGHT_DATA_MCP_URL=https://mcp.brightdata.com/mcp
```

The official hosted setup is:

```text
https://mcp.brightdata.com/mcp?token=YOUR_API_TOKEN
```

The local setup is:

```bash
npx @brightdata/mcp
```

with:

```text
API_TOKEN=YOUR_BRIGHT_DATA_API_TOKEN
```

The next code step is binding Bright Data tools such as `search_engine` and `scrape_as_markdown` into the discovery route.

## Sound Sources

The app uses generated WebAudio effects plus bundled Kenney Casino Audio chip clips for the ca-ching. Kenney Casino Audio is CC0 and the license is included at `public/sounds/casino/KENNEY_CASINO_AUDIO_LICENSE.txt`.

The app also bundles selected Kenney Voiceover Pack clips for real recorded voice stingers. Kenney Voiceover Pack is CC0 and the license is included at `public/sounds/voice/KENNEY_VOICEOVER_LICENSE.txt`. The synthetic arcade vocal stingers remain original effects, not ripped character audio or official character voice lines.

Good asset sources to evaluate for future user-provided sound packs:

- Kenney UI Audio: CC0, 50 UI sounds.
- ObsydianX Interface SFX Pack 1: CC0, 200+ interface sounds.
- Pixabay UI/ding/success/meme sound searches: royalty-free, check each asset license before bundling.
- Freesound: useful, but license varies per file; prefer CC0 assets.

Music references can be stored as links or embeds without bundling audio files. For example:

- Alan Walker - Faded: reference/embed only; do not redistribute audio.
- Alan Walker - Fade: license history changed after the NCS era; verify current terms before using as an asset.
- YouTube meme-song compilations: taste references only unless each underlying track is independently licensed.

The safe path is to keep a `sound-packs/` or user-configured folder for files the user has the right to use, while the public repo ships generated WebAudio and clean-license pointers.

## Notes

The local SQLite database is generated under `data/` and intentionally ignored by git.
