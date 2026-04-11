import { DocumentSymbol, SymbolKind, Range, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

/**
 * Extract document symbols from a Deluge (.dg) file.
 *
 * Detected patterns:
 *  - Function definitions:  `returnType functionName(params)` at indent 0
 *  - Top-level variable assignments: `name = value;` at indent 0
 *  - Map/List creation: `name = Map();` or `name = List();`
 *  - For-each loop variables: `for each name in collection`
 */
export function getDocumentSymbols(document: TextDocument): DocumentSymbol[] {
    const text = document.getText();
    const lines = text.split('\n');
    const symbols: DocumentSymbol[] = [];

    // First pass: find all function definitions and their brace ranges
    const functions = findFunctions(lines);

    // Second pass: find children inside each function, and top-level variables
    for (const fn of functions) {
        fn.symbol.children = findChildSymbols(lines, fn.bodyStart, fn.bodyEnd);
        symbols.push(fn.symbol);
    }

    // Find top-level variable assignments (outside any function body)
    const functionRanges = functions.map(f => ({ start: f.defLine, end: f.bodyEnd }));
    for (let i = 0; i < lines.length; i++) {
        if (isInsideAny(i, functionRanges)) {
            continue;
        }
        const sym = parseVariableAssignment(lines[i], i);
        if (sym) {
            symbols.push(sym);
        }
    }

    return symbols;
}

interface FunctionInfo {
    symbol: DocumentSymbol;
    defLine: number;
    bodyStart: number;  // line of opening brace
    bodyEnd: number;    // line of closing brace
}

// Deluge return types that can prefix a function definition
const RETURN_TYPES = [
    'void', 'string', 'int', 'float', 'bool', 'boolean', 'list', 'map',
    'String', 'Int', 'Float', 'Bool', 'Boolean', 'List', 'Map',
    'bigint', 'Bigint', 'long', 'Long', 'double', 'Double',
];

function findFunctions(lines: string[]): FunctionInfo[] {
    const functions: FunctionInfo[] = [];

    // Pattern: optional return type, then function name (may include dots), then parenthesized params
    // e.g. `string automation.functionName(Int dealId)`
    // e.g. `void functionName()`
    const funcRegex = /^(\w+)\s+([\w.]+)\s*\(([^)]*)\)\s*$/;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trimEnd();
        // Must be at indent level 0 (no leading whitespace) or minimal indent
        if (lines[i].length > 0 && lines[i][0] === ' ' || lines[i][0] === '\t') {
            continue;
        }

        const match = trimmed.match(funcRegex);
        if (!match) {
            continue;
        }

        const returnType = match[1];
        if (!RETURN_TYPES.includes(returnType)) {
            continue;
        }

        const funcName = match[2];
        const params = match[3];

        // Find the opening brace
        let braceStart = -1;
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
            if (lines[j].trim() === '{') {
                braceStart = j;
                break;
            }
        }
        if (braceStart === -1 && i + 1 < lines.length && lines[i + 1]?.trim().startsWith('{')) {
            braceStart = i + 1;
        }
        if (braceStart === -1) {
            continue;
        }

        // Find the matching closing brace
        const braceEnd = findMatchingBrace(lines, braceStart);
        if (braceEnd === -1) {
            continue;
        }

        const detail = `${returnType} ${funcName}(${params})`;
        const nameStart = lines[i].indexOf(funcName);

        const range: Range = {
            start: Position.create(i, 0),
            end: Position.create(braceEnd, lines[braceEnd].length),
        };
        const selectionRange: Range = {
            start: Position.create(i, nameStart),
            end: Position.create(i, nameStart + funcName.length),
        };

        const symbol: DocumentSymbol = {
            name: funcName,
            detail,
            kind: SymbolKind.Function,
            range,
            selectionRange,
            children: [],
        };

        functions.push({
            symbol,
            defLine: i,
            bodyStart: braceStart,
            bodyEnd: braceEnd,
        });

        // Skip past this function
        i = braceEnd;
    }

    return functions;
}

function findMatchingBrace(lines: string[], openLine: number): number {
    let depth = 0;
    for (let i = openLine; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === '{') {
                depth++;
            } else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    return i;
                }
            }
        }
    }
    return -1;
}

function findChildSymbols(lines: string[], bodyStart: number, bodyEnd: number): DocumentSymbol[] {
    const children: DocumentSymbol[] = [];

    for (let i = bodyStart + 1; i < bodyEnd; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // For-each loop variable
        const forEachMatch = trimmed.match(/^for\s+each\s+(\w+)\s+in\s+/);
        if (forEachMatch) {
            const varName = forEachMatch[1];
            const col = line.indexOf(forEachMatch[0]) + 'for each '.length;
            children.push(makeSymbol(
                varName,
                SymbolKind.Variable,
                i, 0, i, line.length,
                i, col, i, col + varName.length,
                'loop variable',
            ));
            continue;
        }

        // Variable / Map / List assignment
        const sym = parseVariableAssignment(line, i);
        if (sym) {
            children.push(sym);
        }
    }

    // Attach children to parent function symbol
    // (we already set children on the FunctionInfo; the caller wires it)
    // Actually we return children and the caller sets fn.symbol.children
    return children;
}

function parseVariableAssignment(line: string, lineNum: number): DocumentSymbol | null {
    const trimmed = line.trim();

    // Skip blank lines, comments, control flow, etc.
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        return null;
    }
    // Skip keywords that aren't assignments
    if (/^(if|else|for|while|return|break|continue|try|catch|throw|info|alert)\b/.test(trimmed)) {
        return null;
    }
    // Skip function calls without assignment (e.g. `doSomething();`)
    if (/^\w[\w.]*\s*\(/.test(trimmed) && !trimmed.includes('=')) {
        return null;
    }

    // Match: varName = Map(); or varName = List();
    const containerMatch = trimmed.match(/^(\w+)\s*=\s*(Map|List)\s*\(\s*\)\s*;?\s*$/);
    if (containerMatch) {
        const varName = containerMatch[1];
        const containerType = containerMatch[2];
        const kind = containerType === 'Map' ? SymbolKind.Object : SymbolKind.Array;
        const col = line.indexOf(varName);
        return makeSymbol(
            varName,
            kind,
            lineNum, 0, lineNum, line.length,
            lineNum, col, lineNum, col + varName.length,
            containerType,
        );
    }

    // Match: varName = expression;
    const assignMatch = trimmed.match(/^(\w+)\s*=\s*.+/);
    if (assignMatch) {
        const varName = assignMatch[1];
        // Skip if it looks like a comparison (==) rather than assignment
        if (/^(\w+)\s*==/.test(trimmed)) {
            return null;
        }
        const col = line.indexOf(varName);
        return makeSymbol(
            varName,
            SymbolKind.Variable,
            lineNum, 0, lineNum, line.length,
            lineNum, col, lineNum, col + varName.length,
        );
    }

    return null;
}

function makeSymbol(
    name: string,
    kind: SymbolKind,
    rangeStartLine: number, rangeStartChar: number,
    rangeEndLine: number, rangeEndChar: number,
    selStartLine: number, selStartChar: number,
    selEndLine: number, selEndChar: number,
    detail?: string,
): DocumentSymbol {
    return {
        name,
        detail,
        kind,
        range: {
            start: Position.create(rangeStartLine, rangeStartChar),
            end: Position.create(rangeEndLine, rangeEndChar),
        },
        selectionRange: {
            start: Position.create(selStartLine, selStartChar),
            end: Position.create(selEndLine, selEndChar),
        },
    };
}

function isInsideAny(line: number, ranges: Array<{ start: number; end: number }>): boolean {
    for (const r of ranges) {
        if (line >= r.start && line <= r.end) {
            return true;
        }
    }
    return false;
}
