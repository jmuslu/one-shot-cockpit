import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { specPrompt } from './prepGraph.js';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

export const RUNNER_PROVIDERS = [
  {
    id: 'codex',
    name: 'OpenAI Codex',
    authMode: 'local-browser-auth',
    command: 'codex',
    tagline: 'Uses local Codex auth. Connect with codex login, then dispatch with codex exec.'
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    authMode: 'local-browser-auth',
    command: 'claude',
    tagline: 'Uses local Claude Code auth when the claude CLI is installed.'
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    authMode: 'planned-oauth',
    command: '',
    tagline: 'Planned provider adapter. Kept visible as a future runner option.'
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    authMode: 'planned-oauth',
    command: 'gemini',
    tagline: 'Planned provider adapter. Can use local Gemini CLI auth once wired.'
  }
];

export function findProvider(id) {
  return RUNNER_PROVIDERS.find((provider) => provider.id === id) || null;
}

function commandAvailable(command) {
  if (!command) {
    return false;
  }
  const check = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], {
    encoding: 'utf8',
    shell: false
  });
  return check.status === 0;
}

export function providerRuntimeStatus(provider) {
  const available = commandAvailable(provider.command);
  return {
    commandAvailable: available,
    canExecute: available && process.env.ONESHOT_RUNNER_EXECUTE === 'true'
  };
}

function ensureWorkspace(workspace) {
  const absolute = join(rootDir, workspace || 'outputs/shot-unknown');
  mkdirSync(absolute, { recursive: true });
  return absolute;
}

function writeDispatchPackage(provider, sessionId, context = {}) {
  const workspace = ensureWorkspace(context.workspace);
  const spec = context.spec || {};
  const prompt = specPrompt(spec);
  const specPath = join(workspace, 'one-shot-spec.json');
  const promptPath = join(workspace, 'runner-prompt.md');
  const resultPath = join(workspace, 'runner-result.md');
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  writeFileSync(promptPath, prompt);

  const runtime = providerRuntimeStatus(provider);
  if (runtime.canExecute && provider.id === 'codex') {
    const outputPath = join(workspace, 'codex-last-message.md');
    const result = spawnSync('codex', [
      'exec',
      '--cd', workspace,
      '--sandbox', 'workspace-write',
      '--ask-for-approval', 'never',
      '--output-last-message', outputPath,
      '-'
    ], {
      input: prompt,
      encoding: 'utf8',
      timeout: 1000 * 60 * 20,
      cwd: workspace
    });
    const body = [
      `# ${provider.name} dispatch`,
      '',
      `Session: ${sessionId}`,
      `Command exit: ${result.status ?? 'unknown'}`,
      '',
      '## stdout',
      result.stdout || '',
      '## stderr',
      result.stderr || ''
    ].join('\n');
    writeFileSync(resultPath, body);
    return {
      summary: result.status === 0
        ? `${provider.name} ran through local codex exec. See runner-result.md and codex-last-message.md.`
        : `${provider.name} command returned a non-zero exit. See runner-result.md.`,
      artifact: workspace
    };
  }

  const mode = runtime.commandAvailable
    ? 'Command is installed, but ONESHOT_RUNNER_EXECUTE is not true, so this run exported a dispatch package.'
    : 'Command is not installed here, so this run exported a dispatch package.';
  writeFileSync(resultPath, [
    `# ${provider.name} dispatch package`,
    '',
    mode,
    '',
    `Session: ${sessionId}`,
    `Spec: ${specPath}`,
    `Prompt: ${promptPath}`,
    '',
    'To run manually:',
    provider.id === 'codex'
      ? 'codex exec --cd . --sandbox workspace-write --ask-for-approval never - < runner-prompt.md'
      : `${provider.command || provider.id} < runner-prompt.md`
  ].join('\n'));

  return {
    summary: `${provider.name} prepared a validated one-shot dispatch package. ${mode}`,
    artifact: workspace
  };
}

const packageAdapter = {
  startSession() {
    return {
      sessionId: randomUUID(),
      questions: []
    };
  },
  answer() {},
  run(sessionId, context = {}) {
    const provider = findProvider(context.spec?.runnerProvider) || findProvider(context.providerId) || {
      id: 'simulated',
      name: context.providerName || 'Runner',
      command: ''
    };
    return writeDispatchPackage(provider, sessionId, context);
  }
};

export function getAdapter() {
  return packageAdapter;
}
