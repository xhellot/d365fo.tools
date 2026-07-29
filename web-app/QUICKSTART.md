# Quick Start Guide

Get the D365FO Web Admin Tools running in 5 minutes.

## Step 1: Install Node.js (if not already installed)

1. Download from https://nodejs.org/ (LTS version recommended)
2. Run the installer and follow the prompts
3. Verify installation:
   ```powershell
   node --version
   npm --version
   ```

## Step 2: Install d365fo.tools PowerShell Module (if not already installed)

Run in PowerShell as Administrator:
```powershell
Install-Module -Name d365fo.tools
```

Verify it works:
```powershell
Get-Command -Module d365fo.tools | Select-Object Name | head -5
```

## Step 3: Start the Web App

**Option A: Using the Batch File (Easiest)**
```
Double-click: start.bat
```

**Option B: Using PowerShell**
```powershell
cd "C:\Users\Ting.Xu\OneDrive - INOTIV, INC\Desktop\FO Tools\d365fo-web-app"
npm install
npm start
```

## Step 4: Open in Browser

Navigate to: **http://localhost:3000**

You should see a purple interface with 5 command buttons.

## Step 5: Try Your First Command

1. Click "Environment Health"
2. Leave Computer Name blank
3. Click "Check Environment Status"
4. See the output of your D365 environment status

## Troubleshooting

**"npm: command not found"**
- Node.js is not installed or not in PATH
- Restart your terminal/PowerShell after installing Node.js

**"Cannot connect to server"**
- Make sure npm start succeeded without errors
- Try opening http://localhost:3000 in your browser
- Check if port 3000 is available (change in server/index.js if not)

**PowerShell commands fail**
- Make sure you installed d365fo.tools: `Get-Module d365fo.tools`
- Run PowerShell as Administrator
- Check that the D365 environment is accessible from your machine

## Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Explore each of the 5 commands through the web interface
- Customize forms or add more commands as needed

## Need Help?

For issues with d365fo.tools PowerShell module, check:
- https://github.com/d365collaborative/d365fo.tools/wiki
- `Get-Help <CommandName>` in PowerShell

For issues with this web app, check:
- This QuickStart guide
- The README.md troubleshooting section
