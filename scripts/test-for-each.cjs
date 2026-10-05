const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cases = [
  ['native rejection', 'for each line in ifnull(contact.get("notes"),"").toString().toList("\\n")', true],
  ['method chain', 'for each line in notes.toString().toList("\\n")', true],
  ['multiline index', 'for /* header */ each index i in\n notes.toString()\n .toList("\\n")', true],
  ['quoted delimiters', 'for each line in notes.replaceAll("{); //", "}").toList("\\n")', true],
  ['collection variable', 'for each line in lines', false],
  ['index variable', 'for each index i in lines', false],
  ['direct method', 'for each line in contact.get("notes")', false],
  ['nested calls', 'for each line in ifnull(contact.get("notes").toList("\\n"),lines)', false],
  ['literal collection', 'for each line in {"one","two"}', false],
  ['line comment', '// for each line in notes.toString().toList("\\n")\nfor each line in lines', false],
  ['block comment', '/*\nfor each line in notes.toString().toList("\\n")\n*/\nfor each line in lines', false],
  ['string', 'info "https://example.invalid/ for each line in notes.toString().toList()";\nfor each line in lines', false],
  ['escaped quote', 'info "quote \\" for each line in notes.toString().toList()";\nfor each line in lines', false],
];

for (const [name, header, blocked] of cases) {
  test(name, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deluge-loop-'));
    try {
      const filename = path.join(directory, 'sample.dg');
      fs.writeFileSync(filename, `void automation.sample()\n{\n${header}\n{\nparts = line.toString().toList(",");\n}\n}\n`);
      const result = spawnSync(process.execPath, [path.join(__dirname, 'validate-file.js'), filename], { encoding: 'utf8' });
      assert.equal(result.error, undefined);
      const report = JSON.parse(result.stdout);
      assert.equal(result.status, blocked ? 1 : 0, JSON.stringify(report));
      assert.equal(report.passed, !blocked);
      assert.equal(report.errors.length, blocked ? 1 : 0, JSON.stringify(report));
      if (blocked) {
        assert.match(report.errors[0].message, /Assign.*variable.*for each/);
        assert.equal(report.errors[0].line, 3);
        assert.equal(report.errors[0].character, 1);
      }
    } finally {
      fs.rmSync(directory, { recursive: true });
    }
  });
}
