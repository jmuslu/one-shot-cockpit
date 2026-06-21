export const GRAPH_TYPES = [
  'goal',
  'audience',
  'stack',
  'scope',
  'acceptance',
  'validation',
  'artifact'
];

const stackSignals = [
  ['react', 'React frontend'],
  ['vite', 'Vite app'],
  ['next', 'Next.js app'],
  ['node', 'Node.js backend'],
  ['sqlite', 'SQLite storage'],
  ['three', 'Three.js visual layer'],
  ['canvas', 'Canvas interaction'],
  ['tailwind', 'Tailwind styling'],
  ['local', 'Local-first web app']
];

function has(text, pattern) {
  return pattern.test(String(text || ''));
}

function firstSentence(text) {
  return String(text || '').split(/[.!?]\s/)[0]?.trim() || '';
}

export function inferPrepGraph({ title, prompt }) {
  const text = `${title}\n${prompt}`;
  const lower = text.toLowerCase();
  const stackHits = stackSignals.filter(([needle]) => lower.includes(needle)).map(([, label]) => label);
  const stack = stackHits.length ? stackHits.join(', ') : 'Local web app, minimal dependencies';
  const audience = has(text, /\b(for|users?|audience|makers?|teams?|students?|founders?|creators?)\b/i)
    ? firstSentence(prompt)
    : '';
  const acceptance = has(text, /\b(done|success|must[- ]?have|acceptance|criteria|ship|deliver|export|zip)\b/i)
    ? firstSentence(prompt)
    : '';

  return [
    {
      type: 'goal',
      label: 'Goal',
      value: firstSentence(prompt) || title,
      status: 'inferred',
      confidence: 0.88
    },
    {
      type: 'audience',
      label: 'Audience',
      value: audience,
      status: audience ? 'inferred' : 'needs-user',
      confidence: audience ? 0.58 : 0.12
    },
    {
      type: 'stack',
      label: 'Stack',
      value: stack,
      status: stackHits.length ? 'inferred' : 'assumed',
      confidence: stackHits.length ? 0.72 : 0.42
    },
    {
      type: 'scope',
      label: 'Scope',
      value: 'One finished pass, no follow-up chat inside the completed shot.',
      status: 'assumed',
      confidence: 0.74
    },
    {
      type: 'acceptance',
      label: 'Done means',
      value: acceptance,
      status: acceptance ? 'inferred' : 'needs-user',
      confidence: acceptance ? 0.62 : 0.12
    },
    {
      type: 'validation',
      label: 'Self-validation',
      value: 'Runner must inspect output, run available checks, and report what passed or could not be verified.',
      status: 'assumed',
      confidence: 0.76
    },
    {
      type: 'artifact',
      label: 'Export',
      value: 'Workspace folder plus zip-ready files for external refinement.',
      status: 'assumed',
      confidence: 0.7
    }
  ];
}

export function readinessQuestions(nodes) {
  const byType = Object.fromEntries(nodes.map((node) => [node.type, node]));
  const questions = [];
  if (!byType.audience?.value) {
    questions.push({
      graphKey: 'audience',
      question: 'Who is this for, and what should they be able to do immediately?'
    });
  }
  if (!byType.acceptance?.value) {
    questions.push({
      graphKey: 'acceptance',
      question: 'What does done look like for this one shot? Name the one must-have outcome.'
    });
  }
  if ((byType.stack?.confidence || 0) < 0.5) {
    questions.push({
      graphKey: 'stack',
      question: 'Should the runner assume a local web app stack, or do you want a specific stack?'
    });
  }
  return questions.slice(0, 3);
}

export function applyGraphAnswer(nodes, graphKey, answer) {
  return nodes.map((node) => {
    if (node.type !== graphKey) {
      return node;
    }
    return {
      ...node,
      value: String(answer || '').trim(),
      status: 'confirmed',
      confidence: 0.95
    };
  });
}

export function graphReady(nodes) {
  return readinessQuestions(nodes).length === 0;
}

export function buildOneShotSpec(shot, nodes, answers = []) {
  const graph = Object.fromEntries(nodes.map((node) => [node.type, {
    label: node.label,
    value: node.value,
    status: node.status,
    confidence: node.confidence
  }]));
  return {
    version: 1,
    shotId: shot.id,
    title: shot.title,
    brief: shot.prompt,
    runnerProvider: shot.runner_provider,
    workspace: shot.workspace,
    graph,
    answers: answers.map((answer) => ({
      question: answer.question,
      answer: answer.answer
    })),
    rules: [
      'Build in one pass from this spec.',
      'Do not ask follow-up questions after dispatch.',
      'Validate the output before completion.',
      'Return an artifact path and concise handoff notes.'
    ]
  };
}

export function specPrompt(spec) {
  return [
    `One-Shot Cockpit dispatch: ${spec.title}`,
    '',
    'You are receiving a finalized one-shot project spec. Build the artifact in the workspace.',
    'Do not ask follow-up questions. If an assumption is imperfect, make the smallest reasonable choice and record it.',
    '',
    'Spec JSON:',
    JSON.stringify(spec, null, 2),
    '',
    'Finish by reporting:',
    '- artifact path',
    '- validation performed',
    '- any assumptions made'
  ].join('\n');
}
