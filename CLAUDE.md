# Deluge Language Server

## Project Overview

LSP server for Zoho's Deluge scripting language. Provides completions, hover, diagnostics, signature help, and formatting for `.dg`, `.ds`, and `.deluge` files.

**Repo:** https://github.com/bcvictory/deluge-lsp
**Installed in:** Cursor (VS Code extension) + Claude Code (marketplace plugin)

## Architecture

```
src/
  extension.ts          — VS Code/Cursor LSP client (IPC transport)
  server.ts             — LSP server entry point (stdio for Claude Code, IPC for VS Code)
  providers/
    completion.ts       — Completions: keywords, 324 functions, zoho.* drill-down, type methods
    hover.ts            — Hover: function docs, keyword docs, zoho service method docs
    diagnostics.ts      — Diagnostics: missing semicolons, unmatched braces, smart quotes, multi-statement
    signature-help.ts   — Signature help: parameter highlighting for functions
    formatting.ts       — Document formatting: indent normalization
  data/
    function-registry.ts — Loads data/deluge-functions.json, provides find/search/category lookup
    keywords.ts          — DELUGE_KEYWORDS array + TYPE_METHODS for dot-completion
    zoho-services.ts     — ZOHO_SERVICES array for zoho.crm.*, zoho.books.* etc.
data/
  deluge-functions.json  — 324 functions extracted from BagaduceDigital + Zoho reference
scripts/
  extract-functions.js   — Offline extraction script (run once to regenerate JSON)
```

## Key Data Sources

- **BagaduceDigital deluge-lang** (294 functions): `/Users/bailey/.cursor/extensions/bagaducedigital.deluge-lang-0.6.1/extension.js`
- **Zoho Deluge reference** (30 supplementary): `/Users/bailey/DelugeCRM/docs/zoho-deluge-reference.md`
- **TextMate grammar, snippets, theme**: Copied from BagaduceDigital, MIT license

## Installation

### Cursor / VS Code
```bash
cd /Users/bailey/deluge-lsp
npm run compile
npx @vscode/vsce package --no-dependencies
cursor --install-extension deluge-lsp-*.vsix --force
```

### Claude Code
Plugin installed as `deluge-lsp@deluge-lsp` marketplace. Plugin config:
- `.claude-plugin/marketplace.json` — marketplace index
- `plugins/deluge-lsp/.claude-plugin/plugin.json` — plugin metadata
- `plugins/deluge-lsp/.lsp.json` — LSP server config (command, args, extensionToLanguage)

To update after changes: `npm run compile && git push` then `claude plugin update deluge-lsp@deluge-lsp`

## Diagnostics Design

Checked patterns (in order):
1. **Brace/paren balance** — only `{}` and `()`, NOT `[]` (Deluge uses `[]` for invokeurl/sendmail blocks)
2. **Missing semicolons** — with exemptions for: control flow, comments, function signatures, invokeurl/sendmail params, continuation lines (`||`, `&&`, `+`), closing-paren conditions
3. **Multiple statements per line** — counts `;` outside strings
4. **Smart/Unicode quotes** — curly quotes and Unicode semicolons

### Critical: String-before-comment ordering
The string state check MUST come before comment detection in the character scanner. Otherwise `//` inside URLs like `https://books.zoho.com` triggers false line-comment detection. This was the root cause of most false positives in v1.

### Known remaining edge cases
- Multi-line string concatenation without trailing `+` operator (9 warnings on create15PersInvoiceAndTask.dg)
- These are low-severity warnings, not errors

## Testing

```bash
# Unit tests (inline)
node -e "const {TextDocument} = require('vscode-languageserver-textdocument'); ..."

# Production file validation
node -e "... fs.readFileSync('/Users/bailey/DelugeCRM/automation.create15PersInvoiceAndTask.dg') ..."
```

Verified against 8 production files (7,683 lines total). 0 false errors on 7/8 files. AutoAssignTechs.dg has 2 real smart-quote findings.

## Build & Deploy

```bash
npm run compile        # TypeScript → out/
npx @vscode/vsce package --no-dependencies  # → .vsix
git add -A && git commit && git push        # Updates Claude Code marketplace
```

## Dependencies

- `vscode-languageserver` ^9.0.0 — LSP server framework
- `vscode-languageclient` ^9.0.0 — VS Code client
- `vscode-languageserver-textdocument` ^1.0.0 — Document model
- Node.js (tested on v22)
