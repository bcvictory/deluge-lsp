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
import { ZOHO_SERVICES, getServiceMethods, getEnrichedServiceMethods } from '../data/zoho-services';
import { getUrlPatterns, findEndpointByCategory, getEndpoints } from '../data/crm-endpoint-registry';

export function getCompletions(document: TextDocument, params: TextDocumentPositionParams): CompletionItem[] {
    const position = params.position;
    const text = document.getText();
    const offset = document.offsetAt(position);
    const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
    const linePrefix = text.substring(lineStart, offset);

    // invokeurl block: url: line → CRM API URL completions
    const invokeurlContext = getInvokeurlContext(text, offset);
    if (invokeurlContext === 'url') {
        return getUrlCompletions(linePrefix);
    }
    if (invokeurlContext === 'connection') {
        return getConnectionCompletions();
    }
    if (invokeurlContext === 'type') {
        return getHttpMethodCompletions();
    }

    // zoho.crm. → enriched service method completions
    const serviceMatch = linePrefix.match(/zoho\.(\w+)\.$/);
    if (serviceMatch) {
        const serviceName = `zoho.${serviceMatch[1]}`;
        // Try enriched methods first, fall back to base
        const enriched = getEnrichedServiceMethods(serviceName);
        const methods = enriched.length > 0 ? enriched : getServiceMethods(serviceName);
        return methods.map(m => {
            let docValue = `**${m.name}**\n\n${m.description}\n\n\`\`\`deluge\n${m.signature}\n\`\`\``;
            if (m.params && m.params.length > 0) {
                docValue += '\n\n**Parameters:**\n';
                for (const p of m.params) {
                    docValue += `- \`${p.name}\` *(${p.type})* — ${p.description}\n`;
                }
            }
            if (m.gotchas) {
                docValue += `\n\n**⚠ Gotcha:** ${m.gotchas}`;
            }
            const item: CompletionItem = {
                label: m.name,
                kind: CompletionItemKind.Method,
                detail: m.signature,
                documentation: {
                    kind: MarkupKind.Markdown,
                    value: docValue,
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

// ---------------------------------------------------------------------------
// invokeurl block context detection
// ---------------------------------------------------------------------------

/**
 * Determine if the cursor is inside an invokeurl [...] block and which parameter line.
 * Returns 'url', 'type', 'connection', 'parameters', or null if not in a block.
 */
function getInvokeurlContext(text: string, offset: number): string | null {
    // Walk backwards from cursor to find invokeurl [...
    // We need to find an opening [ that's preceded by 'invokeurl' (possibly with whitespace/newline)
    let bracketDepth = 0;
    let foundOpenBracket = false;

    for (let i = offset - 1; i >= 0; i--) {
        const ch = text[i];
        if (ch === ']') {
            bracketDepth++;
        } else if (ch === '[') {
            if (bracketDepth === 0) {
                // Check if this [ is preceded by 'invokeurl'
                const before = text.substring(Math.max(0, i - 30), i).trimEnd();
                if (before.endsWith('invokeurl')) {
                    foundOpenBracket = true;
                    break;
                }
                return null; // [ not preceded by invokeurl
            }
            bracketDepth--;
        }
    }

    if (!foundOpenBracket) {
        return null;
    }

    // We're inside an invokeurl block. Determine which param line.
    const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
    const linePrefix = text.substring(lineStart, offset).trimStart();

    if (/^url\s*:/i.test(linePrefix)) {
        return 'url';
    }
    if (/^type\s*:/i.test(linePrefix)) {
        return 'type';
    }
    if (/^connection\s*:/i.test(linePrefix)) {
        return 'connection';
    }
    if (/^parameters\s*:/i.test(linePrefix)) {
        return 'parameters';
    }
    if (/^headers\s*:/i.test(linePrefix)) {
        return 'headers';
    }

    return null; // Inside block but not on a recognized param line
}

/**
 * Return CRM API URL completions for use inside invokeurl url: lines.
 */
function getUrlCompletions(linePrefix: string): CompletionItem[] {
    const patterns = getUrlPatterns();
    const endpoints = getEndpoints();

    // Extract any typed text after url: "
    const urlTyped = linePrefix.match(/url\s*:\s*"([^"]*)/i);
    const typed = urlTyped ? urlTyped[1].toLowerCase() : '';

    return patterns
        .filter(p => !typed || p.url.toLowerCase().includes(typed) || p.label.toLowerCase().includes(typed))
        .map((p, idx) => {
            // Find matching endpoint for richer docs
            const ep = endpoints.find(e => e.category.toLowerCase().includes(p.label.toLowerCase().split(' ')[0]));

            let doc = `**${p.method} ${p.url}**\n\n${p.description}\n\nVersion: ${p.version}`;
            if (ep && ep.snippet) {
                doc += `\n\n**Deluge snippet:**\n\`\`\`deluge\n${ep.snippet}\n\`\`\``;
            }
            if (ep && ep.errors && ep.errors.length > 0) {
                doc += `\n\n**Common errors:** ${ep.errors.join(', ')}`;
            }

            return {
                label: `${p.label} (${p.method})`,
                kind: CompletionItemKind.Value,
                detail: `${p.method} ${p.url}`,
                documentation: {
                    kind: MarkupKind.Markdown,
                    value: doc,
                },
                insertText: p.url,
                sortText: `0_${String(idx).padStart(3, '0')}`,
                filterText: `${p.url} ${p.label} ${p.description}`,
            };
        });
}

/**
 * Return connection name completions.
 */
function getConnectionCompletions(): CompletionItem[] {
    const connections = [
        { name: 'crm', detail: 'CRM API connection (most common)', sortOrder: 0 },
        { name: 'crm_connection', detail: 'CRM connection (used in Books functions)', sortOrder: 1 },
        { name: 'degrootcrm', detail: 'Alternate CRM connection', sortOrder: 2 },
        { name: 'crmall', detail: 'Full-scope CRM connection', sortOrder: 3 },
        { name: 'books', detail: 'Zoho Books API connection', sortOrder: 4 },
        { name: 'creator', detail: 'Zoho Creator API connection', sortOrder: 5 },
    ];

    return connections.map(c => ({
        label: c.name,
        kind: CompletionItemKind.Value,
        detail: c.detail,
        insertText: `"${c.name}"`,
        sortText: `0_${c.sortOrder}`,
    }));
}

/**
 * Return HTTP method completions for invokeurl type: lines.
 */
function getHttpMethodCompletions(): CompletionItem[] {
    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    return methods.map((m, i) => ({
        label: m,
        kind: CompletionItemKind.EnumMember,
        detail: `HTTP ${m}`,
        insertText: m,
        sortText: `0_${i}`,
    }));
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
