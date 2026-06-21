import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { integrationPlan } from './connectors.js';
import { configureBrightData, discoverEntertainment, getDiscoveryStatus } from './discovery.js';
import { ioGames, pickIoGame } from './games.js';
import {
  addEntertainment,
  addEntertainmentItems,
  answerQuestion,
  completeShot,
  createShot,
  getDashboard,
  getSetting,
  startShot,
  updateSetting
} from './repository.js';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(rootDir, 'public');
const port = Number(process.env.PORT || 3177);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function handleApi(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/api/dashboard') {
      return sendJson(res, 200, getDashboard());
    }

    if (req.method === 'GET' && url.pathname === '/api/integrations') {
      return sendJson(res, 200, { ...integrationPlan, discovery: getDiscoveryStatus() });
    }

    if (req.method === 'POST' && url.pathname === '/api/integrations/bright-data') {
      const discovery = configureBrightData(await readJson(req));
      return sendJson(res, 200, { ...integrationPlan, discovery });
    }

    if (req.method === 'POST' && url.pathname === '/api/shots') {
      return sendJson(res, 201, createShot(await readJson(req)));
    }

    const startMatch = url.pathname.match(/^\/api\/shots\/(\d+)\/start$/);
    if (req.method === 'POST' && startMatch) {
      return sendJson(res, 200, startShot(Number(startMatch[1])));
    }

    const completeMatch = url.pathname.match(/^\/api\/shots\/(\d+)\/complete$/);
    if (req.method === 'POST' && completeMatch) {
      return sendJson(res, 200, completeShot(Number(completeMatch[1])));
    }

    const questionMatch = url.pathname.match(/^\/api\/shots\/(\d+)\/questions\/(\d+)$/);
    if (req.method === 'PATCH' && questionMatch) {
      const body = await readJson(req);
      return sendJson(res, 200, answerQuestion(Number(questionMatch[1]), Number(questionMatch[2]), body.answer));
    }

    if (req.method === 'POST' && url.pathname === '/api/entertainment') {
      return sendJson(res, 201, addEntertainment(await readJson(req)));
    }

    if (req.method === 'GET' && url.pathname === '/api/games') {
      return sendJson(res, 200, { games: ioGames });
    }

    if (req.method === 'POST' && url.pathname === '/api/games/roulette') {
      const game = pickIoGame(getSetting('lastIoGameUrl'));
      updateSetting('lastIoGameUrl', game.url);
      return sendJson(res, 201, {
        dashboard: getDashboard(),
        game
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/entertainment/discover') {
      const result = await discoverEntertainment();
      if (!result.status.configured) {
        return sendJson(res, 201, {
          ...getDashboard(),
          discovery: result.status,
          previewItems: result.items
        });
      }
      return sendJson(res, 201, {
        ...addEntertainmentItems(result.items),
        discovery: result.status
      });
    }

    if (req.method === 'PATCH' && url.pathname === '/api/settings') {
      const body = await readJson(req);
      return sendJson(res, 200, updateSetting(body.key, body.value));
    }

    return sendJson(res, 404, { error: 'Not found.' });
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }
}

function serveStatic(req, res, url) {
  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, { 'content-type': contentTypes[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    void handleApi(req, res, url);
    return;
  }
  serveStatic(req, res, url);
});

server.listen(port, () => {
  console.log(`one-shot cockpit running at http://localhost:${port}`);
});
