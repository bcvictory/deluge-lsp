import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

export function validateDocument(document: TextDocument): Diagnostic[] {
    const text = document.getText();
    const lines = text.split('\n');
    const diagnostics: Diagnostic[] = [];

    checkBracketBalance(text, lines, diagnostics);
    checkMissingSemicolons(lines, diagnostics);
    checkMultipleStatementsPerLine(lines, diagnostics);
    checkSmartQuotes(lines, diagnostics);

    return diagnostics;
}

function checkBracketBalance(text: string, lines: string[], diagnostics: Diagnostic[]): void {
    const pairs: Array<{ open: string; close: string; name: string }> = [
        { open: '{', close: '}', name: 'brace' },
        { open: '(', close: ')', name: 'parenthesis' },
        { open: '[', close: ']', name: 'bracket' },
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

                if (ch === '/' && next === '/') {
                    inLineComment = true;
                    continue;
                }

                if (ch === '/' && next === '*') {
                    inBlockComment = true;
                    j++;
                    continue;
                }

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
        /^\s*(from|to|subject|message|cc|bcc|replyto|content\-type|url|type|parameters|headers|connection|detailed|response\-format)\s*:/, // sendmail/invokeurl params
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

        // Skip lines ending with { or } or ] or ,
        if (/[{}\],]$/.test(trimmed)) {
            continue;
        }

        // Skip lines that are part of sendmail/invokeurl blocks
        if (/^\s*(from|to|subject|message|url|type|parameters|connection)\s*:/i.test(trimmed)) {
            continue;
        }

        // Statement lines should end with ;
        if (!trimmed.endsWith(';') && !trimmed.endsWith('{') && !trimmed.endsWith('}')) {
            // Only flag if it looks like a statement (has assignment or function call)
            if (/=/.test(trimmed) || /\w+\s*\(/.test(trimmed) || /^info\s/.test(trimmed)) {
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
