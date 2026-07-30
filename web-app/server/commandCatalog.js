const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const path = require('path');

const execFileAsync = promisify(execFile);

const SCRIPT_PATH = path.join(__dirname, 'introspect-commands.ps1');
const CACHE_PATH = path.join(__dirname, '..', 'command-catalog.cache.json');

// Building the catalog takes about a minute, nearly all of it Get-Help parsing
// comment-based help for 219 commands. It is cached to disk and rebuilt only
// when the installed module version changes.
let catalogPromise = null;

async function readInstalledVersion() {
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "(Get-Module -ListAvailable d365fo.tools | Sort-Object Version -Descending | " +
    "Select-Object -First 1).Version.ToString()"
  ], { maxBuffer: 1024 * 1024 });

  return stdout.trim();
}

async function readCache() {
  try {
    return JSON.parse(await fs.readFile(CACHE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function build() {
  console.log('Building the d365fo.tools command catalog (about a minute, cached afterwards)...');

  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH
  ], { maxBuffer: 64 * 1024 * 1024 });

  const catalog = JSON.parse(stdout);

  await fs.writeFile(CACHE_PATH, JSON.stringify(catalog), 'utf8');
  console.log(`Catalog ready: ${catalog.commands.length} commands (d365fo.tools ${catalog.moduleVersion}).`);

  return catalog;
}

async function load() {
  const cached = await readCache();

  if (cached && Array.isArray(cached.commands) && cached.commands.length) {
    // Only rebuild when the module itself changed; the version probe does not
    // import the module, so it costs about a second.
    try {
      const installed = await readInstalledVersion();
      if (installed && installed !== cached.moduleVersion) {
        console.log(`d365fo.tools changed (${cached.moduleVersion} -> ${installed}); rebuilding the catalog.`);
        return build();
      }
    } catch {
      // Version probe failed; the cache is still better than nothing.
    }

    console.log(`Catalog loaded from cache: ${cached.commands.length} commands (d365fo.tools ${cached.moduleVersion}).`);
    return cached;
  }

  return build();
}

function getCatalog() {
  if (!catalogPromise) {
    catalogPromise = load().catch(error => {
      // Let a later call retry rather than caching the failure forever.
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
}

function refresh() {
  catalogPromise = build().catch(error => {
    catalogPromise = null;
    throw error;
  });
  return catalogPromise;
}

async function getCommand(name) {
  const catalog = await getCatalog();
  const wanted = String(name).toLowerCase();
  return catalog.commands.find(c => c.name.toLowerCase() === wanted) || null;
}

/**
 * Turns catalog metadata into the shape the executor validates against.
 * Types map to how the parameter has to be rendered on a PowerShell command
 * line, which is not the same as how it is rendered in the browser.
 */
function toSpec(command) {
  const spec = { switches: [], strings: [], numbers: [], booleans: [], unsupported: [] };

  for (const parameter of command.parameters) {
    if (parameter.isSwitch) {
      spec.switches.push(parameter.name);
      continue;
    }

    switch (parameter.type) {
      case 'Int32':
      case 'Int64':
        spec.numbers.push(parameter.name);
        break;

      case 'Boolean':
        // A [bool] parameter genuinely takes $true/$false, unlike a switch.
        spec.booleans.push(parameter.name);
        break;

      case 'String':
      case 'String[]':
      case 'SecureString':
      case 'DateTime':
      case 'TimeSpan':
      case 'PathDirectoryParameter':
      case 'LcsAssetFileType':
        spec.strings.push(parameter.name);
        break;

      default:
        // Hashtable, PSCredential, PSObject and friends cannot be expressed as
        // a single text field, so the UI disables them rather than pretending.
        spec.unsupported.push(parameter.name);
        break;
    }
  }

  return spec;
}

module.exports = { getCatalog, refresh, getCommand, toSpec, CACHE_PATH };
