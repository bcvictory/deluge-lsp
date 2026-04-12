#!/usr/bin/env python3
"""
Extract CRM API endpoint data from the Zoho CRM REST APIs Postman collection
for use by the Deluge LSP.

Produces data/crm-endpoints.json containing:
  - endpoints: URL completions, hover docs, request/response examples
  - enrichedMethods: Better zoho.crm.* method signatures + param docs
  - diagnosticRules: Patterns for common API mistakes

Usage:
    python3 scripts/extract-crm-endpoints.py
    python3 scripts/extract-crm-endpoints.py --collection /path/to/collection.json
"""

import json
import os
import re
import argparse
from collections import defaultdict
from typing import Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(SCRIPT_DIR)
DEFAULT_COLLECTION = os.path.expanduser(
    "~/Downloads/Zoho CRM REST APIs.postman_collection.json"
)
OUTPUT_PATH = os.path.join(REPO_DIR, "data", "crm-endpoints.json")

TARGET_VERSIONS = ["V2", "V2.1", "V3", "V5", "V6", "V7", "V8"]

# Operations that matter for the codebase, keyed by category name
OPERATIONS = {
    "COQL Queries": {
        "patterns": ["/coql"],
        "pref_version": "v2",
        "description": "Execute a COQL (CRM Object Query Language) query to search records",
    },
    "Search Records": {
        "patterns": ["/search"],
        "pref_version": "v2",
        "description": "Search records by criteria, email, phone, or word",
    },
    "Send Mail": {
        "patterns": ["/actions/send_mail"],
        "pref_version": "v2.1",
        "description": "Send email from a CRM record",
    },
    "From Addresses": {
        "patterns": ["/from_addresses"],
        "pref_version": "v8",
        "description": "Get available sender email addresses",
    },
    "Email Templates": {
        "patterns": ["/email_templates"],
        "pref_version": "v8",
        "description": "Get email template content by ID",
    },
    "File Upload": {
        "patterns": ["/files"],
        "pref_version": "v3",
        "description": "Upload files to Zoho File System for record fields",
        "exclude": ["/settings/", "/profiles"],
    },
    "Tags": {
        "patterns": ["/tags", "/add_tags", "/remove_tags"],
        "pref_version": "v2",
        "description": "Add, remove, and manage tags on records",
    },
    "CRM Variables": {
        "patterns": ["/settings/variables"],
        "pref_version": "v6",
        "description": "Read and update org-level CRM variables",
    },
    "Notes": {
        "patterns": ["/Notes", "/notes"],
        "pref_version": "v2",
        "description": "CRUD operations on record notes",
        "exclude": ["/email_notifications"],
    },
    "Attachments": {
        "patterns": ["/Attachments"],
        "pref_version": "v2",
        "description": "Upload, download, list, and delete record attachments",
    },
    "Fields Metadata": {
        "patterns": ["/settings/fields"],
        "pref_version": "v3",
        "description": "Get field definitions and validation rules for a module",
    },
    "Timeline": {
        "patterns": ["/__timeline"],
        "pref_version": "v8",
        "description": "Get record change history and field update timeline",
    },
    "Cadences": {
        "patterns": ["/cadences", "/enrol_in_cadences"],
        "pref_version": "v8",
        "description": "List cadences and enrol records into automated flows",
    },
    "Composite Requests": {
        "patterns": ["/__composite_requests"],
        "pref_version": "v8",
        "description": "Batch multiple API calls into a single request",
    },
    "Records CRUD": {
        "patterns": [],
        "pref_version": "v2",
        "description": "Create, read, update, delete, and upsert module records",
        "heuristic": True,
    },
}

# ---------------------------------------------------------------------------
# Postman collection walker
# ---------------------------------------------------------------------------

def walk_items(items, version, path, out):
    for item in items:
        if "item" in item:
            walk_items(item["item"], version, f"{path}/{item.get('name','')}", out)
        elif "request" in item:
            req = item["request"]
            method = req.get("method", "GET")
            url = req.get("url", {})
            if isinstance(url, str):
                raw_url = url
            else:
                raw_url = url.get("raw", "")

            # Strip Postman variables
            clean_url = raw_url.replace("{{api-domain}}", "https://www.zohoapis.com")
            clean_url = re.sub(r"\{\{[^}]+\}\}", "{param}", clean_url)

            body_raw = ""
            if req.get("body") and req["body"].get("raw"):
                body_raw = req["body"]["raw"]

            responses = []
            for resp in item.get("response", []):
                resp_body_raw = resp.get("body", "") or ""
                resp_body = None
                if resp_body_raw:
                    try:
                        resp_body = json.loads(resp_body_raw)
                    except (json.JSONDecodeError, TypeError):
                        pass

                orig_body = ""
                orig_req = resp.get("originalRequest", {})
                if orig_req.get("body") and orig_req["body"].get("raw"):
                    orig_body = orig_req["body"]["raw"]

                responses.append({
                    "name": resp.get("name", ""),
                    "status": resp.get("code", 0),
                    "body": resp_body,
                    "body_raw": resp_body_raw[:2000],
                    "original_request_body": orig_body[:2000],
                })

            out.append({
                "version": version,
                "folder_path": path,
                "name": item.get("name", ""),
                "method": method,
                "url": clean_url,
                "request_body": body_raw[:2000],
                "responses": responses,
            })


def flatten_collection(data):
    records = []
    for top_item in data.get("item", []):
        version = top_item.get("name", "")
        if version not in TARGET_VERSIONS:
            continue
        walk_items(top_item.get("item", []), version, version, records)
    return records


# ---------------------------------------------------------------------------
# Classify endpoints into operations
# ---------------------------------------------------------------------------

def classify(record):
    url = record["url"].lower()
    for cat_name, cat in OPERATIONS.items():
        excludes = cat.get("exclude", [])
        if any(ex.lower() in url for ex in excludes):
            continue
        for pat in cat["patterns"]:
            if pat.lower() in url:
                return cat_name
    return None


# ---------------------------------------------------------------------------
# Extract best examples per operation
# ---------------------------------------------------------------------------

def pick_best_examples(records_by_cat):
    """For each category, pick the best request+success response and collect error codes."""
    endpoints = []

    for cat_name, records in records_by_cat.items():
        cat_info = OPERATIONS.get(cat_name, {})
        pref_v = cat_info.get("pref_version", "v2").upper()
        if not pref_v.startswith("V"):
            pref_v = "V" + pref_v

        # Group by version
        by_version = defaultdict(list)
        for r in records:
            by_version[r["version"]].append(r)

        all_versions = sorted(by_version.keys(),
                              key=lambda v: TARGET_VERSIONS.index(v) if v in TARGET_VERSIONS else 99)

        # Pick primary version records (preferred), fallback to first available
        primary_records = by_version.get(pref_v, [])
        if not primary_records and all_versions:
            primary_records = by_version[all_versions[0]]

        # Find best request example (one with a non-empty body for POST/PUT, or first GET)
        best_request = None
        best_success = None
        error_codes = []

        for r in primary_records:
            # Best request: prefer one with a body
            if not best_request:
                best_request = r
            elif r["request_body"] and not best_request["request_body"]:
                best_request = r

            # Scan responses
            for resp in r["responses"]:
                if 200 <= resp["status"] < 300 and resp["body"]:
                    if not best_success:
                        best_success = resp
                elif resp["status"] >= 400 and resp["body"]:
                    code = None
                    body = resp["body"]
                    if isinstance(body, dict):
                        code = body.get("code")
                        if not code and "data" in body and isinstance(body["data"], list):
                            for d in body["data"]:
                                if isinstance(d, dict) and d.get("code") and d["code"] != "SUCCESS":
                                    code = d["code"]
                                    break
                    if code and code not in error_codes:
                        error_codes.append(code)

        # Also scan all versions for error codes
        for v_records in by_version.values():
            for r in v_records:
                for resp in r["responses"]:
                    if resp["status"] >= 400 and resp["body"]:
                        body = resp["body"]
                        code = None
                        if isinstance(body, dict):
                            code = body.get("code")
                            if not code and "data" in body and isinstance(body["data"], list):
                                for d in body["data"]:
                                    if isinstance(d, dict) and d.get("code") and d["code"] != "SUCCESS":
                                        code = d["code"]
                                        break
                        if code and code not in error_codes:
                            error_codes.append(code)

        if not best_request:
            continue

        # Build the endpoint URL (clean up to a template)
        url = best_request["url"]
        # Normalize to a reusable template
        method = best_request["method"]

        # Parse request body JSON
        req_body = None
        if best_request["request_body"]:
            try:
                req_body = json.loads(best_request["request_body"])
            except (json.JSONDecodeError, TypeError):
                pass

        # Truncate response data arrays to 1 item
        success_body = None
        if best_success and best_success["body"]:
            success_body = truncate_response(best_success["body"])

        # Build Deluge snippet
        snippet = build_snippet(cat_name, method, url, req_body)

        endpoints.append({
            "id": cat_name.lower().replace(" ", "_").replace("(", "").replace(")", ""),
            "category": cat_name,
            "method": method,
            "url": url,
            "version": cat_info.get("pref_version", "v2"),
            "allVersions": [v.lower().replace("v", "v") for v in all_versions],
            "description": cat_info.get("description", ""),
            "requestBody": req_body,
            "successResponse": success_body,
            "errors": error_codes[:8],
            "snippet": snippet,
        })

    return endpoints


def truncate_response(body, max_json_size=2000):
    """Truncate data arrays to 1 item and cap total size for compact display."""
    if not isinstance(body, dict):
        return body
    result = {}
    for k, v in body.items():
        if isinstance(v, list) and len(v) > 1:
            result[k] = [truncate_response(v[0]) if isinstance(v[0], dict) else v[0]]
        elif isinstance(v, dict):
            result[k] = truncate_response(v)
        else:
            result[k] = v
    # If still too large, strip deeply nested objects
    serialized = json.dumps(result)
    if len(serialized) > max_json_size:
        result = _shallow_copy(result, max_json_size)
    return result


def _shallow_copy(obj, budget):
    """Keep only top-level keys, drop nested objects that blow the budget."""
    if not isinstance(obj, dict):
        return obj
    result = {}
    used = 2  # {}
    for k, v in obj.items():
        chunk = json.dumps({k: v})
        if used + len(chunk) > budget:
            result[k] = "..." if isinstance(v, (dict, list)) else v
            used += len(json.dumps({k: result[k]}))
        else:
            result[k] = v
            used += len(chunk)
    return result


def build_snippet(category, method, url, req_body):
    """Build a Deluge invokeurl snippet for this endpoint."""
    # Normalize URL: replace {param} with ${1:param}
    snippet_url = url

    type_map = {"GET": "GET", "POST": "POST", "PUT": "PUT", "DELETE": "DELETE", "PATCH": "PATCH"}
    deluge_type = type_map.get(method, method)

    if category == "COQL Queries":
        return (
            'queryMap = Map();\n'
            'queryMap.put("select_query", "select ${1:Field1}, ${2:Field2} from ${3:Module} where ${4:Criteria} limit 200");\n'
            'response = invokeurl\n'
            '[\n'
            f'  url: "https://www.zohoapis.com/crm/v2/coql"\n'
            '  type: POST\n'
            '  parameters: queryMap.toString()\n'
            '  connection: "crm"\n'
            '];'
        )
    elif category == "CRM Variables":
        return (
            'response = invokeurl\n'
            '[\n'
            '  url: "https://www.zohoapis.com/crm/v6/settings/variables"\n'
            '  type: GET\n'
            '  connection: "crm"\n'
            '];'
        )
    elif category == "Send Mail":
        return (
            'mailMap = Map();\n'
            'mailMap.put("from", Map());\n'
            'mailMap.put("to", List());\n'
            'mailMap.put("subject", ${1:subject});\n'
            'mailMap.put("content", ${2:htmlBody});\n'
            'payload = Map();\n'
            'payload.put("data", {mailMap});\n'
            'response = invokeurl\n'
            '[\n'
            '  url: "https://www.zohoapis.com/crm/v2.1/${3:Module}/" + recordId + "/actions/send_mail"\n'
            '  type: POST\n'
            '  parameters: payload.toString()\n'
            '  connection: "crm"\n'
            '];'
        )
    elif category == "Tags":
        return (
            'tagPayload = Map();\n'
            'tagList = List();\n'
            'tag = Map();\n'
            'tag.put("name", "${1:TagName}");\n'
            'tagList.add(tag);\n'
            'tagPayload.put("tags", tagList);\n'
            'response = invokeurl\n'
            '[\n'
            '  url: "https://www.zohoapis.com/crm/v2/${2:Module}/" + recordId + "/actions/add_tags"\n'
            '  type: POST\n'
            '  parameters: tagPayload.toString()\n'
            '  connection: "crm"\n'
            '];'
        )
    else:
        # Generic snippet
        parts = [
            'response = invokeurl\n[\n',
            f'  url: "{snippet_url}"\n',
            f'  type: {deluge_type}\n',
        ]
        if method in ("POST", "PUT", "PATCH") and req_body:
            parts.append('  parameters: payload.toString()\n')
        parts.append('  connection: "crm"\n')
        parts.append('];')
        return ''.join(parts)


# ---------------------------------------------------------------------------
# Enriched zoho.crm.* methods
# ---------------------------------------------------------------------------

def build_enriched_methods():
    """Hand-curated enriched method data based on Postman collection analysis."""
    return [
        {
            "service": "zoho.crm",
            "name": "getRecordById",
            "signature": "zoho.crm.getRecordById(module, recordId, optionalParams?)",
            "description": "Fetch a single CRM record by its ID.",
            "params": [
                {"name": "module", "type": "String", "description": "Module API name (Deals, Contacts, Leads, etc.)", "required": True},
                {"name": "recordId", "type": "Long", "description": "Record ID to fetch", "required": True},
                {"name": "optionalParams", "type": "Map", "description": "Optional: {\"fields\": \"Field1,Field2\"} to limit returned fields", "required": False},
            ],
            "returns": "Map — full record data with all field API names as keys",
            "errors": ["INVALID_MODULE", "INVALID_DATA"],
            "example": 'deal = zoho.crm.getRecordById("Deals", dealId);\ninfo deal.get("Deal_Name");',
        },
        {
            "service": "zoho.crm",
            "name": "getRecords",
            "signature": "zoho.crm.getRecords(module, page?, perPage?)",
            "description": "Fetch a page of records from a module.",
            "params": [
                {"name": "module", "type": "String", "description": "Module API name", "required": True},
                {"name": "page", "type": "Int", "description": "Page number (1-indexed, default 1)", "required": False},
                {"name": "perPage", "type": "Int", "description": "Records per page (max 200, default 200)", "required": False},
            ],
            "returns": "List — list of record Maps",
            "errors": ["INVALID_MODULE"],
            "example": 'records = zoho.crm.getRecords("Contacts", 1, 200);\nfor each rec in records\n{\n  info rec.get("Email");\n}',
        },
        {
            "service": "zoho.crm",
            "name": "searchRecords",
            "signature": "zoho.crm.searchRecords(module, criteria, page?, perPage?)",
            "description": "Search records using criteria expressions.",
            "params": [
                {"name": "module", "type": "String", "description": "Module API name", "required": True},
                {"name": "criteria", "type": "String", "description": 'Criteria string, e.g. "(Email:equals:test@example.com)"', "required": True},
                {"name": "page", "type": "Int", "description": "Page number (1-indexed)", "required": False},
                {"name": "perPage", "type": "Int", "description": "Records per page (max 200)", "required": False},
            ],
            "returns": "List — matching records. Returns null if no matches.",
            "errors": ["INVALID_MODULE", "INVALID_QUERY"],
            "example": 'results = zoho.crm.searchRecords("Contacts", "(Email:equals:" + email + ")");\nif(results != null && results.size() > 0)\n{\n  contact = results.get(0);\n}',
            "gotchas": "Returns null (not empty list) when no records match. Always null-check before .size().",
        },
        {
            "service": "zoho.crm",
            "name": "createRecord",
            "signature": "zoho.crm.createRecord(module, dataMap, triggers?)",
            "description": "Create a new record in a CRM module.",
            "params": [
                {"name": "module", "type": "String", "description": "Module API name", "required": True},
                {"name": "dataMap", "type": "Map", "description": "Map of field API names to values", "required": True},
                {"name": "triggers", "type": "List", "description": 'Triggers to fire: ["workflow","approval","blueprint"]. Pass [] to suppress all.', "required": False},
            ],
            "returns": 'Map — {"data":[{"code":"SUCCESS","details":{"id":"...","Created_Time":"..."}}]}',
            "errors": ["MANDATORY_NOT_FOUND", "INVALID_DATA", "DUPLICATE_DATA"],
            "example": 'dataMap = Map();\ndataMap.put("Last_Name", "Smith");\ndataMap.put("Email", "smith@example.com");\nresp = zoho.crm.createRecord("Contacts", dataMap, []);\ninfo resp;',
            "gotchas": "Omitting triggers (3rd param) fires ALL triggers. Always pass [] to suppress in automation.",
        },
        {
            "service": "zoho.crm",
            "name": "updateRecord",
            "signature": "zoho.crm.updateRecord(module, recordId, dataMap, triggers?)",
            "description": "Update fields on an existing CRM record.",
            "params": [
                {"name": "module", "type": "String", "description": "Module API name", "required": True},
                {"name": "recordId", "type": "Long", "description": "Record ID to update", "required": True},
                {"name": "dataMap", "type": "Map", "description": "Map of field API names to new values", "required": True},
                {"name": "triggers", "type": "List", "description": 'Triggers to fire: ["workflow","approval","blueprint"]. Pass [] to suppress all.', "required": False},
            ],
            "returns": 'Map — {"data":[{"code":"SUCCESS","details":{"id":"...","Modified_Time":"..."}}]}',
            "errors": ["MANDATORY_NOT_FOUND", "INVALID_DATA", "DUPLICATE_DATA"],
            "example": 'dataMap = Map();\ndataMap.put("Stage", "Job Created");\nresp = zoho.crm.updateRecord("Deals", dealId, dataMap, []);\ninfo resp;',
            "gotchas": "CRITICAL: Omitting the 4th parameter fires ALL triggers (workflow, approval, blueprint). Always pass [] explicitly to suppress re-firing in automation functions.",
        },
        {
            "service": "zoho.crm",
            "name": "deleteRecord",
            "signature": "zoho.crm.deleteRecord(module, recordId)",
            "description": "Move a record to the recycle bin.",
            "params": [
                {"name": "module", "type": "String", "description": "Module API name", "required": True},
                {"name": "recordId", "type": "Long", "description": "Record ID to delete", "required": True},
            ],
            "returns": 'Map — {"data":[{"code":"SUCCESS","details":{"id":"..."}}]}',
            "errors": ["INVALID_DATA"],
            "example": 'resp = zoho.crm.deleteRecord("Tasks", taskId);\ninfo resp;',
        },
        {
            "service": "zoho.crm",
            "name": "getRelatedRecords",
            "signature": "zoho.crm.getRelatedRecords(module, relatedModule, recordId)",
            "description": "Get records related to a parent record.",
            "params": [
                {"name": "module", "type": "String", "description": "Parent module API name", "required": True},
                {"name": "relatedModule", "type": "String", "description": "Related module API name", "required": True},
                {"name": "recordId", "type": "Long", "description": "Parent record ID", "required": True},
            ],
            "returns": "List — related record Maps. May return inconsistent format vs REST API.",
            "errors": ["INVALID_MODULE", "INVALID_DATA"],
            "example": 'notes = zoho.crm.getRelatedRecords("Deals", "Notes", dealId);\nfor each n in notes\n{\n  info n.get("Note_Content");\n}',
            "gotchas": "Return format can be inconsistent. For reliable JSON, use REST API: GET /crm/v2/{Module}/{id}/Notes instead.",
        },
        {
            "service": "zoho.crm",
            "name": "updateRelatedRecord",
            "signature": "zoho.crm.updateRelatedRecord(module, recordId, relatedModule, relatedRecordId, dataMap)",
            "description": "Update a related record.",
            "params": [
                {"name": "module", "type": "String", "description": "Parent module API name", "required": True},
                {"name": "recordId", "type": "Long", "description": "Parent record ID", "required": True},
                {"name": "relatedModule", "type": "String", "description": "Related module API name", "required": True},
                {"name": "relatedRecordId", "type": "Long", "description": "Related record ID", "required": True},
                {"name": "dataMap", "type": "Map", "description": "Map of fields to update", "required": True},
            ],
            "returns": "Map",
            "errors": ["INVALID_DATA"],
            "example": 'dataMap = Map();\ndataMap.put("Note_Content", "Updated note");\nresp = zoho.crm.updateRelatedRecord("Deals", dealId, "Notes", noteId, dataMap);',
        },
        {
            "service": "zoho.crm",
            "name": "bulkUpdate",
            "signature": "zoho.crm.bulkUpdate(module, recordIds, dataMap)",
            "description": "Update the same field values on multiple records at once.",
            "params": [
                {"name": "module", "type": "String", "description": "Module API name", "required": True},
                {"name": "recordIds", "type": "List", "description": "List of record IDs to update", "required": True},
                {"name": "dataMap", "type": "Map", "description": "Map of field values to set on all records", "required": True},
            ],
            "returns": 'Map — {"data":[{"code":"SUCCESS",...}, ...]}',
            "errors": ["INVALID_DATA", "RECORD_LOCKED"],
            "example": 'ids = List();\nids.add(id1);\nids.add(id2);\ndataMap = Map();\ndataMap.put("Tag", "Processed");\nresp = zoho.crm.bulkUpdate("Contacts", ids, dataMap);',
        },
        {
            "service": "zoho.crm",
            "name": "upsertRecord",
            "signature": "zoho.crm.upsertRecord(module, dataMap)",
            "description": "Insert or update a record based on duplicate check fields.",
            "params": [
                {"name": "module", "type": "String", "description": "Module API name", "required": True},
                {"name": "dataMap", "type": "Map", "description": "Map of field values. Must include the duplicate-check field.", "required": True},
            ],
            "returns": "Map — includes action (insert/update) in response",
            "errors": ["MANDATORY_NOT_FOUND", "INVALID_DATA", "DUPLICATE_DATA"],
            "example": 'dataMap = Map();\ndataMap.put("Email", "smith@example.com");\ndataMap.put("Last_Name", "Smith");\nresp = zoho.crm.upsertRecord("Contacts", dataMap);',
        },
    ]


# ---------------------------------------------------------------------------
# Diagnostic rules
# ---------------------------------------------------------------------------

def build_diagnostic_rules():
    return [
        {
            "id": "missing-trigger-suppress",
            "severity": "warning",
            "description": "zoho.crm.updateRecord/createRecord without explicit trigger parameter fires ALL workflows",
            "message": "Missing trigger parameter — all workflows will fire. Add [] as last param to suppress.",
            "appliesTo": ["zoho.crm.updateRecord", "zoho.crm.createRecord"],
            "check": "param_count",
            "expectedMinParams": {"zoho.crm.updateRecord": 4, "zoho.crm.createRecord": 3},
        },
        {
            "id": "coql-limit-over-200",
            "severity": "error",
            "description": "COQL LIMIT cannot exceed 200",
            "message": "COQL LIMIT exceeds 200 — API will return LIMIT_EXCEEDED error. Use OFFSET for pagination.",
            "check": "coql_limit",
            "maxLimit": 200,
        },
        {
            "id": "integer-field-decimal",
            "severity": "warning",
            "description": "CRM integer fields reject decimal values",
            "message": "If writing to an integer field, use .round(0).toLong() to avoid INVALID_DATA errors.",
            "check": "info_only",
        },
    ]


# ---------------------------------------------------------------------------
# URL pattern registry for completions
# ---------------------------------------------------------------------------

def build_url_patterns():
    """Build a list of common API URL patterns for invokeurl completions."""
    return [
        {
            "url": "https://www.zohoapis.com/crm/v2/coql",
            "method": "POST",
            "label": "COQL Query",
            "description": "Execute a COQL query",
            "version": "v2",
        },
        {
            "url": "https://www.zohoapis.com/crm/v2/{Module}/search",
            "method": "GET",
            "label": "Search Records",
            "description": "Search records by criteria",
            "version": "v2",
        },
        {
            "url": "https://www.zohoapis.com/crm/v2/{Module}",
            "method": "GET",
            "label": "Get Records",
            "description": "List records from a module",
            "version": "v2",
        },
        {
            "url": "https://www.zohoapis.com/crm/v2/{Module}/{id}",
            "method": "GET",
            "label": "Get Record by ID",
            "description": "Fetch a single record",
            "version": "v2",
        },
        {
            "url": "https://www.zohoapis.com/crm/v2/{Module}",
            "method": "POST",
            "label": "Create Record",
            "description": "Create a new record",
            "version": "v2",
        },
        {
            "url": "https://www.zohoapis.com/crm/v2/{Module}/{id}",
            "method": "PUT",
            "label": "Update Record",
            "description": "Update a record by ID",
            "version": "v2",
        },
        {
            "url": "https://www.zohoapis.com/crm/v2/{Module}/{id}",
            "method": "DELETE",
            "label": "Delete Record",
            "description": "Delete a record by ID",
            "version": "v2",
        },
        {
            "url": "https://www.zohoapis.com/crm/v2/{Module}/upsert",
            "method": "POST",
            "label": "Upsert Record",
            "description": "Insert or update based on duplicate check",
            "version": "v2",
        },
        {
            "url": "https://www.zohoapis.com/crm/v2.1/{Module}/{id}/actions/send_mail",
            "method": "POST",
            "label": "Send Mail",
            "description": "Send email from a CRM record",
            "version": "v2.1",
        },
        {
            "url": "https://www.zohoapis.com/crm/v8/settings/emails/actions/from_addresses",
            "method": "GET",
            "label": "From Addresses",
            "description": "Get available sender email addresses",
            "version": "v8",
        },
        {
            "url": "https://www.zohoapis.com/crm/v8/{Module}/email_templates",
            "method": "GET",
            "label": "Email Templates",
            "description": "Get email templates for a module",
            "version": "v8",
        },
        {
            "url": "https://www.zohoapis.com/crm/v3/files",
            "method": "POST",
            "label": "Upload File (ZFS)",
            "description": "Upload file to Zoho File System",
            "version": "v3",
        },
        {
            "url": "https://www.zohoapis.com/crm/v2/{Module}/{id}/actions/add_tags",
            "method": "POST",
            "label": "Add Tags",
            "description": "Add tags to a record",
            "version": "v2",
        },
        {
            "url": "https://www.zohoapis.com/crm/v2/{Module}/{id}/actions/remove_tags",
            "method": "POST",
            "label": "Remove Tags",
            "description": "Remove tags from a record",
            "version": "v2",
        },
        {
            "url": "https://www.zohoapis.com/crm/v6/settings/variables",
            "method": "GET",
            "label": "Get CRM Variables",
            "description": "Read org-level CRM variables",
            "version": "v6",
        },
        {
            "url": "https://www.zohoapis.com/crm/v6/settings/variables/{id}",
            "method": "PUT",
            "label": "Update CRM Variable",
            "description": "Update an org-level CRM variable",
            "version": "v6",
        },
        {
            "url": "https://www.zohoapis.com/crm/v2/{Module}/{id}/Notes",
            "method": "GET",
            "label": "Get Notes",
            "description": "Get notes for a record",
            "version": "v2",
        },
        {
            "url": "https://www.zohoapis.com/crm/v2/{Module}/{id}/Notes",
            "method": "POST",
            "label": "Create Note",
            "description": "Add a note to a record",
            "version": "v2",
        },
        {
            "url": "https://www.zohoapis.com/crm/v2/{Module}/{id}/Attachments",
            "method": "GET",
            "label": "Get Attachments",
            "description": "List attachments on a record",
            "version": "v2",
        },
        {
            "url": "https://www.zohoapis.com/crm/v2/{Module}/{id}/Attachments",
            "method": "POST",
            "label": "Upload Attachment",
            "description": "Upload an attachment to a record",
            "version": "v2",
        },
        {
            "url": "https://www.zohoapis.com/crm/v3/settings/fields?module={Module}",
            "method": "GET",
            "label": "Fields Metadata",
            "description": "Get field definitions for a module",
            "version": "v3",
        },
        {
            "url": "https://www.zohoapis.com/crm/v8/{Module}/{id}/__timeline",
            "method": "GET",
            "label": "Timeline",
            "description": "Get record change history",
            "version": "v8",
        },
        {
            "url": "https://www.zohoapis.com/crm/v8/settings/cadences",
            "method": "GET",
            "label": "List Cadences",
            "description": "Get available cadence flows",
            "version": "v8",
        },
        {
            "url": "https://www.zohoapis.com/crm/v8/{Module}/actions/enrol_in_cadences",
            "method": "POST",
            "label": "Enrol in Cadence",
            "description": "Enrol records into an automated cadence",
            "version": "v8",
        },
        {
            "url": "https://www.zohoapis.com/crm/v2/{Module}/{id}/{RelatedModule}",
            "method": "GET",
            "label": "Related Records",
            "description": "Get related records for a parent record",
            "version": "v2",
        },
        {
            "url": "https://www.zohoapis.com/crm/v8/__composite_requests",
            "method": "POST",
            "label": "Composite Request",
            "description": "Batch multiple API calls",
            "version": "v8",
        },
    ]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Extract CRM endpoints for Deluge LSP")
    parser.add_argument("--collection", default=DEFAULT_COLLECTION, help="Path to Postman collection JSON")
    parser.add_argument("--output", default=OUTPUT_PATH, help="Output JSON path")
    args = parser.parse_args()

    print(f"Loading Postman collection from {args.collection}...")
    with open(args.collection, "r") as f:
        data = json.load(f)

    print("Flattening collection...")
    records = flatten_collection(data)
    print(f"  {len(records)} endpoint records across {len(TARGET_VERSIONS)} versions")

    # Classify into operations
    classified = defaultdict(list)
    unclassified = 0
    for r in records:
        cat = classify(r)
        if cat:
            classified[cat].append(r)
        else:
            unclassified += 1

    print(f"  {len(classified)} categories matched, {unclassified} unclassified")

    # Extract best examples
    print("Extracting best examples per category...")
    endpoints = pick_best_examples(classified)
    print(f"  {len(endpoints)} endpoint entries")

    # Build enriched methods
    enriched_methods = build_enriched_methods()
    print(f"  {len(enriched_methods)} enriched zoho.crm.* methods")

    # Build diagnostic rules
    diagnostic_rules = build_diagnostic_rules()

    # Build URL patterns for completions
    url_patterns = build_url_patterns()
    print(f"  {len(url_patterns)} URL completion patterns")

    # Assemble output
    output = {
        "metadata": {
            "source": os.path.basename(args.collection),
            "extractedAt": __import__("datetime").datetime.now().isoformat()[:10],
            "endpointCount": len(endpoints),
            "enrichedMethodCount": len(enriched_methods),
            "urlPatternCount": len(url_patterns),
        },
        "endpoints": endpoints,
        "urlPatterns": url_patterns,
        "enrichedMethods": enriched_methods,
        "diagnosticRules": diagnostic_rules,
    }

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(output, f, indent=2, default=str)

    size_kb = os.path.getsize(args.output) / 1024
    print(f"\nWrote {args.output} ({size_kb:.1f} KB)")
    print("Done.")


if __name__ == "__main__":
    main()
