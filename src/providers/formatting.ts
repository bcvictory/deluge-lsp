import { TextEdit, Range, DocumentFormattingParams } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

export function formatDocument(document: TextDocument, params: DocumentFormattingParams): TextEdit[] {
    const text = document.getText();
    const tabSize = params.options.tabSize || 4;
    const insertSpaces = params.options.insertSpaces !== false;
    const indent = insertSpaces ? ' '.repeat(tabSize) : '\t';

    const lines = text.split('\n');
    const formatted: string[] = [];
    let indentLevel = 0;
    let inBlockComment = false;
    let inInvokeUrlBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();

        if (trimmed.length === 0) {
            formatted.push('');
            continue;
        }

        // Handle block comments
        if (inBlockComment) {
            formatted.push(indent.repeat(indentLevel) + trimmed);
            if (trimmed.includes('*/')) {
                inBlockComment = false;
            }
            continue;
        }

        if (trimmed.startsWith('/*') && !trimmed.includes('*/')) {
            inBlockComment = true;
            formatted.push(indent.repeat(indentLevel) + trimmed);
            continue;
        }

        // Track invokeurl/sendmail bracket blocks
        if (/^\];\s*$/.test(trimmed) || trimmed === ']') {
            if (inInvokeUrlBlock) {
                indentLevel = Math.max(0, indentLevel - 1);
                inInvokeUrlBlock = false;
            }
            formatted.push(indent.repeat(indentLevel) + trimmed);
            continue;
        }

        // Decrease indent for closing braces
        if (trimmed.startsWith('}') || trimmed.startsWith(']')) {
            indentLevel = Math.max(0, indentLevel - 1);
        }

        // Decrease indent for else/else if/catch
        if (/^(else|catch)/.test(trimmed)) {
            indentLevel = Math.max(0, indentLevel - 1);
        }

        formatted.push(indent.repeat(indentLevel) + trimmed);

        // Increase indent for opening braces
        if (trimmed.endsWith('{')) {
            indentLevel++;
        }

        // Increase indent for else/catch (they're followed by {)
        if (/^(else|catch)/.test(trimmed) && trimmed.endsWith('{')) {
            // Already handled by the { check above
        } else if (/^(else|catch)/.test(trimmed)) {
            indentLevel++;
        }

        // Handle invokeurl/sendmail bracket open
        if (trimmed === '[' || /=\s*invokeurl\s*$/.test(trimmed)) {
            if (trimmed === '[') {
                indentLevel++;
                inInvokeUrlBlock = true;
            }
        }

        // Opening bracket on its own line
        if (trimmed === '[') {
            indentLevel++;
            inInvokeUrlBlock = true;
            // Undo the increment we already did — we only want one level
            indentLevel--;
        }
    }

    const result = formatted.join('\n');

    if (result === text) {
        return [];
    }

    return [{
        range: Range.create(0, 0, lines.length - 1, lines[lines.length - 1].length),
        newText: result,
    }];
}
