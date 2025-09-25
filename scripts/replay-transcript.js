#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

const DEFAULT_HOST = process.env.CW_GUIDANCE_REPLAY_HOST || 'http://localhost:3000';
const DEFAULT_WAIT_MS = 5000;

function printHelp() {
  console.log(`WaveListener Transcript Replay CLI

Usage:
  node scripts/replay-transcript.js --dev --fixture <id> --session <sessionId> [--group <groupId>] [options]

Required:
  --dev                  Acknowledges this tool is for dev/staging only.
  --fixture <id>         Fixture id (file name without .json under guidance fixtures).
  --session <sessionId>  Active session id to target.

Recommended:
  --group <groupId>      Group id within the session (defaults to session id).

Options:
  --host <url>           Backend origin (default ${DEFAULT_HOST}).
  --speed <x>            Playback speed multiplier (default 1).
  --delay <ms>           Override ms between lines; combined with --speed.
  --loop <n>             Replay the fixture n times (default 1).
  --wait <ms>            Wait time after each replay to capture WS events (default ${DEFAULT_WAIT_MS}).
  --metrics              Print metrics summary from replay response.
  --help                 Show this help text.

Environment:
  CW_GUIDANCE_TRANSCRIPT_FIXTURES_ENABLED must be 1.
  CW_GUIDANCE_TRANSCRIPT_TOKEN must contain a teacher JWT for the target environment.
`);
}

function parseArgs(argv) {
  const opts = {
    dev: false,
    fixture: null,
    session: null,
    group: null,
    host: DEFAULT_HOST,
    speed: 1,
    delay: null,
    loop: 1,
    wait: DEFAULT_WAIT_MS,
    metrics: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--dev':
        opts.dev = true;
        break;
      case '--fixture':
        opts.fixture = argv[++i];
        break;
      case '--session':
        opts.session = argv[++i];
        break;
      case '--group':
        opts.group = argv[++i];
        break;
      case '--host':
        opts.host = argv[++i];
        break;
      case '--speed':
        opts.speed = Number(argv[++i] ?? 1);
        break;
      case '--delay':
        opts.delay = Number(argv[++i] ?? 0);
        break;
      case '--loop':
        opts.loop = Number(argv[++i] ?? 1);
        break;
      case '--wait':
        opts.wait = Number(argv[++i] ?? DEFAULT_WAIT_MS);
        break;
      case '--metrics':
        opts.metrics = true;
        break;
      case '--help':
        opts.help = true;
        break;
      default:
        console.warn(`Unknown argument: ${arg}`);
        break;
    }
  }

  return opts;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectGuidanceSocket({ host, token, sessionId }) {
  const socket = io(`${host}/guidance`, {
    auth: { token },
    transports: ['websocket'],
    reconnectionAttempts: 3,
  });

  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
    socket.on('error', reject);
  });

  socket.emit('guidance:subscribe', { subscriptions: ['insights', 'teacher_alerts', 'recommendations'] });
  socket.emit('session:guidance:subscribe', { sessionId });

  return socket;
}

function attachLogging(socket) {
  socket.on('ai:tier1:insight', (payload) => {
    console.log('\n[TIER1]', JSON.stringify({ groupId: payload?.groupId, gating: payload?.gating, topicalCohesion: payload?.insights?.topicalCohesion, conceptualDensity: payload?.insights?.conceptualDensity }, null, 2));
  });

  socket.on('ai:tier2:insight', (payload) => {
    console.log('\n[TIER2]', JSON.stringify({ groupId: payload?.groupId, summary: payload?.insights?.summary, collaboration: payload?.insights?.collaborationPatterns }, null, 2));
  });

  socket.on('teacher:recommendations', (prompts) => {
    const list = Array.isArray(prompts) ? prompts : [];
    list.forEach((prompt) => {
      console.log('\n[PROMPT]', JSON.stringify({
        id: prompt?.id,
        groupId: prompt?.groupId,
        category: prompt?.category,
        priority: prompt?.priority,
        why: prompt?.why,
      }, null, 2));
    });
  });

  socket.on('guidance:analytics', (event) => {
    console.log('\n[ANALYTICS]', JSON.stringify(event, null, 2));
  });
}

async function triggerReplay({ host, token, sessionId, groupId, fixtureId, speed, delay, metrics }) {
  const url = `${host.replace(/\/$/, '')}/api/v1/dev/guidance/fixtures/replay`;
  const payload = {
    fixtureId,
    sessionId,
    groupId,
    playback: {
      speedMultiplier: speed,
    },
  };

  if (typeof delay === 'number' && !Number.isNaN(delay)) {
    payload.playback.msBetweenLinesOverride = delay;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body?.message || `Replay request failed with ${response.status}`);
  }

  console.log(`\n✅ Replay complete: streamed ${body.streamed} lines in ${body.elapsedMs}ms (delay=${body.delayMs}ms)`);

  if (metrics && body?.metrics) {
    console.log('\n[METRICS]', JSON.stringify(body.metrics, null, 2));
  }
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (!opts.dev) {
    console.error('⚠️  This CLI requires --dev. It should only run against dev/staging environments.');
    process.exit(1);
  }

  if (process.env.CW_GUIDANCE_TRANSCRIPT_FIXTURES_ENABLED !== '1') {
    console.error('⚠️  CW_GUIDANCE_TRANSCRIPT_FIXTURES_ENABLED must be set to 1 before running this CLI.');
    process.exit(1);
  }

  if (!opts.fixture || !opts.session) {
    console.error('❌ Missing required arguments. Use --fixture and --session.');
    printHelp();
    process.exit(1);
  }

  const token = process.env.CW_GUIDANCE_TRANSCRIPT_TOKEN;
  if (!token) {
    console.error('❌ Set CW_GUIDANCE_TRANSCRIPT_TOKEN to a valid teacher JWT for the target backend.');
    process.exit(1);
  }

  const fixturePath = path.resolve(__dirname, '../src/__tests__/integration/guidance/fixtures', `${opts.fixture}.json`);
  if (!fs.existsSync(fixturePath)) {
    console.error(`❌ Fixture not found: ${fixturePath}`);
    process.exit(1);
  }

  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const groupId = opts.group || opts.session;

  console.log(`▶️  Replaying fixture '${opts.fixture}' (${fixture.metadata?.title || 'untitled'}) to session ${opts.session} / group ${groupId}`);

  const socket = await connectGuidanceSocket({ host: opts.host, token, sessionId: opts.session });
  attachLogging(socket);

  let runs = Number.isFinite(opts.loop) && opts.loop > 0 ? Math.floor(opts.loop) : 1;
  if (runs < 1) runs = 1;

  try {
    for (let iteration = 1; iteration <= runs; iteration += 1) {
      console.log(`\n--- Replay iteration ${iteration} of ${runs} ---`);
      await triggerReplay({
        host: opts.host,
        token,
        sessionId: opts.session,
        groupId,
        fixtureId: opts.fixture,
        speed: opts.speed,
        delay: opts.delay,
        metrics: opts.metrics,
      });

      if (iteration < runs && opts.wait > 0) {
        await sleep(opts.wait);
      }
    }

    if (opts.wait > 0) {
      console.log(`\n⏳ Waiting ${opts.wait}ms for trailing WebSocket events...`);
      await sleep(opts.wait);
    }
  } finally {
    socket.disconnect();
  }

  console.log('\nDone.');
})().catch((error) => {
  console.error('❌ Replay failed:', error.message || error);
  process.exit(1);
});

