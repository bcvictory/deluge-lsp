import * as path from 'path';
import * as fs from 'fs';

export interface FunctionParameter {
    name: string;
    type: string;
    description: string;
    optional?: boolean;
}

export interface DelugeFunctionInfo {
    name: string;
    signature: string;
    description: string;
    params: FunctionParameter[];
    returns: string;
    example: string;
    category: string;
}

interface FunctionDataFile {
    functions: Record<string, {
        signature: string;
        description: string;
        params: Array<{ name: string; type: string; description: string; optional?: boolean }>;
        returns: string;
        example: string;
        category: string;
    }>;
    metadata: {
        source: string;
        extractedAt: string;
        count: number;
    };
}

let functionRegistry: DelugeFunctionInfo[] | null = null;
let functionMap: Map<string, DelugeFunctionInfo> | null = null;

export function loadFunctionRegistry(): DelugeFunctionInfo[] {
    if (functionRegistry) {
        return functionRegistry;
    }

    const dataPath = path.resolve(__dirname, '../../data/deluge-functions.json');

    try {
        const raw = fs.readFileSync(dataPath, 'utf-8');
        const data: FunctionDataFile = JSON.parse(raw);
        functionRegistry = Object.entries(data.functions).map(([name, info]) => ({
            name,
            signature: info.signature || '',
            description: info.description || '',
            params: (info.params || []).map(p => ({
                name: p.name,
                type: p.type || 'any',
                description: p.description || '',
                optional: p.optional,
            })),
            returns: info.returns || 'void',
            example: info.example || '',
            category: info.category || 'common',
        }));
    } catch {
        functionRegistry = [];
    }

    functionMap = new Map();
    for (const fn of functionRegistry) {
        functionMap.set(fn.name, fn);
        functionMap.set(fn.name.toLowerCase(), fn);
    }

    return functionRegistry;
}

export function findFunction(name: string): DelugeFunctionInfo | undefined {
    loadFunctionRegistry();
    return functionMap?.get(name) ?? functionMap?.get(name.toLowerCase());
}

export function searchFunctions(prefix: string): DelugeFunctionInfo[] {
    const registry = loadFunctionRegistry();
    const lower = prefix.toLowerCase();
    return registry.filter(f => f.name.toLowerCase().startsWith(lower));
}

export function getFunctionsByCategory(category: string): DelugeFunctionInfo[] {
    const registry = loadFunctionRegistry();
    return registry.filter(f => f.category === category);
}
