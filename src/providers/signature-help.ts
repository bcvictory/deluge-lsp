import {
    SignatureHelp,
    SignatureInformation,
    ParameterInformation,
    MarkupKind,
    TextDocumentPositionParams
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { findFunction } from '../data/function-registry';
import { ZOHO_SERVICES } from '../data/zoho-services';

export function getSignatureHelp(document: TextDocument, params: TextDocumentPositionParams): SignatureHelp | null {
    const position = params.position;
    const text = document.getText();
    const offset = document.offsetAt(position);

    // Walk backwards from cursor to find the function call context
    const context = findCallContext(text, offset);
    if (!context) {
        return null;
    }

    const { functionName, activeParam, servicePrefix } = context;

    // Try zoho service method first
    if (servicePrefix) {
        const service = ZOHO_SERVICES.find(s => s.name === servicePrefix);
        if (service) {
            const method = service.methods.find(m => m.name === functionName);
            if (method) {
                const paramLabels = extractParamLabels(method.signature);
                const sig: SignatureInformation = {
                    label: `${servicePrefix}.${method.signature}`,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: method.description
                    },
                    parameters: paramLabels.map(p => ({
                        label: p,
                        documentation: ''
                    })),
                };
                return {
                    signatures: [sig],
                    activeSignature: 0,
                    activeParameter: activeParam,
                };
            }
        }
    }

    // Try built-in function
    const fn = findFunction(functionName);
    if (fn) {
        const parameters: ParameterInformation[] = fn.params.map(p => ({
            label: p.name,
            documentation: {
                kind: MarkupKind.Markdown,
                value: `*${p.type}* — ${p.description}`
            },
        }));

        const paramList = fn.params.map(p => `${p.name}: ${p.type}`).join(', ');
        const sig: SignatureInformation = {
            label: `${fn.name}(${paramList}) → ${fn.returns}`,
            documentation: {
                kind: MarkupKind.Markdown,
                value: fn.description
            },
            parameters,
        };

        return {
            signatures: [sig],
            activeSignature: 0,
            activeParameter: activeParam,
        };
    }

    return null;
}

interface CallContext {
    functionName: string;
    activeParam: number;
    servicePrefix: string | null;
}

function findCallContext(text: string, offset: number): CallContext | null {
    // Walk backwards to find the opening parenthesis
    let depth = 0;
    let commaCount = 0;
    let inString = false;
    let stringChar = '';

    for (let i = offset - 1; i >= 0; i--) {
        const ch = text[i];

        if (inString) {
            if (ch === stringChar && (i === 0 || text[i - 1] !== '\\')) {
                inString = false;
            }
            continue;
        }

        if (ch === '"' || ch === "'") {
            inString = true;
            stringChar = ch;
            continue;
        }

        if (ch === ')') {
            depth++;
            continue;
        }

        if (ch === '(') {
            if (depth === 0) {
                // Found the matching open paren — extract function name
                const before = text.substring(0, i);
                const funcMatch = before.match(/(?:(\w+\.\w+)\.)?(\w+)\s*$/);
                if (funcMatch) {
                    return {
                        functionName: funcMatch[2],
                        activeParam: commaCount,
                        servicePrefix: funcMatch[1] || null,
                    };
                }
                return null;
            }
            depth--;
            continue;
        }

        if (ch === ',' && depth === 0) {
            commaCount++;
        }
    }

    return null;
}

function extractParamLabels(signature: string): string[] {
    const match = signature.match(/\(([^)]*)\)/);
    if (!match) {
        return [];
    }
    return match[1].split(',').map(p => p.trim()).filter(p => p.length > 0);
}
