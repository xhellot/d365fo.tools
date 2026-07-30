const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const os = require('os');
const { execPowerShell, buildPowerShellCommand, resolveSpec, isElevated } = require('./powerShellExecutor');
const jobStore = require('./jobStore');
const commandCatalog = require('./commandCatalog');

const app = express();
const PORT = process.env.PORT || 3000;

// Loopback only by default. This API stops services and restores databases with
// no authentication, so it must not be reachable from the network unless someone
// deliberately opts in by setting HOST (e.g. HOST=0.0.0.0).
//
// Both loopback families, because on Windows "localhost" resolves to ::1 first:
// an IPv4-only bind leaves clients that don't fall back to IPv4 (.NET, and thus
// Invoke-RestMethod) unable to reach a perfectly healthy server.
const HOST = process.env.HOST || null;
const HOSTS = HOST ? [HOST] : ['127.0.0.1', '::1'];

app.use(cors());
app.use(bodyParser.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Starts a command and returns immediately with a job id. The run continues
// server-side, so a page refresh (or an hour-long bacpac) does not lose it.
app.post('/api/execute', async (req, res) => {
  const { command, params } = req.body;

  if (!command) {
    return res.status(400).json({ error: 'Command is required' });
  }

  // Reject bad input before creating a job, so the caller still gets an
  // immediate, specific error rather than having to poll for a failure.
  let spec;
  try {
    spec = await resolveSpec(command);
    if (!spec) {
      return res.status(400).json({ success: false, error: `Unknown command: ${command}` });
    }
    buildPowerShellCommand(command, params, spec);
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  const job = jobStore.create(spec.canonicalName || command, params);

  execPowerShell(command, params, spec)
    .then(output => jobStore.finish(job.id, { output }))
    .catch(error => jobStore.finish(job.id, { error: error.message }));

  res.status(202).json({ jobId: job.id, command: job.command, status: job.status });
});

// The full command catalog, introspected from the installed module.
app.get('/api/commands', async (req, res) => {
  try {
    const catalog = await commandCatalog.getCatalog();
    res.json(catalog);
  } catch (error) {
    res.status(503).json({ error: `Command catalog unavailable: ${error.message}` });
  }
});

// Force a rebuild, e.g. after updating d365fo.tools without restarting.
app.post('/api/commands/refresh', async (req, res) => {
  try {
    const catalog = await commandCatalog.refresh();
    res.json({ commands: catalog.commands.length, moduleVersion: catalog.moduleVersion });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Recent runs, newest first (no output payload).
app.get('/api/jobs', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 15, 50);
  res.json({ jobs: jobStore.list(limit) });
});

// A single run, including its output. This is what the page reads on load to
// restore whatever was on screen before the refresh.
app.get('/api/jobs/:id', (req, res) => {
  const job = jobStore.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'No such job' });
  }
  res.json(job);
});

// Health check
app.get('/api/health', async (req, res) => {
  res.json({
    status: 'ok',
    elevated: await isElevated(),
    machine: os.hostname(),
    timestamp: new Date().toISOString()
  });
});

// An unknown /api route must not fall through to the catch-all below. Serving
// index.html for it makes the caller's JSON.parse fail with "Unexpected token
// '<'", which points nowhere near the real problem (usually a stale server
// process that predates the route).
app.use('/api', (req, res) => {
  res.status(404).json({
    error: `No such API route: ${req.method} ${req.originalUrl}. ` +
      'If this route should exist, the server is running an older build - restart it.'
  });
});

// Serve the main HTML file for all routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const isLoopback = host => host === '127.0.0.1' || host === '::1' || host === 'localhost';

async function announce(bound) {
  console.log(`D365FO Web App running on http://localhost:${PORT}`);
  console.log(`  listening on: ${bound.join(', ')}`);

  if (bound.some(host => !isLoopback(host))) {
    console.warn('');
    console.warn('  WARNING: reachable from the network, not just this machine.');
    console.warn('  This API has no authentication and can stop services and overwrite');
    console.warn('  databases. Unset HOST to go back to loopback-only.');
    console.warn('');
  }

  if (!(await isElevated())) {
    console.warn('');
    console.warn('  WARNING: not running as Administrator.');
    console.warn('  Starting and stopping D365 services will fail. Restart this');
    console.warn('  server from a PowerShell window opened with "Run as Administrator".');
    console.warn('');
  }

  console.log('Press Ctrl+C to stop the server');

  // Warm the catalog now rather than making the first browser request wait out
  // a cold build.
  commandCatalog.getCatalog().catch(error => {
    console.warn(`  Could not build the command catalog: ${error.message}`);
  });
}

const bound = [];
let settled = 0;

function onSettled() {
  if (++settled < HOSTS.length) return;

  if (!bound.length) {
    console.error(`Could not listen on port ${PORT} on any of: ${HOSTS.join(', ')}`);
    process.exit(1);
  }
  announce(bound);
}

for (const host of HOSTS) {
  const server = app.listen(PORT, host);

  server.on('listening', () => {
    bound.push(host);
    onSettled();
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use (${host}). Is the app already running?`);
      process.exit(1);
    }
    // An unavailable address family (IPv6 disabled) is fine as long as the other
    // one bound; onSettled() fails only when nothing at all is listening.
    console.warn(`  note: could not bind ${host} (${err.code})`);
    onSettled();
  });
}
