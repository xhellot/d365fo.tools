# D365 Finance & Operations Web Admin Tools

A modern web UI for managing Dynamics 365 Finance & Operations environments, replacing the command-line interface with an intuitive web application.

The service commands always act on the machine the server is running on — run it directly on the D365 box.

## Features

- **Every d365fo.tools command** - all 219 of them, with forms generated from the module's own parameter metadata
- **Environment Health Check** - Monitor D365 services (AOS, Batch, Financial Reporter, DMF)
- **Service Management** - Start and stop services independently, with selective control over which service(s) to target
- **Database Backup** - Create BACPAC files for disaster recovery
- **Database Restore** - Import BACPAC files to refresh environments
- **Database Sync** - Synchronize database after deployments

## Prerequisites

1. **Node.js** installed on your system (v14 or higher)
   - Download from: https://nodejs.org/

2. **PowerShell** with d365fo.tools module installed
   - Install with: `Install-Module -Name d365fo.tools`

3. **Windows Server** (the application runs PowerShell scripts)

## Quick setup on a new machine

One command does everything — Node.js, the `d365fo.tools` module, `npm install`,
and registering the boot-time task. It elevates itself, so you can run it from a
normal PowerShell window:

```powershell
& "path\to\web-app\bootstrap.ps1"
```

Or, on a machine with no clone of this repository at all:

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://github.com/xhellot/d365fo.tools/raw/master/web-app/bootstrap.ps1')))
```

The remote form downloads the repository to `C:\D365FO-WebApp` (override with
`-InstallPath`). Both forms are safe to re-run; every step is idempotent.

Useful switches: `-Port 8080`, `-SkipAutostart` (install but don't register the
task), `-UpdateModule` (reinstall d365fo.tools even if present).

Node.js is installed via winget when it is missing. If winget is unavailable the
script stops and tells you to install Node from nodejs.org, then re-run.

The manual steps below are still there if you would rather do it piece by piece.

## Installation & Setup

### 1. Install Dependencies

```powershell
cd "path\to\d365fo-web-app"
npm install
```

### 2. Start the Server

```powershell
npm start
```

You should see:
```
D365FO Web App running on http://localhost:3000
Press Ctrl+C to stop the server
```

### 3. Open in Browser

Navigate to: **http://localhost:3000**

## Starting automatically (no more `npm start`)

Run this once from an **elevated** PowerShell window:

```powershell
cd "path\to\web-app"
.\setup-autostart.ps1
```

That registers a scheduled task which runs the app as **SYSTEM** at boot, and
starts it immediately. SYSTEM is always elevated, which is what makes Start/Stop
Services work. Nobody has to be logged in, and it keeps running after you sign
out. Output goes to `server.log` in this folder (the previous run is kept as
`server.prev.log`).

To undo it:

```powershell
.\setup-autostart.ps1 -Remove
```

Other options, if you would rather not use a scheduled task:

| Approach | Elevated? | Starts at boot | Notes |
|---|---|---|---|
| `setup-autostart.ps1` (scheduled task as SYSTEM) | Yes | Yes | Recommended. No extra dependencies. |
| Windows service via the `node-windows` package | Yes | Yes | Real service semantics (`services.msc`, auto-restart), but adds an npm dependency. |
| Shortcut in the Startup folder | No | On sign-in only | Prompts for UAC every time, and service control fails if you decline. |
| `npm start` by hand | Only if the window is | No | What you are doing today. |

Note the app listens on **loopback only** (`127.0.0.1` and `::1`) — it is an
unauthenticated admin API that can stop services and overwrite databases, so it
should not be exposed. Setting `HOST` (or passing `-BindAddress`) overrides that;
the server prints a warning when it is reachable from the network.

## Usage

1. **Select a command** from the navigation buttons on the left
2. **Fill in the form** with required parameters
3. **Click the action button** to execute the command
4. **View output** in the output section below
5. **Copy results** if needed using the Copy button

### Runs survive a page refresh

Commands run on the server, not in the browser tab, so closing or refreshing the
page does not cancel or lose them:

- Refreshing **while a command is running** reconnects to it — the page shows it
  is still running and updates when it finishes.
- Refreshing **after it finished** restores the same output.
- **Recent runs** under the output pane lists the last runs with their status
  and duration. Click one to load its output again.
- **Clear** just clears the pane; the run stays in Recent runs.

The history lives in the server's memory, so restarting the server clears it
(a restart also kills any command that was still running).

### All commands

The six entries under **Common tasks** are hand-built forms. Everything else in
d365fo.tools appears under **All commands**, grouped by verb with a search box.

Those forms are generated from the module itself — the app runs `Get-Command`
against d365fo.tools and reads the real parameters, types, `ValidateSet` values,
parameter sets and help text. A field can therefore never offer a parameter the
cmdlet does not have. Switches become checkboxes, `ValidateSet` becomes a
dropdown, `[int]` becomes a number box, and parameters typed `PSCredential` or
`Hashtable` are shown disabled, since a text box cannot supply them — run those
in PowerShell.

Commands whose verb changes or removes state ask for confirmation first.

The catalog is built once (about a minute, nearly all of it reading help) and
cached in `command-catalog.cache.json`. It rebuilds automatically when the
installed module version changes, or on demand:

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/commands/refresh
```

### Common Tasks

#### Check Environment Health
- Click "Environment Health"
- Choose "All Services" or "Specific Services" (then check the ones you want)
- Click "Check Environment Status"

#### Start Services
- Click "Start Services"
- Choose "All Services" or "Specific Services" (then check the ones you want)
- Click "Start Services"

#### Stop Services
- Click "Stop Services"
- Choose "All Services" or "Specific Services" (then check the ones you want)
- Optionally check "Force Kill" to terminate services that won't stop gracefully
- Click "Stop Services"

#### Create Database Backup
- Click "Backup Database"
- Pick the Environment Tier (Tier 1 for SQL Server / onebox, Tier 2+ for Azure SQL) — this is required
- Provide the full output file path including the file name (e.g., `C:\Backups\AxDB.bacpac`)
- Click "Create Backup"

#### Restore Database
- Click "Restore Database"
- Pick the Environment Tier — this is required
- Provide the path to the BACPAC file and the new database name
- For Tier 2+, fill in the SQL user passwords that appear (axdeployextuser, axdbadmin, etc.)
- Click "Import BACPAC"

#### Sync Database
- Click "Sync Database"
- Leave Sync Mode on `FullAll` unless you need a targeted sync
- Click "Start Sync"
- Wait for sync to complete (can take several minutes)

## Troubleshooting

### Services don't actually start or stop

**The server must be run as Administrator.** Service control requires elevation,
and the underlying cmdlets call `Stop-Service`/`Start-Service` with
`-ErrorAction SilentlyContinue` — so without elevation they fail *silently* and
then report the untouched services as their result, which looks like success.

The app guards against this: it refuses Start/Stop when not elevated, shows a
warning banner in the UI, and prints a warning on startup. If you see any of
those, stop the server and relaunch it:

```
Right-click PowerShell -> Run as Administrator
cd "path\to\web-app"
npm start
```

### Server won't start
- Make sure Node.js is installed: `node --version`
- Check that port 3000 is not in use

### PowerShell commands fail
- Verify d365fo.tools is installed: `Get-Module -ListAvailable d365fo.tools`
- Make sure the server is running as Administrator (see above)
- Check that the D365 environment is accessible

### BACPAC operations timeout
- These can take a long time for large databases (1-2+ hours)
- Adjust the timeout in PowerShell if needed
- Run during off-peak hours for production

## Advanced Configuration

### Change Server Port
Edit `server/index.js` and change:
```javascript
const PORT = process.env.PORT || 3000;
```

To:
```javascript
const PORT = process.env.PORT || 8080; // or any port you prefer
```

### Run on Startup (Windows)

Create a batch file `start-app.bat`:
```batch
@echo off
cd /d "C:\path\to\d365fo-web-app"
node server\index.js
pause
```

Schedule it as a Windows Task to run at startup.

## Architecture

```
Frontend (HTML/CSS/JavaScript)
         ↓
Express.js API Server (Node.js)
         ↓
PowerShell Executor
         ↓
d365fo.tools Module
         ↓
D365 Finance & Operations Services
```

## File Structure

```
d365fo-web-app/
├── server/
│   ├── index.js              # Express server
│   └── powerShellExecutor.js # PowerShell command executor
├── public/
│   ├── index.html            # Main UI
│   ├── app.js                # Frontend logic
│   └── styles.css            # Styling
├── package.json              # Node dependencies
└── README.md                 # This file
```

## Security Notes

- This application is designed for **local/on-premise use only**
- No authentication is configured - intended for internal admin use
- All PowerShell commands run with the privileges of the user running Node.js
- **Run the server as Administrator** for full functionality
- Do not expose this application to the internet without proper security measures

## Future Enhancements

- [ ] Add more functions (Deploy packages, enable/disable flights, etc.)
- [ ] Add command history and scheduling
- [ ] Add user authentication and role-based access
- [ ] Real-time service monitoring dashboard
- [ ] Email notifications for long-running operations
- [ ] Database migration wizard
- [ ] Automated daily backup scheduling

## Support

For issues with:
- **d365fo.tools module**: See https://github.com/d365collaborative/d365fo.tools
- **This web app**: Check the troubleshooting section above or contact your administrator

## License

This web app wrapper is provided as-is. The underlying d365fo.tools module maintains its own license.
