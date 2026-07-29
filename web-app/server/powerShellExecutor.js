const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Map of available commands to their PowerShell function names
const COMMAND_MAP = {
  'Get-D365Environment': 'Get-D365Environment',
  'Restart-D365Environment': 'Restart-D365Environment',
  'New-D365Bacpac': 'New-D365Bacpac',
  'Import-D365Bacpac': 'Import-D365Bacpac',
  'Invoke-D365DBSync': 'Invoke-D365DBSync'
};

// Build PowerShell command with parameters
function buildPowerShellCommand(command, params) {
  if (!COMMAND_MAP[command]) {
    throw new Error(`Unknown command: ${command}`);
  }

  let psCmd = `Import-Module d365fo.tools -Force; ${command}`;

  // Add parameters if provided
  if (params && Object.keys(params).length > 0) {
    const paramStr = Object.entries(params)
      .filter(([_, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => {
        // Handle different value types
        if (typeof value === 'boolean') {
          return `-${key} $${value}`;
        } else if (typeof value === 'number') {
          return `-${key} ${value}`;
        } else {
          // String - escape quotes
          const escaped = String(value).replace(/"/g, '\\"');
          return `-${key} "${escaped}"`;
        }
      })
      .join(' ');

    psCmd += ` ${paramStr}`;
  }

  return psCmd;
}

async function execPowerShell(command, params = {}) {
  try {
    const psCmd = buildPowerShellCommand(command, params);

    // Execute PowerShell command
    const { stdout, stderr } = await execAsync(
      `powershell.exe -Command "${psCmd}"`,
      {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
        shell: 'powershell.exe'
      }
    );

    if (stderr) {
      // Some PowerShell commands write to stderr but still succeed
      return `${stdout}${stderr}`.trim();
    }

    return stdout.trim();
  } catch (error) {
    // Capture both stdout and stderr from failed execution
    const output = error.stdout || '';
    const errMsg = error.stderr || error.message;
    const combined = `${output}\nError: ${errMsg}`.trim();
    throw new Error(combined);
  }
}

module.exports = { execPowerShell };
