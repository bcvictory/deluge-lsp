import { Hover, MarkupKind, TextDocumentPositionParams } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { findFunction } from '../data/function-registry';
import { ZOHO_SERVICES } from '../data/zoho-services';
import { findEndpointByUrl, getEnrichedMethod } from '../data/crm-endpoint-registry';

export function getHover(document: TextDocument, params: TextDocumentPositionParams): Hover | null {
    const position = params.position;
    const lineCount = document.lineCount;
    const line = position.line;
    const character = position.character;

    // Get the text of the current line
    const lineEnd = line + 1 < lineCount
        ? document.positionAt(document.offsetAt({ line: line + 1, character: 0 }))
        : { line, character: Number.MAX_SAFE_INTEGER };
    const lineText = document.getText({
        start: { line, character: 0 },
        end: lineEnd,
    }).replace(/\n$/, '');

    // Check if hovering over a Zoho API URL string
    const urlHover = getApiUrlHover(lineText, character);
    if (urlHover) {
        return urlHover;
    }

    // Extract the word at the cursor position within this line
    const word = getWordAtPosition(lineText, character);
    if (!word) {
        return null;
    }

    // Find the end of the word in the line for proper substring matching
    let wordEnd = character;
    while (wordEnd < lineText.length && /[a-zA-Z0-9_]/.test(lineText[wordEnd])) {
        wordEnd++;
    }

    // Check if it's a zoho service method — show enriched docs
    const serviceMethodMatch = lineText.substring(0, wordEnd).match(/zoho\.(\w+)\.(\w+)$/);
    if (serviceMethodMatch) {
        const serviceName = `zoho.${serviceMethodMatch[1]}`;
        const methodName = serviceMethodMatch[2];

        // Try enriched method data first
        const enriched = getEnrichedMethod(serviceName, methodName);
        if (enriched) {
            let doc = `**${serviceName}.${enriched.name}**\n\n${enriched.description}`;
            doc += `\n\n\`\`\`deluge\n${enriched.signature}\n\`\`\``;

            if (enriched.params && enriched.params.length > 0) {
                doc += '\n\n**Parameters:**\n';
                for (const p of enriched.params) {
                    const req = p.required ? 'required' : 'optional';
                    doc += `- \`${p.name}\` *(${p.type}, ${req})* — ${p.description}\n`;
                }
            }

            if (enriched.returns) {
                doc += `\n**Returns:** \`${enriched.returns}\``;
            }

            if (enriched.errors && enriched.errors.length > 0) {
                doc += `\n\n**Common errors:** ${enriched.errors.join(', ')}`;
            }

            if (enriched.example) {
                doc += `\n\n**Example:**\n\`\`\`deluge\n${enriched.example}\n\`\`\``;
            }

            if (enriched.gotchas) {
                doc += `\n\n**Warning:** ${enriched.gotchas}`;
            }

            return { contents: { kind: MarkupKind.Markdown, value: doc } };
        }

        // Fall back to base service data
        const service = ZOHO_SERVICES.find(s => s.name === serviceName);
        if (service) {
            const method = service.methods.find(m => m.name === methodName);
            if (method) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: `**${serviceName}.${method.name}**\n\n${method.description}\n\n\`\`\`deluge\n${method.signature}\n\`\`\``
                    }
                };
            }
        }
    }

    // Check built-in functions
    const fn = findFunction(word);
    if (fn) {
        let doc = `**${fn.name}**\n\n${fn.description}`;

        if (fn.signature) {
            doc += `\n\n\`\`\`deluge\n${fn.signature}\n\`\`\``;
        }

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

        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: doc
            }
        };
    }

    // Keyword hover docs
    const keywordDocs: Record<string, string> = {
        'info': '**info** — Log a message to the execution log.\n\n```deluge\ninfo "message: " + variable;\n```',
        'sendmail': '**sendmail** — Send an email.\n\n```deluge\nsendmail\n[\n  from: zoho.loginuserid\n  to: "recipient@example.com"\n  subject: "Subject"\n  message: "Body"\n]\n```',
        'invokeurl': '**invokeurl** — Make HTTP requests to external services.\n\n```deluge\nresponse = invokeurl\n[\n  url: "https://api.example.com/endpoint"\n  type: GET\n  connection: "connection_name"\n];\n```',
        'input': '**input** — Access form input fields in Creator/CRM functions.\n\n```deluge\nvalue = input.Field_Name;\n```',
        'thisapp': '**thisapp** — Access the current Creator application context.\n\n```deluge\nthisapp.Field_Name = value;\n```',
    };

    if (keywordDocs[word]) {
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: keywordDocs[word]
            }
        };
    }

    return null;
}

// ---------------------------------------------------------------------------
// API URL hover
// ---------------------------------------------------------------------------

/**
 * Check if the cursor is positioned over a Zoho API URL string.
 * Returns a hover with endpoint docs if found.
 */
function getApiUrlHover(lineText: string, character: number): Hover | null {
    // Find all quoted strings in the line that look like Zoho API URLs
    const urlRegex = /"(https:\/\/www\.zohoapis\.com\/crm\/[^"]+)"/g;
    let match;

    while ((match = urlRegex.exec(lineText)) !== null) {
        const start = match.index + 1; // after opening quote
        const end = start + match[1].length;

        if (character >= start && character <= end) {
            const url = match[1];
            const endpoint = findEndpointByUrl(url);

            if (endpoint) {
                let doc = `**${endpoint.method} ${endpoint.category}**\n\n${endpoint.description}`;
                doc += `\n\n**Version:** ${endpoint.version}`;

                if (endpoint.allVersions && endpoint.allVersions.length > 1) {
                    doc += ` (also: ${endpoint.allVersions.filter(v => v !== endpoint.version).join(', ')})`;
                }

                if (endpoint.requestBody) {
                    const bodyStr = typeof endpoint.requestBody === 'string'
                        ? endpoint.requestBody
                        : JSON.stringify(endpoint.requestBody, null, 2);
                    if (bodyStr.length < 500) {
                        doc += `\n\n**Request body:**\n\`\`\`json\n${bodyStr}\n\`\`\``;
                    }
                }

                if (endpoint.successResponse) {
                    const respStr = typeof endpoint.successResponse === 'string'
                        ? endpoint.successResponse
                        : JSON.stringify(endpoint.successResponse, null, 2);
                    if (respStr.length < 500) {
                        doc += `\n\n**Success response:**\n\`\`\`json\n${respStr}\n\`\`\``;
                    }
                }

                if (endpoint.errors && endpoint.errors.length > 0) {
                    doc += `\n\n**Common errors:** ${endpoint.errors.join(', ')}`;
                }

                if (endpoint.snippet) {
                    doc += `\n\n**Deluge snippet:**\n\`\`\`deluge\n${endpoint.snippet}\n\`\`\``;
                }

                return { contents: { kind: MarkupKind.Markdown, value: doc } };
            }
        }
    }

    return null;
}

function getWordAtPosition(lineText: string, character: number): string | null {
    // Walk left from cursor to find word start
    let start = character;
    while (start > 0 && /[a-zA-Z0-9_]/.test(lineText[start - 1])) {
        start--;
    }
    // Walk right from cursor to find word end
    let end = character;
    while (end < lineText.length && /[a-zA-Z0-9_]/.test(lineText[end])) {
        end++;
    }
    if (start === end) {
        return null;
    }
    const word = lineText.substring(start, end);
    // Must start with letter or underscore
    if (!/^[a-zA-Z_]/.test(word)) {
        return null;
    }
    return word;
}
