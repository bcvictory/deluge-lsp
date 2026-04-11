import {
    CompletionItem,
    CompletionItemKind,
    InsertTextFormat,
    MarkupKind,
    TextDocumentPositionParams
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { loadFunctionRegistry, searchFunctions } from '../data/function-registry';
import { DELUGE_KEYWORDS, TYPE_METHODS } from '../data/keywords';
import { ZOHO_SERVICES, getServiceMethods } from '../data/zoho-services';

export function getCompletions(document: TextDocument, params: TextDocumentPositionParams): CompletionItem[] {
    const position = params.position;
    const text = document.getText();
    const offset = document.offsetAt(position);
    const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
    const linePrefix = text.substring(lineStart, offset);

    // zoho.crm. → service method completions
    const serviceMatch = linePrefix.match(/zoho\.(\w+)\.$/);
    if (serviceMatch) {
        const serviceName = `zoho.${serviceMatch[1]}`;
        const methods = getServiceMethods(serviceName);
        return methods.map(m => {
            const item: CompletionItem = {
                label: m.name,
                kind: CompletionItemKind.Method,
                detail: m.signature,
                documentation: {
                    kind: MarkupKind.Markdown,
                    value: `**${m.name}**\n\n${m.description}\n\n\`\`\`deluge\n${m.signature}\n\`\`\``
                },
                insertText: `${m.name}($1)`,
                insertTextFormat: InsertTextFormat.Snippet,
            };
            return item;
        });
    }

    // zoho. → service name completions
    if (linePrefix.endsWith('zoho.')) {
        return ZOHO_SERVICES.map(s => {
            const serviceName = s.name.replace('zoho.', '');
            return {
                label: serviceName,
                kind: CompletionItemKind.Module,
                detail: `Zoho ${serviceName.charAt(0).toUpperCase() + serviceName.slice(1)} integration`,
                insertText: serviceName,
            };
        });
    }

    // Dot-notation type method completions (e.g., myString.con → contains)
    const dotMatch = linePrefix.match(/\.(\w*)$/);
    if (dotMatch && !linePrefix.match(/zoho\.\w*$/)) {
        const methodPrefix = dotMatch[1].toLowerCase();
        const items: CompletionItem[] = [];

        for (const [typeName, methods] of Object.entries(TYPE_METHODS)) {
            for (const method of methods) {
                if (method.toLowerCase().startsWith(methodPrefix)) {
                    items.push({
                        label: method,
                        kind: CompletionItemKind.Method,
                        detail: `${typeName} method`,
                        sortText: `0_${method}`,
                        insertText: methodPrefix.length > 0 ? method : method,
                    });
                }
            }
        }

        if (items.length > 0) {
            return items;
        }
    }

    // General completions: keywords + built-in functions
    const wordMatch = linePrefix.match(/(\w+)$/);
    const prefix = wordMatch ? wordMatch[1] : '';
    const items: CompletionItem[] = [];

    // Keywords
    for (const kw of DELUGE_KEYWORDS) {
        if (prefix && !kw.toLowerCase().startsWith(prefix.toLowerCase())) {
            continue;
        }
        items.push({
            label: kw,
            kind: CompletionItemKind.Keyword,
            sortText: `2_${kw}`,
        });
    }

    // Built-in functions
    const funcs = prefix ? searchFunctions(prefix) : loadFunctionRegistry();
    for (const fn of funcs) {
        items.push({
            label: fn.name,
            kind: CompletionItemKind.Function,
            detail: fn.signature || `${fn.returns} ${fn.name}(...)`,
            documentation: {
                kind: MarkupKind.Markdown,
                value: buildFunctionDoc(fn),
            },
            insertText: `${fn.name}($1)`,
            insertTextFormat: InsertTextFormat.Snippet,
            sortText: `1_${fn.name}`,
        });
    }

    return items;
}

export function resolveCompletion(item: CompletionItem): CompletionItem {
    return item;
}

function buildFunctionDoc(fn: { name: string; description: string; params: Array<{ name: string; type: string; description: string }>; returns: string; example: string }): string {
    let doc = `**${fn.name}**\n\n${fn.description}`;

    if (fn.params && fn.params.length > 0) {
        doc += '\n\n**Parameters:**\n';
        for (const p of fn.params) {
            doc += `- \`${p.name}\` *(${p.type})* — ${p.description}\n`;
        }
    }

    if (fn.returns) {
        doc += `\n**Returns:** \`${fn.returns}\``;
    }

    if (fn.example) {
        doc += `\n\n**Example:**\n\`\`\`deluge\n${fn.example}\n\`\`\``;
    }

    return doc;
}
