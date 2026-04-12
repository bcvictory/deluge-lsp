/**
 * CRM endpoint registry for the Deluge LSP.
 * Loads data/crm-endpoints.json and provides lookup functions for:
 *   - API URL completions (invokeurl blocks)
 *   - Hover docs on API URLs
 *   - Enriched zoho.crm.* method signatures
 *   - Diagnostic rules for common API mistakes
 */

import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface CrmEndpoint {
    id: string;
    category: string;
    method: string;
    url: string;
    version: string;
    allVersions: string[];
    description: string;
    requestBody: unknown;
    successResponse: unknown;
    errors: string[];
    snippet: string;
}

export interface UrlPattern {
    url: string;
    method: string;
    label: string;
    description: string;
    version: string;
}

export interface EnrichedMethodParam {
    name: string;
    type: string;
    description: string;
    required: boolean;
}

export interface EnrichedMethod {
    service: string;
    name: string;
    signature: string;
    description: string;
    params: EnrichedMethodParam[];
    returns: string;
    errors: string[];
    example: string;
    gotchas?: string;
}

export interface DiagnosticRule {
    id: string;
    severity: string;
    description: string;
    message: string;
    check: string;
    appliesTo?: string[];
    expectedMinParams?: Record<string, number>;
    maxLimit?: number;
}

interface EndpointDataFile {
    metadata: {
        source: string;
        extractedAt: string;
        endpointCount: number;
        enrichedMethodCount: number;
        urlPatternCount: number;
    };
    endpoints: CrmEndpoint[];
    urlPatterns: UrlPattern[];
    enrichedMethods: EnrichedMethod[];
    diagnosticRules: DiagnosticRule[];
}

// ---------------------------------------------------------------------------
// Lazy-loaded data
// ---------------------------------------------------------------------------

let dataCache: EndpointDataFile | null = null;

function loadData(): EndpointDataFile {
    if (dataCache) {
        return dataCache;
    }

    const dataPath = path.resolve(__dirname, '../../data/crm-endpoints.json');

    try {
        const raw = fs.readFileSync(dataPath, 'utf-8');
        dataCache = JSON.parse(raw) as EndpointDataFile;
    } catch {
        dataCache = {
            metadata: { source: '', extractedAt: '', endpointCount: 0, enrichedMethodCount: 0, urlPatternCount: 0 },
            endpoints: [],
            urlPatterns: [],
            enrichedMethods: [],
            diagnosticRules: [],
        };
    }

    return dataCache;
}

/** Force-load the data file. */
export function loadEndpointData(): void {
    dataCache = null;
    loadData();
}

// ---------------------------------------------------------------------------
// Endpoint queries
// ---------------------------------------------------------------------------

export function getEndpoints(): CrmEndpoint[] {
    return loadData().endpoints;
}

export function getUrlPatterns(): UrlPattern[] {
    return loadData().urlPatterns;
}

/**
 * Find an endpoint entry that matches a Zoho API URL.
 * Normalizes the URL by stripping the domain, replacing numeric IDs,
 * and doing prefix matching against endpoint URLs.
 */
export function findEndpointByUrl(url: string): CrmEndpoint | undefined {
    const normalized = normalizeApiUrl(url);
    const endpoints = getEndpoints();

    // Exact match on normalized URL
    for (const ep of endpoints) {
        const epNorm = normalizeApiUrl(ep.url);
        if (normalized === epNorm) {
            return ep;
        }
    }

    // Fuzzy: check if endpoint URL pattern is contained in the normalized URL
    for (const ep of endpoints) {
        const epPath = extractPath(ep.url);
        if (epPath && normalized.includes(epPath)) {
            return ep;
        }
    }

    // Category keyword match from URL path segments
    const pathSegments = normalized.split('/').filter(Boolean);
    for (const ep of endpoints) {
        for (const seg of pathSegments) {
            if (ep.category.toLowerCase().includes(seg.toLowerCase())) {
                return ep;
            }
        }
    }

    return undefined;
}

export function findEndpointByCategory(category: string): CrmEndpoint | undefined {
    const lower = category.toLowerCase();
    return getEndpoints().find(ep => ep.category.toLowerCase().includes(lower));
}

// ---------------------------------------------------------------------------
// Enriched method queries
// ---------------------------------------------------------------------------

export function getEnrichedMethods(servicePrefix?: string): EnrichedMethod[] {
    const all = loadData().enrichedMethods;
    if (servicePrefix) {
        return all.filter(m => m.service === servicePrefix);
    }
    return all;
}

export function getEnrichedMethod(service: string, methodName: string): EnrichedMethod | undefined {
    return loadData().enrichedMethods.find(
        m => m.service === service && m.name === methodName
    );
}

// ---------------------------------------------------------------------------
// Diagnostic rules
// ---------------------------------------------------------------------------

export function getDiagnosticRules(): DiagnosticRule[] {
    return loadData().diagnosticRules;
}

// ---------------------------------------------------------------------------
// URL normalization helpers
// ---------------------------------------------------------------------------

function normalizeApiUrl(url: string): string {
    let norm = url;
    // Strip protocol + domain
    norm = norm.replace(/^https?:\/\/[^/]+/, '');
    // Replace numeric IDs (10+ digits) with {id}
    norm = norm.replace(/\/\d{10,}\//g, '/{id}/');
    norm = norm.replace(/\/\d{10,}$/, '/{id}');
    // Normalize {param} placeholders to {id}
    norm = norm.replace(/\{[^}]+\}/g, '{id}');
    // Strip query string
    norm = norm.replace(/\?.*$/, '');
    // Lowercase for matching
    norm = norm.toLowerCase();
    return norm;
}

function extractPath(url: string): string | null {
    // Extract the distinctive path part after /crm/vN/
    const match = url.match(/\/crm\/v[\d.]+\/(.*)/);
    if (match) {
        return match[1].toLowerCase().replace(/\{[^}]+\}/g, '{id}');
    }
    return null;
}
