import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    InitializeResult,
    TextDocumentSyncKind,
    DidChangeConfigurationNotification,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getCompletions, resolveCompletion } from './providers/completion';
import { getHover } from './providers/hover';
import { validateDocument } from './providers/diagnostics';
import { getSignatureHelp } from './providers/signature-help';
import { formatDocument } from './providers/formatting';
import { getDocumentSymbols } from './providers/document-symbols';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

connection.onInitialize((_params: InitializeParams): InitializeResult => {
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: ['.'],
            },
            hoverProvider: true,
            signatureHelpProvider: {
                triggerCharacters: ['(', ','],
            },
            documentFormattingProvider: true,
            documentSymbolProvider: true,
        },
    };
});

connection.onInitialized(() => {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
});

// Completions
connection.onCompletion((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    return getCompletions(document, params);
});

connection.onCompletionResolve((item) => {
    return resolveCompletion(item);
});

// Hover
connection.onHover((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }
    return getHover(document, params);
});

// Signature Help
connection.onSignatureHelp((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }
    return getSignatureHelp(document, params);
});

// Document Formatting
connection.onDocumentFormatting((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    return formatDocument(document, params);
});

// Document Symbols
connection.onDocumentSymbol((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    return getDocumentSymbols(document);
});

// Diagnostics — run on open and on change
documents.onDidChangeContent((change) => {
    const diagnostics = validateDocument(change.document);
    connection.sendDiagnostics({
        uri: change.document.uri,
        diagnostics,
    });
});

documents.listen(connection);
connection.listen();
