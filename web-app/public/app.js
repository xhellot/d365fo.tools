let currentCommand = 'Get-D365Environment';
let isExecuting = false;

const LAST_JOB_KEY = 'd365fo.lastJobId';
const POLL_INTERVAL_MS = 1500;
let pollTimer = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  checkServerHealth();
  toggleServiceTarget('env');
  toggleServiceTarget('start');
  toggleServiceTarget('stop');
  toggleTier1Fields();
  toggleTier2Fields();
  restoreLastJob();
  refreshHistory();
  loadCatalog();
});

/* ---------------------------------------------------------------------------
 * Command catalog
 *
 * Every command in the module, with forms generated from its real parameter
 * metadata, so a field can never claim a parameter the cmdlet does not have.
 * ------------------------------------------------------------------------ */

const CURATED = new Set([
  'Get-D365Environment', 'Start-D365Environment', 'Stop-D365Environment',
  'New-D365Bacpac', 'Import-D365Bacpac', 'Invoke-D365DbSync'
]);

// Verbs that change or destroy state; these ask before running.
const DESTRUCTIVE_VERBS = new Set([
  'Remove', 'Clear', 'Stop', 'Disable', 'Uninstall', 'Reset', 'Rename', 'Set',
  'Import', 'Initialize', 'Invoke', 'Update', 'Switch', 'Repair', 'Restart'
]);

let catalog = null;
let catalogCommand = null;

async function loadCatalog() {
  const list = document.getElementById('catalog-list');

  try {
    const res = await fetch('/api/commands');

    // A server predating this route serves index.html here, so parsing the body
    // as JSON would fail with a syntax error that explains nothing.
    if (!(res.headers.get('content-type') || '').includes('application/json')) {
      throw new Error('the server returned a page instead of data, which usually means ' +
        'it is running an older build. Restart it (Ctrl+C, then npm start).');
    }

    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    catalog = await res.json();
  } catch (error) {
    list.innerHTML = `<div class="catalog-status catalog-error">Catalog unavailable: ${escapeHtml(error.message)}</div>`;
    return;
  }

  document.getElementById('catalog-count').textContent = catalog.commands.length;
  renderCatalog('');

  const search = document.getElementById('catalog-search');
  search.addEventListener('input', () => renderCatalog(search.value.trim()));
}

// Group by verb. Deriving an "area" from the noun was tried first and produced
// 74 groups with fragment names ("Aad", "Az", "S") because it has to guess where
// a noun's first word ends. The verb is real metadata, so it is always a sensible
// name, and it matches how PowerShell itself is organised.
function areaOf(command) {
  return command.verb || 'Other';
}

function renderCatalog(query) {
  const list = document.getElementById('catalog-list');
  const needle = query.toLowerCase();

  const matches = catalog.commands.filter(c =>
    !needle ||
    c.name.toLowerCase().includes(needle) ||
    (c.synopsis || '').toLowerCase().includes(needle));

  if (!matches.length) {
    list.innerHTML = '<div class="catalog-status">No commands match.</div>';
    return;
  }

  const groups = new Map();
  for (const command of matches) {
    const area = areaOf(command);
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(command);
  }

  // When searching, keep everything open so results are visible immediately.
  const expandAll = needle.length > 0;

  const html = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([area, commands]) => {
      const items = commands
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(c => `<button class="catalog-item" data-command="${escapeHtml(c.name)}" title="${escapeHtml(c.synopsis || c.name)}">${escapeHtml(c.name)}</button>`)
        .join('');

      return `<details class="catalog-group"${expandAll ? ' open' : ''}>
          <summary><span class="catalog-group-name">${escapeHtml(area)}</span><span class="catalog-group-count">${commands.length}</span></summary>
          <div class="catalog-items">${items}</div>
        </details>`;
    })
    .join('');

  list.innerHTML = html;

  list.querySelectorAll('.catalog-item').forEach(button => {
    button.addEventListener('click', () => showCatalogCommand(button.dataset.command));
  });
}

function showCatalogCommand(name) {
  const command = catalog.commands.find(c => c.name === name);
  if (!command) return;

  // A curated form is a better experience than a generated one, so prefer it.
  const curated = [...CURATED].find(c => c.toLowerCase() === name.toLowerCase());
  if (curated && document.getElementById(`form-${curated}`)) {
    document.querySelectorAll('.nav-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.command === curated));
    switchCommand(curated);
    return;
  }

  catalogCommand = command;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.catalog-item').forEach(b =>
    b.classList.toggle('selected', b.dataset.command === name));

  buildGeneratedForm(command);

  currentCommand = command.name;
  document.querySelectorAll('.command-form').forEach(f => f.classList.add('hidden'));
  document.getElementById('form-generated').classList.remove('hidden');
  updateOutputHeader(command.name);
}

// Decide how a parameter should be rendered from its declared type.
function fieldKindOf(parameter) {
  if (parameter.isSwitch) return 'checkbox';
  if (parameter.validateSet && parameter.validateSet.length) return 'select';

  switch (parameter.type) {
    case 'Int32':
    case 'Int64':
      return 'number';
    case 'Boolean':
      return 'bool';
    case 'SecureString':
      return 'password';
    case 'String':
    case 'String[]':
    case 'DateTime':
    case 'TimeSpan':
    case 'PathDirectoryParameter':
    case 'LcsAssetFileType':
      return /pwd|password/i.test(parameter.name) ? 'password' : 'text';
    default:
      return 'unsupported';
  }
}

function buildGeneratedForm(command) {
  const host = document.getElementById('form-generated');
  const sets = command.parameterSets || [];
  const defaultSet = sets.find(s => s.isDefault) || sets[0];

  host.innerHTML = '';

  const title = document.createElement('h2');
  title.textContent = command.name;
  host.appendChild(title);

  const description = document.createElement('p');
  description.className = 'description';
  description.textContent = command.synopsis || 'No description provided by the module.';
  host.appendChild(description);

  const form = document.createElement('form');
  form.id = 'generated-form';
  form.addEventListener('submit', event => executeCommand(event, command.name));

  // Only offer a chooser when the sets are genuinely different.
  if (sets.length > 1) {
    const group = document.createElement('div');
    group.className = 'form-group';
    group.innerHTML = `<label for="generated-set">Parameter set</label>`;

    const select = document.createElement('select');
    select.id = 'generated-set';
    for (const set of sets) {
      const option = document.createElement('option');
      option.value = set.name;
      option.textContent = set.name + (set.isDefault ? ' (default)' : '');
      option.selected = set === defaultSet;
      select.appendChild(option);
    }
    select.addEventListener('change', () => applyParameterSet(command, select.value));

    group.appendChild(select);
    const hint = document.createElement('small');
    hint.textContent = 'These parameter sets are mutually exclusive; only the selected one is sent.';
    group.appendChild(hint);
    host.appendChild(group);
  }

  for (const parameter of command.parameters) {
    form.appendChild(buildField(command, parameter));
  }

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn-primary';
  submit.textContent = `Run ${command.verb || ''}`.trim() || 'Run';
  submit.textContent = 'Run command';
  form.appendChild(submit);

  host.appendChild(form);

  if (defaultSet) applyParameterSet(command, defaultSet.name);
}

function buildField(command, parameter) {
  const kind = fieldKindOf(parameter);
  const group = document.createElement('div');
  group.className = 'form-group';
  group.dataset.parameter = parameter.name;

  const id = `gen-${parameter.name}`;
  const label = document.createElement('label');
  label.setAttribute('for', id);
  label.textContent = parameter.name + (parameter.mandatory ? ' *' : '');

  let input;
  switch (kind) {
    case 'checkbox':
      input = document.createElement('input');
      input.type = 'checkbox';
      break;

    case 'bool':
      input = document.createElement('select');
      for (const value of ['', 'true', 'false']) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value === '' ? '(not specified)' : value;
        input.appendChild(option);
      }
      break;

    case 'select':
      input = document.createElement('select');
      {
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = parameter.mandatory ? '(choose)' : '(not specified)';
        input.appendChild(blank);
      }
      for (const value of parameter.validateSet) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        input.appendChild(option);
      }
      break;

    case 'number':
      input = document.createElement('input');
      input.type = 'number';
      break;

    case 'password':
      input = document.createElement('input');
      input.type = 'password';
      break;

    case 'unsupported':
      input = document.createElement('input');
      input.type = 'text';
      input.disabled = true;
      input.placeholder = `${parameter.type} cannot be supplied from a web form`;
      break;

    default:
      input = document.createElement('input');
      input.type = 'text';
      if (parameter.isArray) input.placeholder = 'Comma-separated for multiple values';
      break;
  }

  input.id = id;
  if (kind !== 'unsupported') input.name = parameter.name;

  // Checkbox first, then caption, matching the curated forms.
  if (kind === 'checkbox') {
    group.appendChild(label);
    group.appendChild(input);
  } else {
    group.appendChild(label);
    group.appendChild(input);
  }

  const hintText = parameter.help ||
    (kind === 'unsupported' ? `Declared as ${parameter.type}. Run this command in PowerShell instead.` : '');
  if (hintText) {
    const hint = document.createElement('small');
    hint.textContent = hintText;
    group.appendChild(hint);
  }

  return group;
}

// Disabled inputs are skipped by FormData, so hiding a set also stops it being sent.
function applyParameterSet(command, setName) {
  const set = (command.parameterSets || []).find(s => s.name === setName);
  const allowed = set ? new Set(set.parameters) : null;

  document.querySelectorAll('#form-generated .form-group[data-parameter]').forEach(group => {
    const name = group.dataset.parameter;
    const input = group.querySelector('input, select');
    const inSet = !allowed || allowed.has(name);
    const parameter = command.parameters.find(p => p.name === name);
    const unsupported = parameter && fieldKindOf(parameter) === 'unsupported';

    group.style.display = inSet ? '' : 'none';
    if (input) input.disabled = !inSet || unsupported;
    if (!inSet && input) {
      if (input.type === 'checkbox') input.checked = false;
      else input.value = '';
    }
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Toggles between "All Services" and "Specific Services" for the Start/Stop forms.
// Disabled inputs are excluded from FormData, so this keeps the submitted params
// aligned with the cmdlet's mutually exclusive "All" vs specific-switch parameter sets.
function toggleServiceTarget(prefix) {
  const select = document.getElementById(`${prefix}-Target`);
  const isAll = select.value === 'all';
  const allCheckbox = document.getElementById(`${prefix}-All`);
  const specificContainer = document.getElementById(`${prefix}-specific-services`);
  const specificCheckboxes = specificContainer.querySelectorAll('input[type="checkbox"]');

  allCheckbox.checked = isAll;
  allCheckbox.disabled = !isAll;
  specificContainer.style.display = isAll ? 'none' : 'block';
  specificCheckboxes.forEach(cb => {
    cb.disabled = isAll;
    if (isAll) cb.checked = false;
  });
}

// BackupDirectory is only accepted in the ExportModeTier1 parameter set.
function toggleTier1Fields() {
  const mode = document.getElementById('backup-Mode');
  const group = document.getElementById('backup-tier1-only');
  if (!mode || !group) return;

  const isTier1 = mode.value === 'ExportModeTier1';
  group.style.display = isTier1 ? 'block' : 'none';
  group.querySelectorAll('input').forEach(input => {
    input.disabled = !isTier1;
    if (!isTier1) input.value = '';
  });
}

// Tier 2+ imports require the SQL user passwords; Tier 1 rejects them.
function toggleTier2Fields() {
  const mode = document.getElementById('restore-Mode');
  const group = document.getElementById('restore-tier2-fields');
  if (!mode || !group) return;

  const isTier2 = mode.value === 'ImportModeTier2';
  group.style.display = isTier2 ? 'block' : 'none';
  group.querySelectorAll('input').forEach(input => {
    input.disabled = !isTier2;
    if (!isTier2) input.value = '';
  });
}

function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      navButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Switch forms
      const command = btn.dataset.command;
      switchCommand(command);
    });
  });
}

function switchCommand(command) {
  currentCommand = command;

  // Hide all forms
  document.querySelectorAll('.command-form').forEach(form => {
    form.classList.add('hidden');
  });

  // Catalog commands have no hand-built form; they render into #form-generated.
  const form = document.getElementById(`form-${command}`);
  if (form) {
    form.classList.remove('hidden');
    document.querySelectorAll('.catalog-item').forEach(b => b.classList.remove('selected'));
  }

  // Update output
  updateOutputHeader(command);
}

// Curated commands own a form element; generated ones share #form-generated.
function submitButtonFor(command) {
  const curated = document.getElementById(`form-${command}`);
  if (curated) return curated.querySelector('button[type="submit"]');
  return document.querySelector('#form-generated button[type="submit"]');
}

function updateOutputHeader(command) {
  // Leave the header alone while a command is in flight, so switching tabs
  // doesn't make it look like a different command is running.
  if (isExecuting) return;
  document.getElementById('command-name').textContent = command;
  document.getElementById('execution-time').textContent = '';
}

async function executeCommand(event, command) {
  event.preventDefault();

  if (isExecuting) return;

  const form = event.target;
  const formData = new FormData(form);
  const params = {};

  // Selects whose chosen value is itself the name of a switch parameter
  // (e.g. the Tier 1 / Tier 2 mode). They carry no name, so FormData skips them.
  form.querySelectorAll('select[data-switch-select]').forEach(select => {
    if (select.value) params[select.value] = true;
  });

  formData.forEach((value, key) => {
    // Handle checkboxes
    if (form.querySelector(`[name="${key}"]`).type === 'checkbox') {
      params[key] = form.querySelector(`[name="${key}"]`).checked;
    } else if (value) {
      params[key] = value;
    }
  });

  // Generated forms cover the whole module, including commands that change or
  // destroy state. The curated six are already understood by the person
  // clicking them, so only confirm for the generated ones.
  if (catalogCommand && catalogCommand.name === command &&
      DESTRUCTIVE_VERBS.has(catalogCommand.verb)) {
    const summary = Object.entries(params)
      .map(([k, v]) => `  -${k} ${v === true ? '' : v}`.trimEnd())
      .join('\n') || '  (no parameters)';
    if (!window.confirm(`Run ${command}?\n\n${summary}\n\nThis can change or remove data on ${location.hostname}.`)) {
      return;
    }
  }

  const outputBox = document.getElementById('output');
  outputBox.textContent = 'Starting command...';
  outputBox.className = 'output-box';

  try {
    const response = await fetch('/api/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command, params })
    });

    const result = await response.json();

    if (!response.ok) {
      // Rejected before a job existed (unknown command, bad parameter).
      outputBox.textContent = result.error || 'Unknown error';
      outputBox.className = 'output-box error';
      document.getElementById('copy-btn').style.display = 'inline-block';
      return;
    }

    // The run now lives on the server; remember it so a refresh can rejoin it.
    localStorage.setItem(LAST_JOB_KEY, result.jobId);
    setRunningUi(command);
    pollJob(result.jobId);
  } catch (error) {
    outputBox.textContent = `Connection error: ${error.message}`;
    outputBox.className = 'output-box error';
  }
}

// Marks the submit button for `command` busy and locks out further submissions.
function setRunningUi(command) {
  isExecuting = true;
  const btn = submitButtonFor(command);
  if (btn) {
    if (!btn.dataset.idleText) btn.dataset.idleText = btn.textContent;
    btn.textContent = '⏳ Executing...';
    btn.disabled = true;
  }
  document.getElementById('command-name').textContent = command;
  document.getElementById('execution-time').textContent = '(running…)';
}

function clearRunningUi() {
  isExecuting = false;
  document.querySelectorAll('.command-form button[type="submit"]').forEach(btn => {
    if (btn.dataset.idleText) {
      btn.textContent = btn.dataset.idleText;
      delete btn.dataset.idleText;
    }
    btn.disabled = false;
  });
}

// Polls until the job leaves the running state, then renders it.
function pollJob(jobId) {
  clearTimeout(pollTimer);

  const tick = async () => {
    let job;
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (res.status === 404) {
        // Server restarted; its in-memory history is gone.
        localStorage.removeItem(LAST_JOB_KEY);
        clearRunningUi();
        return;
      }
      job = await res.json();
    } catch (error) {
      const outputBox = document.getElementById('output');
      outputBox.textContent = `Lost connection while waiting for the command: ${error.message}`;
      outputBox.className = 'output-box error';
      clearRunningUi();
      return;
    }

    if (job.status === 'running') {
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
      return;
    }

    renderJob(job);
    clearRunningUi();
    refreshHistory();
  };

  tick();
}

// Paints a job's result into the output pane.
function renderJob(job) {
  const outputBox = document.getElementById('output');
  document.getElementById('command-name').textContent = job.command;
  document.getElementById('copy-btn').style.display = 'inline-block';

  if (job.status === 'running') {
    outputBox.textContent = 'Command is still running on the server…';
    outputBox.className = 'output-box';
    document.getElementById('execution-time').textContent = '(running…)';
    return;
  }

  const seconds = job.durationMs != null ? (job.durationMs / 1000).toFixed(2) : '?';
  document.getElementById('execution-time').textContent = `(${seconds}s)`;

  if (job.status === 'success') {
    outputBox.textContent = job.output || 'Command completed successfully (no output)';
    outputBox.className = 'output-box success';
  } else {
    outputBox.textContent = job.error || 'Unknown error';
    outputBox.className = 'output-box error';
  }
}

// On load, reattach to whatever this browser last started.
async function restoreLastJob() {
  const jobId = localStorage.getItem(LAST_JOB_KEY);
  if (!jobId) return;

  try {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) {
      localStorage.removeItem(LAST_JOB_KEY);
      return;
    }

    const job = await res.json();

    // Only curated commands have a form to switch back to; for generated ones
    // the output is restored without reopening the form.
    if (document.getElementById(`form-${job.command}`)) {
      switchCommand(job.command);
      document.querySelectorAll('.nav-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.command === job.command);
      });
    }

    renderJob(job);

    if (job.status === 'running') {
      setRunningUi(job.command);
      pollJob(job.id);
    }
  } catch {
    /* server unreachable; checkServerHealth already reports that */
  }
}

async function refreshHistory() {
  const list = document.getElementById('history-list');
  if (!list) return;

  try {
    const res = await fetch('/api/jobs?limit=10');
    const { jobs } = await res.json();

    if (!jobs.length) {
      list.innerHTML = '<li class="history-empty">No commands run yet.</li>';
      return;
    }

    list.innerHTML = '';
    for (const job of jobs) {
      const li = document.createElement('li');
      li.className = 'history-item';
      li.tabIndex = 0;
      li.onclick = () => loadJob(job.id);
      li.onkeydown = e => { if (e.key === 'Enter') loadJob(job.id); };

      const when = new Date(job.startedAt).toLocaleTimeString();
      const secs = job.durationMs != null ? ` · ${(job.durationMs / 1000).toFixed(1)}s` : '';

      const badge = document.createElement('span');
      badge.className = `history-badge ${job.status}`;
      badge.textContent = job.status === 'running' ? 'running' : job.status;

      const label = document.createElement('span');
      label.className = 'history-label';
      label.textContent = job.command;

      const meta = document.createElement('span');
      meta.className = 'history-meta';
      meta.textContent = `${when}${secs}`;

      li.append(badge, label, meta);
      list.appendChild(li);
    }
  } catch {
    /* leave the previous list in place */
  }
}

async function loadJob(jobId) {
  const res = await fetch(`/api/jobs/${jobId}`);
  if (!res.ok) return;

  const job = await res.json();
  localStorage.setItem(LAST_JOB_KEY, job.id);
  renderJob(job);

  if (job.status === 'running') {
    setRunningUi(job.command);
    pollJob(job.id);
  }
}

function copyOutput() {
  const output = document.getElementById('output').textContent;
  navigator.clipboard.writeText(output).then(() => {
    const btn = document.getElementById('copy-btn');
    const originalText = btn.textContent;
    btn.textContent = '✓ Copied';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2000);
  });
}

function clearOutput() {
  document.getElementById('output').textContent = 'Output cleared. Ready for next command.';
  document.getElementById('output').className = 'output-box';
  document.getElementById('execution-time').textContent = '';
  document.getElementById('copy-btn').style.display = 'none';
  // Don't re-restore this run on the next refresh. The job itself stays on the
  // server and is still reachable from Recent runs.
  localStorage.removeItem(LAST_JOB_KEY);
}

async function checkServerHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    console.log('Server is running:', data);

    if (data.elevated === false) {
      document.getElementById('elevation-warning').classList.remove('hidden');
    }

    // F&O shows the environment in the command bar; ours shows the host it manages.
    if (data.machine) {
      document.getElementById('topbar-env').textContent = data.machine;
    }
  } catch (error) {
    console.error('Server connection failed:', error);
    document.getElementById('output').textContent =
      'Warning: Cannot connect to server. Make sure the app is running.';
    document.getElementById('output').className = 'output-box error';
  }
}
