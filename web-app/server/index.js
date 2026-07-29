const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { execPowerShell } = require('./powerShellExecutor');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// API endpoint for executing commands
app.post('/api/execute', async (req, res) => {
  const { command, params } = req.body;

  if (!command) {
    return res.status(400).json({ error: 'Command is required' });
  }

  try {
    const result = await execPowerShell(command, params);
    res.json({
      success: true,
      output: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve the main HTML file for all routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`D365FO Web App running on http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop the server');
});
