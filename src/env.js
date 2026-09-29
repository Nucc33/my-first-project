// Reads API keys from the .env file next to package.json.
const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env');

function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) return false;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
  return true;
}

// Explain where the .env file should be, and spot common naming mistakes.
function envHint() {
  const dir = path.dirname(ENV_FILE);
  if (fs.existsSync(ENV_FILE)) return `(Using ${ENV_FILE})`;
  const lookalikes = fs.readdirSync(dir).filter((f) => /^\.?env/i.test(f) && f !== '.env.example');
  let msg = `There is no file named exactly ".env" in ${dir}`;
  if (lookalikes.length) msg += `\nFound ${lookalikes.map((f) => `"${f}"`).join(', ')} instead: rename it to exactly ".env".`;
  return msg;
}

module.exports = { loadEnv, envHint, ENV_FILE };
