#!/usr/bin/env node
/**
 * Extract Deluge function definitions from the BagaduceDigital VS Code extension
 * and supplement with functions from the Zoho Deluge reference documentation.
 *
 * Usage: node extract-functions.js
 * Output: ../data/deluge-functions.json
 */

const fs = require('fs');
const path = require('path');

const EXTENSION_PATH = path.join(
  process.env.HOME,
  '.cursor/extensions/bagaducedigital.deluge-lang-0.6.1/extension.js'
);
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'deluge-functions.json');

// ---------------------------------------------------------------------------
// Step 1: Extract delugeFunctions object from extension.js
// ---------------------------------------------------------------------------

function extractFromExtension() {
  const source = fs.readFileSync(EXTENSION_PATH, 'utf-8');

  // The object starts at "const delugeFunctions = {" and ends at the matching "};"
  const startMarker = 'const delugeFunctions = {';
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) throw new Error('Could not find delugeFunctions in extension.js');

  // Find matching closing brace by counting braces
  let braceDepth = 0;
  let inString = false;
  let stringChar = '';
  let escapeNext = false;
  let endIdx = -1;

  for (let i = startIdx + startMarker.length - 1; i < source.length; i++) {
    const ch = source[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (!inString) {
      if (ch === "'" || ch === '"' || ch === '`') {
        inString = true;
        stringChar = ch;
      } else if (ch === '{') {
        braceDepth++;
      } else if (ch === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          endIdx = i;
          break;
        }
      }
    } else {
      if (ch === stringChar) {
        inString = false;
      }
    }
  }

  if (endIdx === -1) throw new Error('Could not find closing brace for delugeFunctions');

  const objectSource = source.substring(startIdx + 'const delugeFunctions = '.length, endIdx + 1);

  // Evaluate the object in a sandboxed way (it's plain JS literals, no code execution)
  // We use Function constructor which is safer than eval for this use case
  const fn = new Function('return ' + objectSource);
  return fn();
}

// ---------------------------------------------------------------------------
// Step 2: Categorize functions
// ---------------------------------------------------------------------------

function categorize(name) {
  // Zoho integration namespaces
  if (name.startsWith('zoho.')) return 'integration';
  if (name === 'invokeUrl') return 'integration';
  if (name === 'sendmail' || name === 'openUrl' || name === 'input') return 'common';

  // Encryption
  const encryptionFuncs = new Set([
    'MD5', 'SHA256', 'SHA512', 'base64Encode', 'base64Decode',
    'aesEncode', 'aesDecode', 'aesEncode128', 'aesDecode128',
    'urlEncode', 'urlDecode'
  ]);
  if (encryptionFuncs.has(name)) return 'encryption';

  // XML
  const xmlFuncs = new Set(['toXml', 'toXmlList', 'xmlEncode', 'xmlDecode']);
  if (xmlFuncs.has(name)) return 'xml';

  // File
  const fileFuncs = new Set(['getFileContent', 'toFile']);
  if (fileFuncs.has(name)) return 'file';

  // String functions
  const stringFuncs = new Set([
    'length', 'substring', 'indexOf', 'contains', 'startsWith', 'endsWith',
    'replace', 'replaceAll', 'toLowerCase', 'toUpperCase', 'trim', 'split',
    'equalsIgnoreCase', 'matches', 'subText', 'left', 'right', 'mid',
    'getAlpha', 'getAlphaNumeric', 'proper', 'concat', 'ltrim', 'rtrim',
    'leftpad', 'rightpad', 'reverse', 'repeat', 'removeFirstOccurence',
    'removeLastOccurence', 'lastIndexOf', 'find', 'replaceFirst',
    'containsIgnoreCase', 'startsWithIgnoreCase', 'endsWithIgnoreCase',
    'notContains', 'getPrefix', 'getSuffix', 'getPrefixIgnoreCase',
    'getSuffixIgnoreCase', 'getOccurenceCount', 'len', 'isAscii',
    'hexToText', 'textToHex', 'toText', 'toLong', 'toString',
    'removeAllAlpha', 'removeAllAlphaNumeric', 'replaceAllIgnoreCase',
    'replaceFirstIgnoreCase', 'toMap', 'text'
  ]);
  if (stringFuncs.has(name)) return 'string';

  // Number/Math functions
  const numberFuncs = new Set([
    'floor', 'ceil', 'round', 'abs', 'sqrt', 'pow', 'sin', 'cos', 'tan',
    'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'asinh',
    'acosh', 'atanh', 'exp', 'log', 'log10', 'frac', 'randomNumber',
    'max', 'min', 'toHex', 'toWords', 'signum', 'toNumber', 'toDecimal',
    'isNumber', 'isEven', 'isOdd'
  ]);
  if (numberFuncs.has(name)) return 'number';

  // DateTime functions
  const datetimeFuncs = new Set([
    'addDay', 'addMonth', 'addYear', 'addHour', 'addMinutes', 'toDate',
    'now', 'today', 'subDay', 'subMonth', 'subYear', 'subHour', 'subMinutes',
    'subSeconds', 'addWeek', 'subWeek', 'addSeconds', 'addBusinessDay',
    'subBusinessDay', 'day', 'getDay', 'month', 'getMonth', 'year', 'getYear',
    'hour', 'getHour', 'minute', 'getMinutes', 'second', 'getSeconds',
    'getTime', 'getDateTime', 'daysBetween', 'hoursBetween', 'monthsBetween',
    'yearsBetween', 'totalMonth', 'totalYear', 'days360', 'workday',
    'nextWeekDay', 'previousWeekDay', 'eomonth', 'edate', 'unixEpoch',
    'toDateTimeString', 'toTime', 'isDate', 'weekday',
    'toStartOfMonth', 'toStartOfWeek', 'getDayOfYear', 'getWeekOfYear',
    'monthsDiff', 'toDateTime'
  ]);
  if (datetimeFuncs.has(name)) return 'datetime';

  // List functions
  const listFuncs = new Set([
    'add', 'addAll', 'removeAll', 'removeElement', 'distinct', 'intersect',
    'sort', 'subList', 'average', 'largest', 'smallest', 'median',
    'nthLargest', 'nthSmallest', 'toListString', 'toList', 'toJSONList'
  ]);
  if (listFuncs.has(name)) return 'list';

  // Map functions
  const mapFuncs = new Set([
    'put', 'putAll', 'containsKey', 'containsValue', 'keys', 'values',
    'getKey', 'getLastKey', 'delete', 'deleteAll', 'deleteKey', 'deleteKeys',
    'insert', 'insertAll', 'update', 'sortKey', 'duplicate', 'getJSON'
  ]);
  if (mapFuncs.has(name)) return 'map';

  // Collection constructors / common
  const commonFuncs = new Set([
    'info', 'alert', 'isNull', 'isEmpty', 'ifNull',
    'List', 'Map', 'Collection', 'get', 'remove', 'size', 'count', 'clear',
    'isBlank', 'isText', 'isFile', 'encodeUrl'
  ]);
  if (commonFuncs.has(name)) return 'common';

  return 'common';
}

// ---------------------------------------------------------------------------
// Step 3: Normalize extension entries into the target schema
// ---------------------------------------------------------------------------

function normalizeEntry(name, raw) {
  const entry = {
    signature: raw.signature || '',
    description: raw.description || raw.documentation || '',
    params: [],
    returns: '',
    category: categorize(name)
  };

  // Use documentation field for richer description if available
  if (raw.documentation && raw.documentation !== raw.description) {
    entry.description = raw.documentation;
  }

  if (raw.example) {
    entry.example = raw.example;
  }
  if (raw.params) {
    entry.params = raw.params;
  }
  if (raw.returns) {
    entry.returns = raw.returns;
  }

  return entry;
}

// ---------------------------------------------------------------------------
// Step 4: Functions from the Zoho reference that are NOT in the extension
// ---------------------------------------------------------------------------

function getSupplementaryFunctions() {
  // These are functions found in the scraped Zoho Deluge reference docs
  // that are absent from the BagaduceDigital extension.
  return {
    removeAllAlpha: {
      signature: 'string.removeAllAlpha()',
      description: 'Removes all alphabetic characters from the string, leaving only numbers and special characters.',
      params: [],
      returns: 'string',
      category: 'string',
      example: 'nums = "abc123def456".removeAllAlpha(); // returns "123456"'
    },
    removeAllAlphaNumeric: {
      signature: 'string.removeAllAlphaNumeric()',
      description: 'Removes all alphanumeric characters from the string, leaving only special characters.',
      params: [],
      returns: 'string',
      category: 'string',
      example: 'specials = "abc-123!def".removeAllAlphaNumeric(); // returns "-!"'
    },
    replaceAllIgnoreCase: {
      signature: 'string.replaceAllIgnoreCase(oldString, newString)',
      description: 'Replaces all occurrences of oldString with newString, ignoring case differences.',
      params: [
        { name: 'oldString', type: 'string', description: 'The string to search for (case-insensitive)' },
        { name: 'newString', type: 'string', description: 'The replacement string' }
      ],
      returns: 'string',
      category: 'string',
      example: 'result = "Hello HELLO hello".replaceAllIgnoreCase("hello", "hi");'
    },
    replaceFirstIgnoreCase: {
      signature: 'string.replaceFirstIgnoreCase(oldString, newString)',
      description: 'Replaces the first occurrence of oldString with newString, ignoring case differences.',
      params: [
        { name: 'oldString', type: 'string', description: 'The string to search for (case-insensitive)' },
        { name: 'newString', type: 'string', description: 'The replacement string' }
      ],
      returns: 'string',
      category: 'string',
      example: 'result = "HELLO hello".replaceFirstIgnoreCase("hello", "hi");'
    },
    toMap: {
      signature: 'string.toMap()',
      description: 'Converts a JSON-formatted string to a map (key-value pairs).',
      params: [],
      returns: 'map',
      category: 'string',
      example: 'myMap = \'{"name":"John","age":"30"}\'.toMap();'
    },
    toList: {
      signature: 'string.toList(delimiter)',
      description: 'Splits the string by the delimiter and returns a list. Alias for split() in some contexts.',
      params: [
        { name: 'delimiter', type: 'string', description: 'The delimiter to split on' }
      ],
      returns: 'list',
      category: 'string',
      example: 'items = "a,b,c".toList(",");'
    },
    text: {
      signature: 'number.text(format)',
      description: 'Formats a number as text using the specified format pattern.',
      params: [
        { name: 'format', type: 'string', description: 'The format pattern (e.g., "#,##0.00")' }
      ],
      returns: 'string',
      category: 'number',
      example: 'formatted = 1234.5.text("#,##0.00"); // returns "1,234.50"'
    },
    toStartOfMonth: {
      signature: 'date.toStartOfMonth()',
      description: 'Returns the first day of the month for the given date.',
      params: [],
      returns: 'date',
      category: 'datetime',
      example: 'firstDay = today().toStartOfMonth();'
    },
    toStartOfWeek: {
      signature: 'date.toStartOfWeek()',
      description: 'Returns the first day (Sunday or Monday depending on locale) of the week for the given date.',
      params: [],
      returns: 'date',
      category: 'datetime',
      example: 'weekStart = today().toStartOfWeek();'
    },
    getDayOfYear: {
      signature: 'date.getDayOfYear()',
      description: 'Returns the day of the year (1-366) for the given date.',
      params: [],
      returns: 'number',
      category: 'datetime',
      example: 'dayOfYear = today().getDayOfYear();'
    },
    getWeekOfYear: {
      signature: 'date.getWeekOfYear()',
      description: 'Returns the ISO week number (1-53) for the given date.',
      params: [],
      returns: 'number',
      category: 'datetime',
      example: 'weekNum = today().getWeekOfYear();'
    },
    monthsDiff: {
      signature: 'monthsDiff(startDate, endDate)',
      description: 'Returns the difference in months between two dates. Similar to monthsBetween but may handle partial months differently.',
      params: [
        { name: 'startDate', type: 'date', description: 'The start date' },
        { name: 'endDate', type: 'date', description: 'The end date' }
      ],
      returns: 'number',
      category: 'datetime',
      example: 'diff = monthsDiff(startDate, endDate);'
    },
    totalMonth: {
      signature: 'date.totalMonth()',
      description: 'Returns the total number of months from a base reference date.',
      params: [],
      returns: 'number',
      category: 'datetime',
      example: 'totalMonths = myDate.totalMonth();'
    },
    toDateTime: {
      signature: 'toDateTime(dateTimeString, format)',
      description: 'Parses a date-time string using the specified format and returns a datetime object.',
      params: [
        { name: 'dateTimeString', type: 'string', description: 'The date-time string to parse' },
        { name: 'format', type: 'string', description: 'The format pattern' }
      ],
      returns: 'datetime',
      category: 'datetime',
      example: 'dt = toDateTime("2024-01-29 14:30:00", "yyyy-MM-dd HH:mm:ss");'
    },
    isBlank: {
      signature: 'isBlank(expression)',
      description: 'Checks if a value is blank (null, empty string, or whitespace only). Stricter than isEmpty.',
      params: [
        { name: 'expression', type: 'any', description: 'The value to check' }
      ],
      returns: 'boolean',
      category: 'common',
      example: 'if(isBlank(input.Name)) { alert "Name is required"; }'
    },
    isText: {
      signature: 'isText(value)',
      description: 'Returns true if the value is of type text/string.',
      params: [
        { name: 'value', type: 'any', description: 'The value to check' }
      ],
      returns: 'boolean',
      category: 'common',
      example: 'if(isText(myVar)) { info "It is text"; }'
    },
    isFile: {
      signature: 'isFile(value)',
      description: 'Returns true if the value is of file data type.',
      params: [
        { name: 'value', type: 'any', description: 'The value to check' }
      ],
      returns: 'boolean',
      category: 'common',
      example: 'if(isFile(uploadedDoc)) { info "File received"; }'
    },
    encodeUrl: {
      signature: 'encodeUrl(text)',
      description: 'Encodes text for safe use in URLs. Alternative name for urlEncode.',
      params: [
        { name: 'text', type: 'string', description: 'The text to encode' }
      ],
      returns: 'string',
      category: 'encryption',
      example: 'encoded = encodeUrl("hello world & more");'
    },
    extract: {
      signature: 'file.extract()',
      description: 'Extracts the content of an archive file (e.g., ZIP).',
      params: [],
      returns: 'list',
      category: 'file',
      example: 'files = uploadedZip.extract();'
    },
    'zoho.crm.getRelatedRecords': {
      signature: 'zoho.crm.getRelatedRecords(module_name, record_id, related_module, page, per_page, connection)',
      description: 'Fetches records from a related module linked to a parent record in Zoho CRM.',
      params: [
        { name: 'module_name', type: 'string', description: 'The parent module name' },
        { name: 'record_id', type: 'number', description: 'The parent record ID' },
        { name: 'related_module', type: 'string', description: 'The related module name' },
        { name: 'page', type: 'number', description: 'Page number (optional)' },
        { name: 'per_page', type: 'number', description: 'Records per page (optional)' },
        { name: 'connection', type: 'string', description: 'Connection name (optional)' }
      ],
      returns: 'list',
      category: 'integration',
      example: 'contacts = zoho.crm.getRelatedRecords("Accounts", accountId, "Contacts");'
    },
    'zoho.crm.bulkUpdate': {
      signature: 'zoho.crm.bulkUpdate(module_name, record_ids, values, connection)',
      description: 'Updates multiple records in a Zoho CRM module in a single API call.',
      params: [
        { name: 'module_name', type: 'string', description: 'The module name' },
        { name: 'record_ids', type: 'list', description: 'List of record IDs to update' },
        { name: 'values', type: 'map', description: 'Field values to set' },
        { name: 'connection', type: 'string', description: 'Connection name (optional)' }
      ],
      returns: 'map',
      category: 'integration',
      example: 'response = zoho.crm.bulkUpdate("Leads", idList, {"Status": "Contacted"});'
    },
    'zoho.crm.getOrgVariable': {
      signature: 'zoho.crm.getOrgVariable(variable_api_name)',
      description: 'Retrieves the value of an organization variable from Zoho CRM.',
      params: [
        { name: 'variable_api_name', type: 'string', description: 'The API name of the org variable' }
      ],
      returns: 'string',
      category: 'integration',
      example: 'value = zoho.crm.getOrgVariable("API_Key");'
    },
    'zoho.crm.updateOrgVariable': {
      signature: 'zoho.crm.updateOrgVariable(variable_api_name, value)',
      description: 'Updates the value of an organization variable in Zoho CRM.',
      params: [
        { name: 'variable_api_name', type: 'string', description: 'The API name of the org variable' },
        { name: 'value', type: 'string', description: 'The new value' }
      ],
      returns: 'void',
      category: 'integration',
      example: 'zoho.crm.updateOrgVariable("Last_Sync_Time", now().toString());'
    },
    'zoho.crm.getUsers': {
      signature: 'zoho.crm.getUsers(type, page, per_page)',
      description: 'Retrieves users from Zoho CRM organization.',
      params: [
        { name: 'type', type: 'string', description: 'User type: AllUsers, ActiveUsers, DeactiveUsers, etc.' },
        { name: 'page', type: 'number', description: 'Page number (optional)' },
        { name: 'per_page', type: 'number', description: 'Records per page (optional)' }
      ],
      returns: 'list',
      category: 'integration',
      example: 'users = zoho.crm.getUsers("ActiveUsers", 1, 200);'
    },
    'zoho.books.getRecordById': {
      signature: 'zoho.books.getRecordById(organization_id, module_name, record_id, connection)',
      description: 'Fetches a specific record from Zoho Books by ID.',
      params: [
        { name: 'organization_id', type: 'string', description: 'The Books organization ID' },
        { name: 'module_name', type: 'string', description: 'The module name' },
        { name: 'record_id', type: 'string', description: 'The record ID' },
        { name: 'connection', type: 'string', description: 'Connection name (optional)' }
      ],
      returns: 'map',
      category: 'integration',
      example: 'invoice = zoho.books.getRecordById("749684621", "invoices", invoiceId);'
    },
    'zoho.books.deleteRecord': {
      signature: 'zoho.books.deleteRecord(organization_id, module_name, record_id, connection)',
      description: 'Deletes a record from Zoho Books.',
      params: [
        { name: 'organization_id', type: 'string', description: 'The Books organization ID' },
        { name: 'module_name', type: 'string', description: 'The module name' },
        { name: 'record_id', type: 'string', description: 'The record ID' },
        { name: 'connection', type: 'string', description: 'Connection name (optional)' }
      ],
      returns: 'map',
      category: 'integration',
      example: 'response = zoho.books.deleteRecord("749684621", "invoices", invoiceId);'
    },
    'zoho.creator.getRecords': {
      signature: 'zoho.creator.getRecords(owner_name, app_link_name, report_link_name, criteria, from_index, limit, connection)',
      description: 'Fetches records from a Zoho Creator report with optional criteria filtering.',
      params: [
        { name: 'owner_name', type: 'string', description: 'The app owner name' },
        { name: 'app_link_name', type: 'string', description: 'The app link name' },
        { name: 'report_link_name', type: 'string', description: 'The report link name' },
        { name: 'criteria', type: 'string', description: 'Filter criteria (optional)' },
        { name: 'from_index', type: 'number', description: 'Start index (optional)' },
        { name: 'limit', type: 'number', description: 'Max records to return (optional)' },
        { name: 'connection', type: 'string', description: 'Connection name (optional)' }
      ],
      returns: 'list',
      category: 'integration',
      example: 'jobs = zoho.creator.getRecords("degroot", "fsm", "All_Jobs", "(Stage == \\"Job Created\\")", 0, 200);'
    },
    'zoho.creator.getRecordById': {
      signature: 'zoho.creator.getRecordById(owner_name, app_link_name, report_link_name, record_id, connection)',
      description: 'Fetches a single record from Zoho Creator by ID.',
      params: [
        { name: 'owner_name', type: 'string', description: 'The app owner name' },
        { name: 'app_link_name', type: 'string', description: 'The app link name' },
        { name: 'report_link_name', type: 'string', description: 'The report link name' },
        { name: 'record_id', type: 'number', description: 'The record ID' },
        { name: 'connection', type: 'string', description: 'Connection name (optional)' }
      ],
      returns: 'map',
      category: 'integration',
      example: 'job = zoho.creator.getRecordById("degroot", "fsm", "All_Jobs", 12345);'
    },
    'zoho.creator.deleteRecord': {
      signature: 'zoho.creator.deleteRecord(owner_name, app_link_name, form_link_name, record_id, connection)',
      description: 'Deletes a record from Zoho Creator.',
      params: [
        { name: 'owner_name', type: 'string', description: 'The app owner name' },
        { name: 'app_link_name', type: 'string', description: 'The app link name' },
        { name: 'form_link_name', type: 'string', description: 'The form link name' },
        { name: 'record_id', type: 'number', description: 'The record ID' },
        { name: 'connection', type: 'string', description: 'Connection name (optional)' }
      ],
      returns: 'map',
      category: 'integration',
      example: 'response = zoho.creator.deleteRecord("degroot", "fsm", "Job", 12345);'
    },
    'zoho.loginuserid': {
      signature: 'zoho.loginuserid',
      description: 'Built-in variable that returns the login user ID (email) of the currently logged-in user.',
      params: [],
      returns: 'string',
      category: 'integration',
      example: 'userId = zoho.loginuserid;'
    },
    'zoho.appuri': {
      signature: 'zoho.appuri',
      description: 'Built-in variable that returns the application URI in Zoho Creator.',
      params: [],
      returns: 'string',
      category: 'integration',
      example: 'uri = zoho.appuri;'
    },
    'zoho.adminuserid': {
      signature: 'zoho.adminuserid',
      description: 'Built-in variable that returns the admin user ID of the application.',
      params: [],
      returns: 'string',
      category: 'integration',
      example: 'admin = zoho.adminuserid;'
    }
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('Extracting Deluge functions from BagaduceDigital extension...');

  const rawFunctions = extractFromExtension();
  const extensionCount = Object.keys(rawFunctions).length;
  console.log(`  Found ${extensionCount} functions in extension.js`);

  // Normalize extension entries
  const functions = {};
  for (const [name, raw] of Object.entries(rawFunctions)) {
    functions[name] = normalizeEntry(name, raw);
  }

  // Add supplementary functions from the reference
  const supplementary = getSupplementaryFunctions();
  let addedCount = 0;
  for (const [name, entry] of Object.entries(supplementary)) {
    if (!functions[name]) {
      functions[name] = entry;
      addedCount++;
    }
  }
  console.log(`  Added ${addedCount} supplementary functions from Zoho reference`);

  const totalCount = Object.keys(functions).length;
  console.log(`  Total: ${totalCount} functions`);

  // Build output
  const output = {
    functions,
    metadata: {
      source: 'bagaducedigital.deluge-lang-0.6.1',
      supplementarySource: 'zoho-deluge-reference (zoho.com/deluge/help)',
      extractedAt: new Date().toISOString(),
      extensionCount,
      supplementaryCount: addedCount,
      count: totalCount
    }
  };

  // Write JSON
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nOutput written to: ${OUTPUT_PATH}`);
  console.log(`Total functions: ${totalCount}`);
}

main();
