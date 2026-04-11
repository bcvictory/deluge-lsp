import { Hover, MarkupKind, TextDocumentPositionParams } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { findFunction } from '../data/function-registry';
import { ZOHO_SERVICES } from '../data/zoho-services';

export function getHover(document: TextDocument, params: TextDocumentPositionParams): Hover | null {
    const position = params.position;
    const text = document.getText();
    const offset = document.offsetAt(position);

    // Extract the word under cursor
    const word = getWordAtOffset(text, offset);
    if (!word) {
        return null;
    }

    // Check if it's a zoho service method (look back for zoho.service. prefix)
    const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
    const lineEnd = text.indexOf('\n', offset);
    const line = text.substring(lineStart, lineEnd === -1 ? text.length : lineEnd);
    const charInLine = offset - lineStart;

    const serviceMethodMatch = line.substring(0, charInLine + word.length).match(/zoho\.(\w+)\.(\w+)$/);
    if (serviceMethodMatch) {
        const serviceName = `zoho.${serviceMethodMatch[1]}`;
        const methodName = serviceMethodMatch[2];
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

function getWordAtOffset(text: string, offset: number): string | null {
    const wordPattern = /[a-zA-Z_][a-zA-Z0-9_]*/g;
    let match;
    while ((match = wordPattern.exec(text)) !== null) {
        if (match.index <= offset && offset <= match.index + match[0].length) {
            return match[0];
        }
        if (match.index > offset) {
            break;
        }
    }
    return null;
}
