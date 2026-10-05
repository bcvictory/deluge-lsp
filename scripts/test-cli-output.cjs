const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('CLI flushes complete JSON to a delayed reader and preserves exit status', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deluge-output-'));
  const count = 3000;
  const cases = [
    ['errors', 'for each line in notes.toString().toList(",")\n{\ninfo line;\n}\n', count, 0, 1],
    ['warnings', 'info "warning"\n', 0, count, 0],
  ];
  try {
    for (const [name, statement, errors, warnings, exitCode] of cases) {
      const filename = path.join(directory, `${name}.dg`);
      fs.writeFileSync(filename, `void automation.sample()\n{\n${statement.repeat(count)}}\n`);
      const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, 'validate-file.js'), filename], {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10000,
          killSignal: 'SIGKILL',
        });
        const chunks = [];
        let stderr = '';
        child.stdout.on('data', (chunk) => chunks.push(chunk));
        child.stdout.pause();
        const delay = setTimeout(() => child.stdout.resume(), 500);
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (code, signal) => {
          clearTimeout(delay);
          resolve({ code, signal, stderr, stdout: Buffer.concat(chunks) });
        });
      });
      t.diagnostic(`${name}: stdout=${result.stdout.length} bytes, exit=${result.code}`);
      assert.equal(result.signal, null);
      assert.equal(result.code, exitCode);
      assert.equal(result.stderr, '');
      const report = JSON.parse(result.stdout.toString('utf8'));
      assert.ok(result.stdout.length > 256 * 1024, 'report must exceed pipe capacity');
      assert.equal(report.file, filename);
      assert.equal(report.errors.length, errors);
      assert.equal(report.warnings.length, warnings);
      assert.equal(report.passed, exitCode === 0);
    }
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
