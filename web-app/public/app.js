let currentCommand = 'Get-D365Environment';
let isExecuting = false;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  checkServerHealth();
});

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

  // Show selected form
  document.getElementById(`form-${command}`).classList.remove('hidden');

  // Update output
  updateOutputHeader(command);
}

function updateOutputHeader(command) {
  document.getElementById('command-name').textContent = command;
  document.getElementById('execution-time').textContent = '';
}

async function executeCommand(event, command) {
  event.preventDefault();

  if (isExecuting) return;

  const form = event.target;
  const formData = new FormData(form);
  const params = {};

  formData.forEach((value, key) => {
    // Handle checkboxes
    if (form.querySelector(`[name="${key}"]`).type === 'checkbox') {
      params[key] = form.querySelector(`[name="${key}"]`).checked;
    } else if (value) {
      params[key] = value;
    }
  });

  isExecuting = true;
  const btn = form.querySelector('button[type="submit"]');
  const originalText = btn.textContent;
  btn.textContent = '⏳ Executing...';
  btn.disabled = true;

  const outputBox = document.getElementById('output');
  outputBox.textContent = 'Executing command...';
  outputBox.className = 'output-box';

  const startTime = Date.now();

  try {
    const response = await fetch('/api/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command, params })
    });

    const result = await response.json();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    document.getElementById('execution-time').textContent = `(${duration}s)`;
    document.getElementById('copy-btn').style.display = 'inline-block';

    if (result.success) {
      outputBox.textContent = result.output || 'Command completed successfully (no output)';
      outputBox.className = 'output-box success';
    } else {
      outputBox.textContent = result.error || 'Unknown error';
      outputBox.className = 'output-box error';
    }
  } catch (error) {
    document.getElementById('execution-time').textContent = '';
    outputBox.textContent = `Connection error: ${error.message}`;
    outputBox.className = 'output-box error';
  } finally {
    isExecuting = false;
    btn.textContent = originalText;
    btn.disabled = false;
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
}

async function checkServerHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    console.log('Server is running:', data);
  } catch (error) {
    console.error('Server connection failed:', error);
    document.getElementById('output').textContent =
      'Warning: Cannot connect to server. Make sure the app is running.';
    document.getElementById('output').className = 'output-box error';
  }
}
