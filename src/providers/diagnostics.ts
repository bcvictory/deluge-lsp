import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

export function validateDocument(document: TextDocument): Diagnostic[] {
    const text = document.getText();
    const lines = text.split('\n');
    const diagnostics: Diagnostic[] = [];

    checkBracketBalance(text, lines, diagnostics);
    checkForEachChainedCalls(document, diagnostics);
    checkMissingSemicolons(lines, diagnostics);
    checkMultipleStatementsPerLine(lines, diagnostics);
    checkSmartQuotes(lines, diagnostics);
    checkMissingOptionsMap(lines, diagnostics);
    checkCoqlLimitExceeded(lines, diagnostics);

    return diagnostics;
}

function checkForEachChainedCalls(document: TextDocument, diagnostics: Diagnostic[]): void {
    const code = document.getText().replace(
        /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/g,
        literal => literal.replace(/[^\r\n]/g, ' '),
    );
    const headers = /\bfor\s+each\s+(?:index\s+)?[A-Za-z_]\w*\s+in\s+/g;
    let match: RegExpExecArray | null;
    while ((match = headers.exec(code)) !== null) {
        let depth = 0;
        for (let i = headers.lastIndex; i < code.length; i++) {
            if (depth === 0 && /[;{}]/.test(code[i])) {
                break;
            }
            if (code[i] === '(') {
                depth++;
            } else if (code[i] === ')') {
                depth--;
                if (depth === 0 && /^\s*\.\s*[A-Za-z_]\w*\s*\(/.test(code.slice(i + 1))) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: Range.create(document.positionAt(match.index), document.positionAt(match.index + 3)),
                        message: 'Chained calls in a for each iterable are rejected by Deluge. Assign the expression to a variable before for each.',
                        source: 'deluge',
                    });
                    break;
                }
            }
        }
    }
}

function checkBracketBalance(text: string, lines: string[], diagnostics: Diagnostic[]): void {
    // Only check braces and parentheses — square brackets are used in
    // invokeurl/sendmail block syntax which is NOT a balanced-bracket construct.
    // e.g.: response = invokeurl\n[\n  url: "..."\n  type: GET\n];
    const pairs: Array<{ open: string; close: string; name: string }> = [
        { open: '{', close: '}', name: 'brace' },
        { open: '(', close: ')', name: 'parenthesis' },
    ];

    for (const pair of pairs) {
        const stack: Array<{ line: number; char: number }> = [];
        let inString = false;
        let stringChar = '';
        let inLineComment = false;
        let inBlockComment = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            inLineComment = false;

            for (let j = 0; j < line.length; j++) {
                const ch = line[j];
                const next = j < line.length - 1 ? line[j + 1] : '';

                // String handling MUST come before comment detection,
                // otherwise // in URLs like "https://..." triggers false comments
                if (inString) {
                    if (ch === '\\') {
                        j++;
                        continue;
                    }
                    if (ch === stringChar) {
                        inString = false;
                    }
                    continue;
                }

                if (inBlockComment) {
                    if (ch === '*' && next === '/') {
                        inBlockComment = false;
                        j++;
                    }
                    continue;
                }

                if (inLineComment) {
                    continue;
                }

                if (ch === '"' || ch === "'") {
                    inString = true;
                    stringChar = ch;
                    continue;
                }

                if (ch === '/' && next === '/') {
                    inLineComment = true;
                    continue;
                }

                if (ch === '/' && next === '*') {
                    inBlockComment = true;
                    j++;
                    continue;
                }

                if (ch === pair.open) {
                    stack.push({ line: i, char: j });
                } else if (ch === pair.close) {
                    if (stack.length === 0) {
                        diagnostics.push({
                            severity: DiagnosticSeverity.Error,
                            range: Range.create(i, j, i, j + 1),
                            message: `Unmatched closing ${pair.name} '${pair.close}'`,
                            source: 'deluge',
                        });
                    } else {
                        stack.pop();
                    }
                }
            }
        }

        for (const unmatched of stack) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: Range.create(unmatched.line, unmatched.char, unmatched.line, unmatched.char + 1),
                message: `Unmatched opening ${pair.name} '${pair.open}'`,
                source: 'deluge',
            });
        }
    }
}

function checkMissingSemicolons(lines: string[], diagnostics: Diagnostic[]): void {
    const noSemicolonPatterns = [
        /^\s*\/\//, // line comment
        /^\s*\/?\*/, // block comment
        /^\s*$/, // empty line
        /^\s*(if|else|for|while|try|catch)\s*[\({]?/, // control flow
        /^\s*\{/, // opening brace
        /^\s*\}/, // closing brace
        /^\s*\[/, // opening bracket (invokeurl/sendmail block)
        /^\s*\]/, // closing bracket
        /^\s*(void|return)\b/, // function def or bare return
        /^\s*(string|int|long|float|decimal|boolean|bool|list|map|void)\s+[\w.]+\s*\(/, // function signature (may contain dots in name)
        /^\s*(from|to|subject|message|cc|bcc|replyto|content\-type|url|type|parameters|headers|connection|detailed|response\-format|body|content_type)\s*\s*:/, // sendmail/invokeurl params
    ];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.length === 0) {
            continue;
        }

        if (noSemicolonPatterns.some(p => p.test(trimmed))) {
            continue;
        }

        // Strip trailing line comments before checking line ending (string-aware)
        const withoutComment = stripTrailingComment(trimmed);

        // Skip lines ending with { or } or ] or ,
        if (/[{}\],]$/.test(withoutComment)) {
            continue;
        }

        // Skip continuation lines ending with || or && or operators
        if (/(\|\||&&|[+\-*\/=<>!&|,])\s*$/.test(withoutComment)) {
            continue;
        }

        // Skip lines that are just closing parens of multi-line conditions
        // e.g., (condition3 != null && condition3.containsIgnoreCase(term)))
        // Allow != and == (comparison operators) but not bare = (assignment)
        if (/^\(.*\)\)*\s*$/.test(withoutComment) && !/(?<![!=<>])=(?!=)/.test(withoutComment)) {
            continue;
        }

        // If the line (without comments) already ends with ;, it's fine
        if (withoutComment.endsWith(';')) {
            continue;
        }

        // Skip lines that are part of sendmail/invokeurl blocks
        if (/^\s*(from|to|subject|message|url|type|parameters|connection)\s*:/i.test(trimmed)) {
            continue;
        }

        // Skip lines that are continuations into invokeurl/sendmail blocks
        // e.g., "response = invokeurl" followed by "[" on next line
        if (/\b(invokeurl|sendmail)\s*$/.test(trimmed)) {
            continue;
        }

        // Skip lines where the next non-empty line starts with [
        // (handles "response = invokeurl" or "sendmail" before block open)
        if (!trimmed.endsWith(';')) {
            let nextNonEmpty = '';
            for (let j = i + 1; j < lines.length; j++) {
                const nextTrimmed = lines[j].trim();
                if (nextTrimmed.length > 0) {
                    nextNonEmpty = nextTrimmed;
                    break;
                }
            }
            if (nextNonEmpty === '[') {
                continue;
            }
        }

        // Statement lines should end with ;
        if (!withoutComment.endsWith(';') && !withoutComment.endsWith('{') && !withoutComment.endsWith('}')) {
            // Only flag if it looks like a statement (has assignment or function call)
            if (/=/.test(withoutComment) || /\w+\s*\(/.test(withoutComment) || /^info\s/.test(withoutComment)) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: Range.create(i, line.length - line.trimEnd().length, i, line.length),
                    message: 'Statement may be missing a semicolon',
                    source: 'deluge',
                });
            }
        }
    }
}

/**
 * Strip trailing line comments while respecting string literals.
 * A naive `replace(/\/\/.*$/, '')` breaks on URLs inside strings like "https://...".
 */
function stripTrailingComment(trimmed: string): string {
    let inString = false;
    let stringChar = '';
    for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (inString) {
            if (ch === '\\') {
                i++;
                continue;
            }
            if (ch === stringChar) {
                inString = false;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            inString = true;
            stringChar = ch;
            continue;
        }
        if (ch === '/' && i + 1 < trimmed.length && trimmed[i + 1] === '/') {
            return trimmed.substring(0, i).trim();
        }
    }
    return trimmed;
}

function checkMultipleStatementsPerLine(lines: string[], diagnostics: Diagnostic[]): void {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('//') || line.startsWith('/*')) {
            continue;
        }

        // Count semicolons outside strings
        let semiCount = 0;
        let inString = false;
        let stringChar = '';

        for (let j = 0; j < line.length; j++) {
            const ch = line[j];

            if (inString) {
                if (ch === '\\') {
                    j++;
                    continue;
                }
                if (ch === stringChar) {
                    inString = false;
                }
                continue;
            }

            if (ch === '"' || ch === "'") {
                inString = true;
                stringChar = ch;
                continue;
            }

            if (ch === '/' && j < line.length - 1 && line[j + 1] === '/') {
                break;
            }

            if (ch === ';') {
                semiCount++;
            }
        }

        if (semiCount > 1) {
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: Range.create(i, 0, i, lines[i].length),
                message: 'Multiple statements on one line — Deluge best practice is one statement per line',
                source: 'deluge',
            });
        }
    }
}

function checkSmartQuotes(lines: string[], diagnostics: Diagnostic[]): void {
    const smartQuotePattern = /[\u201C\u201D\u2018\u2019\u037E]/g;

    for (let i = 0; i < lines.length; i++) {
        let match;
        while ((match = smartQuotePattern.exec(lines[i])) !== null) {
            const ch = match[0];
            let replacement = '"';
            if (ch === '\u2018' || ch === '\u2019') {
                replacement = "'";
            } else if (ch === '\u037E') {
                replacement = ';';
            }

            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: Range.create(i, match.index, i, match.index + 1),
                message: `Smart/Unicode character detected — replace with ASCII '${replacement}'`,
                source: 'deluge',
            });
        }
    }
}

// ---------------------------------------------------------------------------
// API-aware diagnostics
// ---------------------------------------------------------------------------

/**
 * Warn when zoho.crm.updateRecord or zoho.crm.createRecord is called
 * without the options Map that controls CRM trigger behavior.
 *
 * updateRecord needs 4 params (module, id, map, optionsMap).
 * createRecord needs 3 params (module, map, optionsMap).
 * Omitting optionsMap uses Zoho default triggers: approval, blueprint,
 * and orchestration. Pass optionsMap with trigger set to an empty List
 * to suppress trigger scripts.
 */
function checkMissingOptionsMap(lines: string[], diagnostics: Diagnostic[]): void {
    const callPattern = /zoho\.crm\.(updateRecord|createRecord)\s*\(/g;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let match;

        // Reset regex lastIndex for each line
        callPattern.lastIndex = 0;
        while ((match = callPattern.exec(line)) !== null) {
            const funcName = match[1];
            const expectedMin = funcName === 'updateRecord' ? 4 : 3;
            const callStart = match.index + match[0].length - 1; // position of (

            // Count parameters by walking from the ( and counting commas at depth 0
            const paramCount = countParams(line, callStart);

            if (paramCount > 0 && paramCount < expectedMin) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: Range.create(i, match.index, i, match.index + match[0].length),
                    message: `zoho.crm.${funcName} without options map uses Zoho default triggers (approval, blueprint, orchestration). Pass an options map with trigger set to an empty List as param ${expectedMin} to suppress.`,
                    source: 'deluge-api',
                });
            }
        }
    }
}

/**
 * Count the number of parameters in a function call starting at the opening paren.
 * Returns 0 if the closing paren is not found on this line (multi-line call).
 */
function countParams(line: string, openParenIdx: number): number {
    let depth = 0;
    let commas = 0;
    let inString = false;
    let stringChar = '';
    let hasContent = false;

    for (let i = openParenIdx; i < line.length; i++) {
        const ch = line[i];

        if (inString) {
            if (ch === '\\') {
                i++;
                continue;
            }
            if (ch === stringChar) {
                inString = false;
            }
            continue;
        }

        if (ch === '"' || ch === "'") {
            inString = true;
            stringChar = ch;
            hasContent = true;
            continue;
        }

        if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
            if (depth === 1) {
                continue; // skip the opening paren itself
            }
        } else if (ch === ')' || ch === ']' || ch === '}') {
            depth--;
            if (depth === 0) {
                // Found closing paren
                return hasContent ? commas + 1 : 0;
            }
        } else if (ch === ',' && depth === 1) {
            commas++;
        } else if (depth === 1 && /\S/.test(ch)) {
            hasContent = true;
        }
    }

    // Closing paren not found on this line — multi-line call, skip
    return 0;
}

/**
 * Flag COQL queries where LIMIT exceeds 200.
 * Looks for patterns like: limit 300, LIMIT 500, etc. inside COQL query strings.
 */
function checkCoqlLimitExceeded(lines: string[], diagnostics: Diagnostic[]): void {
    // Match "limit NNN" in strings — common in COQL queries
    const limitPattern = /\blimit\s+(\d+)\b/gi;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Only check lines that look like they contain COQL (have select_query, coql, or limit in context)
        if (!/coql|select_query|select\s+\w/i.test(line) && !/\blimit\s+\d/i.test(line)) {
            continue;
        }

        limitPattern.lastIndex = 0;
        let match;
        while ((match = limitPattern.exec(line)) !== null) {
            const limitValue = parseInt(match[1], 10);
            if (limitValue > 200) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: Range.create(i, match.index, i, match.index + match[0].length),
                    message: `COQL LIMIT ${limitValue} exceeds maximum of 200. API will return LIMIT_EXCEEDED error. Use OFFSET for pagination.`,
                    source: 'deluge-api',
                });
            }
        }
    }
}
