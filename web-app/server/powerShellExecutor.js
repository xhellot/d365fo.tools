const { execFile } = require('child_process');
const { promisify } = require('util');
const catalog = require('./commandCatalog');

const execFileAsync = promisify(execFile);

// Hand-tuned specs for the commands that have a purpose-built form. Everything
// else in the module is validated against the introspected catalog instead, so
// the two paths agree on the one rule that matters: switches take no value.
//
// Parameters each command actually accepts, grouped by how they must be rendered.
// Switches take no value in PowerShell; passing "-Switch $true" binds the value to
// the next positional parameter instead, so the distinction matters.
//
// The service cmdlets also accept -ComputerName, but the curated forms only ever
// manage the machine the app runs on, so it is deliberately omitted here: the
// cmdlets default to the local machine.
const COMMANDS = {
  'Get-D365Environment': {
    switches: ['All', 'Aos', 'Batch', 'FinancialReporter', 'DMF', 'OnlyStartTypeAutomatic', 'OutputServiceDetailsOnly'],
    strings: [],
    numbers: []
  },
  'Start-D365Environment': {
    switches: ['All', 'Aos', 'Batch', 'FinancialReporter', 'DMF', 'OnlyStartTypeAutomatic', 'ShowOriginalProgress'],
    strings: [],
    numbers: []
  },
  'Stop-D365Environment': {
    switches: ['All', 'Aos', 'Batch', 'FinancialReporter', 'DMF', 'Kill', 'ShowOriginalProgress'],
    strings: [],
    numbers: []
  },
  'New-D365Bacpac': {
    switches: ['ExportModeTier1', 'ExportModeTier2', 'ExportOnly', 'ShowOriginalProgress'],
    strings: ['DatabaseServer', 'DatabaseName', 'SqlUser', 'SqlPwd', 'BackupDirectory',
      'NewDatabaseName', 'BacpacFile', 'CustomSqlFile', 'DiagnosticFile'],
    numbers: ['MaxParallelism']
  },
  'Import-D365Bacpac': {
    switches: ['ImportModeTier1', 'ImportModeTier2', 'ImportOnly', 'ShowOriginalProgress'],
    strings: ['DatabaseServer', 'DatabaseName', 'SqlUser', 'SqlPwd', 'BacpacFile', 'NewDatabaseName',
      'AxDeployExtUserPwd', 'AxDbAdminPwd', 'AxRuntimeUserPwd', 'AxMrRuntimeUserPwd',
      'AxRetailRuntimeUserPwd', 'AxRetailDataSyncUserPwd', 'AxDbReadonlyUserPwd',
      'CustomSqlFile', 'ModelFile', 'DiagnosticFile', 'LogPath'],
    numbers: ['MaxParallelism']
  },
  'Invoke-D365DBSync': {
    switches: ['ShowOriginalProgress'],
    strings: ['BinDirTools', 'MetadataDir', 'SyncMode', 'Verbosity', 'DatabaseServer',
      'DatabaseName', 'SqlUser', 'SqlPwd', 'LogPath'],
    numbers: []
  }
};

// Service control needs Administrator rights, and these two cmdlets call
// Stop-Service/Start-Service with -ErrorAction SilentlyContinue: an access-denied
// failure produces no error at all, and the cmdlet goes on to report the
// untouched services as its result, which reads as success. Refuse up front.
//
// Deliberately not listed: the database commands. They surface their own
// failures, and some (a Tier 2+ bacpac against Azure SQL) legitimately work
// without local elevation, so blocking them would be a regression.
const REQUIRES_ELEVATION = new Set([
  'Start-D365Environment',
  'Stop-D365Environment'
]);

// Writes straight to stderr and exits rather than using `throw`, whose stack
// and positional decoration would bury the message in the UI's output pane.
const ELEVATION_GUARD =
  '$__admin = (New-Object Security.Principal.WindowsPrincipal(' +
  '[Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole(' +
  '[Security.Principal.WindowsBuiltInRole]::Administrator); ' +
  'if (-not $__admin) { [Console]::Error.WriteLine(' +
  '"This command requires Administrator rights, but the web app is not running elevated.`n`n' +
  'Stop the server (Ctrl+C) and start it again from a PowerShell window opened with `"Run as Administrator`".`n`n' +
  'Note: without elevation the D365 cmdlets fail silently -- they report the services as still running ' +
  'instead of raising an error."); exit 1 }';

// Single-quoted PowerShell literals don't expand $variables; '' is the escaped quote.
function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// A curated spec when one exists, otherwise the catalog's view of the command.
// Returns null when the module has no such command at all.
async function resolveSpec(command) {
  if (COMMANDS[command]) return COMMANDS[command];

  const described = await catalog.getCommand(command);
  if (!described) return null;

  // Use the catalog's canonical casing so the emitted script matches the module.
  return { ...catalog.toSpec(described), canonicalName: described.name };
}

function buildPowerShellCommand(command, params, spec) {
  if (!spec) {
    spec = COMMANDS[command];
    if (!spec) {
      throw new Error(`Unknown command: ${command}`);
    }
  }

  const args = [];
  const booleans = spec.booleans || [];
  const unsupported = spec.unsupported || [];

  for (const [key, value] of Object.entries(params || {})) {
    if (value === null || value === undefined || value === '') continue;

    if (spec.switches.includes(key)) {
      // Only emit the switch when enabled; omitting it is how you say "false".
      if (value === true || value === 'true') args.push(`-${key}`);
      continue;
    }

    if (booleans.includes(key)) {
      // A real [bool] parameter, which unlike a switch does take a value.
      args.push(`-${key} $${value === true || value === 'true' ? 'true' : 'false'}`);
      continue;
    }

    if (spec.numbers.includes(key)) {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        throw new Error(`Parameter '${key}' must be a number, got: ${value}`);
      }
      args.push(`-${key} ${num}`);
      continue;
    }

    if (spec.strings.includes(key)) {
      args.push(`-${key} ${quote(value)}`);
      continue;
    }

    if (unsupported.includes(key)) {
      throw new Error(
        `Parameter '${key}' takes a type this web UI cannot supply. Run ${command} in PowerShell instead.`);
    }

    throw new Error(`Parameter '${key}' is not valid for ${command}`);
  }

  const name = spec.canonicalName || command;
  const invocation = `${name} ${args.join(' ')}`.trim();
  const guard = REQUIRES_ELEVATION.has(name) ? `${ELEVATION_GUARD} ` : '';

  return `${guard}Import-Module d365fo.tools -Force; ${invocation}`;
}

// Cached because it cannot change for the lifetime of the server process.
let elevationPromise = null;

function isElevated() {
  if (!elevationPromise) {
    elevationPromise = execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '(New-Object Security.Principal.WindowsPrincipal(' +
      '[Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole(' +
      '[Security.Principal.WindowsBuiltInRole]::Administrator)'])
      .then(({ stdout }) => stdout.trim() === 'True')
      .catch(() => false);
  }
  return elevationPromise;
}

async function execPowerShell(command, params = {}, spec = null) {
  const resolved = spec || await resolveSpec(command);
  const psCmd = buildPowerShellCommand(command, params, resolved);

  try {
    // execFile (no shell) passes the script as one argv entry, so the script text
    // is never re-parsed by an outer shell that would expand $ tokens.
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psCmd],
      { maxBuffer: 10 * 1024 * 1024 }
    );

    if (stderr) {
      // Some PowerShell commands write to stderr but still succeed
      return `${stdout}${stderr}`.trim();
    }

    return stdout.trim();
  } catch (error) {
    const output = error.stdout || '';
    const errMsg = error.stderr || error.message;
    throw new Error(`${output}\nError: ${errMsg}`.trim());
  }
}

module.exports = { execPowerShell, buildPowerShellCommand, resolveSpec, isElevated };
