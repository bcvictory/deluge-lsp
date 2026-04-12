/**
 * Zoho service integration completions for Deluge.
 * Provides dot-notation completion data for zoho.crm.*, zoho.books.*, etc.
 */

import { getEnrichedMethods } from './crm-endpoint-registry';

export interface ZohoServiceMethod {
    name: string;
    description: string;
    signature: string;
    params?: Array<{ name: string; type: string; description: string; required: boolean }>;
    returns?: string;
    errors?: string[];
    example?: string;
    gotchas?: string;
}

export interface ZohoService {
    name: string;
    methods: ZohoServiceMethod[];
}

export const ZOHO_SERVICES: ZohoService[] = [
    {
        name: 'zoho.crm',
        methods: [
            { name: 'getRecordById', description: 'Fetch a single record by ID', signature: 'getRecordById(module: String, recordId: Long, optionalParams?: Map)' },
            { name: 'getRecords', description: 'Fetch records from a module', signature: 'getRecords(module: String, page?: Int, perPage?: Int)' },
            { name: 'searchRecords', description: 'Search records with criteria', signature: 'searchRecords(module: String, criteria: String, page?: Int, perPage?: Int)' },
            { name: 'createRecord', description: 'Create a new record', signature: 'createRecord(module: String, dataMap: Map, optionalParams?: Map)' },
            { name: 'updateRecord', description: 'Update an existing record', signature: 'updateRecord(module: String, recordId: Long, dataMap: Map, optionalParams?: Map)' },
            { name: 'deleteRecord', description: 'Delete a record', signature: 'deleteRecord(module: String, recordId: Long)' },
            { name: 'getRelatedRecords', description: 'Get related records for a record', signature: 'getRelatedRecords(module: String, relatedModule: String, recordId: Long)' },
            { name: 'updateRelatedRecord', description: 'Update a related record', signature: 'updateRelatedRecord(module: String, recordId: Long, relatedModule: String, relatedRecordId: Long, dataMap: Map)' },
            { name: 'bulkUpdate', description: 'Update multiple records at once', signature: 'bulkUpdate(module: String, recordIds: List, dataMap: Map)' },
        ],
    },
    {
        name: 'zoho.books',
        methods: [
            { name: 'createRecord', description: 'Create a Zoho Books record', signature: 'createRecord(module: String, orgId: String, dataMap: Map, connection?: String)' },
            { name: 'getRecordsByID', description: 'Get a Zoho Books record by ID', signature: 'getRecordsByID(module: String, orgId: String, recordId: String, connection?: String)' },
            { name: 'getRecords', description: 'Get Zoho Books records', signature: 'getRecords(module: String, orgId: String, criteria?: Map, connection?: String)' },
            { name: 'updateRecord', description: 'Update a Zoho Books record', signature: 'updateRecord(module: String, orgId: String, recordId: String, dataMap: Map, connection?: String)' },
        ],
    },
    {
        name: 'zoho.creator',
        methods: [
            { name: 'getRecordById', description: 'Get a Creator record by ID', signature: 'getRecordById(owner: String, appName: String, reportName: String, recordId: Long, connection?: String)' },
            { name: 'getRecords', description: 'Get Creator records', signature: 'getRecords(owner: String, appName: String, reportName: String, criteria?: String, page?: Int, perPage?: Int, connection?: String)' },
            { name: 'createRecord', description: 'Create a Creator record', signature: 'createRecord(owner: String, appName: String, formName: String, dataMap: Map, connection?: String)' },
            { name: 'updateRecord', description: 'Update a Creator record', signature: 'updateRecord(owner: String, appName: String, reportName: String, criteria: String, dataMap: Map, connection?: String)' },
        ],
    },
    {
        name: 'zoho.campaigns',
        methods: [
            { name: 'createRecord', description: 'Create a Campaigns record', signature: 'createRecord(module: String, dataMap: Map)' },
        ],
    },
];

/**
 * Get service methods for a given service prefix (e.g., "zoho.crm").
 */
export function getServiceMethods(servicePrefix: string): ZohoServiceMethod[] {
    const service = ZOHO_SERVICES.find(s => s.name === servicePrefix);
    return service?.methods ?? [];
}

/**
 * Get enriched service methods with full descriptions, params, errors, examples, and gotchas.
 * For zoho.crm, merges enriched data from crm-endpoints.json onto the base methods.
 * For other services, returns the base methods unchanged.
 * Enriched-only methods (e.g., upsertRecord) are appended at the end.
 */
export function getEnrichedServiceMethods(servicePrefix: string): ZohoServiceMethod[] {
    const baseMethods = getServiceMethods(servicePrefix);

    if (servicePrefix === 'zoho.crm') {
        const enriched = getEnrichedMethods(servicePrefix);
        const enrichedByName = new Map(enriched.map(m => [m.name, m]));
        const seen = new Set<string>();

        // Merge enriched data onto base methods, keeping base as fallback
        const merged: ZohoServiceMethod[] = baseMethods.map(base => {
            seen.add(base.name);
            const rich = enrichedByName.get(base.name);
            if (!rich) {
                return base;
            }
            return {
                name: base.name,
                description: rich.description || base.description,
                signature: rich.signature || base.signature,
                params: rich.params,
                returns: rich.returns,
                errors: rich.errors,
                example: rich.example,
                gotchas: rich.gotchas,
            };
        });

        // Append enriched-only methods not in the base set
        for (const rich of enriched) {
            if (!seen.has(rich.name)) {
                merged.push({
                    name: rich.name,
                    description: rich.description,
                    signature: rich.signature,
                    params: rich.params,
                    returns: rich.returns,
                    errors: rich.errors,
                    example: rich.example,
                    gotchas: rich.gotchas,
                });
            }
        }

        return merged;
    }

    return baseMethods;
}
