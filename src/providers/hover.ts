import { Hover, MarkupKind, TextDocumentPositionParams } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { findFunction } from '../data/function-registry';
import { ZOHO_SERVICES } from '../data/zoho-services';

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

    // Check if it's a zoho service method (look back for zoho.service. prefix)
    const serviceMethodMatch = lineText.substring(0, wordEnd).match(/zoho\.(\w+)\.(\w+)$/);
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
