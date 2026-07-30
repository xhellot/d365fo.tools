// Keeps command runs on the server so the browser can reconnect to them.
// A page refresh drops whatever the client was holding; the job outlives it,
// so an in-flight run can be resumed and a finished one can be read back.
//
// Deliberately in-memory: a job's PowerShell child process dies with this
// process anyway, so surviving a server restart would only resurrect entries
// whose work is already gone.

const MAX_JOBS = 50;

const jobs = new Map();
let nextId = 1;

// Params are echoed back to the browser, so never retain SQL or service
// account passwords in the store.
function redact(params) {
  const safe = {};
  for (const [key, value] of Object.entries(params || {})) {
    safe[key] = /pwd|password/i.test(key) ? '********' : value;
  }
  return safe;
}

function create(command, params) {
  const job = {
    id: String(nextId++),
    command,
    params: redact(params),
    status: 'running',
    output: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null
  };

  jobs.set(job.id, job);

  // Drop the oldest entries once the cap is passed (Map keeps insertion order).
  while (jobs.size > MAX_JOBS) {
    jobs.delete(jobs.keys().next().value);
  }

  return job;
}

function finish(id, { output, error }) {
  const job = jobs.get(id);
  if (!job) return;

  job.status = error ? 'error' : 'success';
  job.output = output ?? null;
  job.error = error ?? null;
  job.finishedAt = new Date().toISOString();
  job.durationMs = Date.parse(job.finishedAt) - Date.parse(job.startedAt);
}

function get(id) {
  return jobs.get(id) || null;
}

// Newest first, without the output payload so the history list stays small.
function list(limit = 15) {
  return [...jobs.values()]
    .reverse()
    .slice(0, limit)
    .map(({ output, error, ...rest }) => rest);
}

module.exports = { create, finish, get, list };
