# D365 Finance & Operations Web Admin Tools

A modern web UI for managing Dynamics 365 Finance & Operations environments, replacing the command-line interface with an intuitive web application.

## Features

- **Environment Health Check** - Monitor D365 services (AOS, Batch, Financial Reporter, DMF)
- **Service Management** - Restart services with selective control
- **Database Backup** - Create BACPAC files for disaster recovery
- **Database Restore** - Import BACPAC files to refresh environments
- **Database Sync** - Synchronize database after deployments

## Prerequisites

1. **Node.js** installed on your system (v14 or higher)
   - Download from: https://nodejs.org/

2. **PowerShell** with d365fo.tools module installed
   - Install with: `Install-Module -Name d365fo.tools`

3. **Windows Server** (the application runs PowerShell scripts)

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

## Usage

1. **Select a command** from the navigation buttons at the top
2. **Fill in the form** with required parameters
3. **Click the action button** to execute the command
4. **View output** in the output section below
5. **Copy results** if needed using the Copy button

### Common Tasks

#### Check Environment Health
- Click "Environment Health"
- Leave Computer Name blank for local machine
- Click "Check Environment Status"

#### Restart Services
- Click "Restart Services"
- Select which service(s) to restart (or leave blank for all)
- Click "Restart Services"

#### Create Database Backup
- Click "Backup Database"
- Provide output directory path (e.g., `C:\Backups`)
- Click "Create Backup"
- Note the backup file path from the output

#### Restore Database
- Click "Restore Database"
- Provide the path to the BACPAC file created above
- Click "Import BACPAC"

#### Sync Database
- Click "Sync Database"
- Click "Start Sync"
- Wait for sync to complete (can take several minutes)

## Troubleshooting

### Server won't start
- Make sure Node.js is installed: `node --version`
- Check that the port 3000 is not in use
- Run PowerShell as Administrator

### PowerShell commands fail
- Verify d365fo.tools is installed: `Get-Module d365fo.tools`
- Make sure you're running PowerShell as Administrator
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
