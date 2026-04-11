#!/usr/bin/env node
/**
 * Validate a Deluge (.dg) file using the deluge-lsp diagnostics module.
 *
 * Usage:  node validate-file.js /path/to/file.dg
 *
 * Output: JSON  { "file", "errors": [...], "warnings": [...], "passed": true/false }
 * Exit 0 = no errors (warnings are OK).  Exit 1 = errors found.
 */

const fs = require('fs');
const path = require('path');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { validateDocument } = require('../out/providers/diagnostics');

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node validate-file.js <path-to-.dg-file>');
  process.exit(2);
}

const resolved = path.resolve(filePath);
if (!fs.existsSync(resolved)) {
  console.error(`File not found: ${resolved}`);
  process.exit(2);
}

const content = fs.readFileSync(resolved, 'utf-8');
const doc = TextDocument.create(`file://${resolved}`, 'deluge', 1, content);
const diagnostics = validateDocument(doc);

// DiagnosticSeverity: 1 = Error, 2 = Warning, 3 = Information, 4 = Hint
const errors = [];
const warnings = [];

for (const d of diagnostics) {
  const entry = {
    line: d.range.start.line + 1,
    character: d.range.start.character + 1,
    message: d.message,
  };
  if (d.severity === 1) {
    errors.push(entry);
  } else {
    warnings.push(entry);
  }
}

const result = {
  file: resolved,
  errors,
  warnings,
  passed: errors.length === 0,
};

console.log(JSON.stringify(result, null, 2));
process.exit(errors.length > 0 ? 1 : 0);
