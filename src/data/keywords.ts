/**
 * Deluge language keywords and control flow constructs.
 */
export const DELUGE_KEYWORDS: string[] = [
    // Control flow
    'if',
    'else if',
    'else',
    'for each',
    'in',
    'break',
    'continue',
    'return',
    'try',
    'catch',

    // Declarations
    'void',
    'info',
    'alert',

    // Data types
    'string',
    'int',
    'float',
    'bool',
    'list',
    'map',
    'collection',
    'file',
    'date',
    'dateTime',

    // Boolean literals
    'true',
    'false',
    'null',

    // Integration
    'invokeurl',
    'sendmail',
    'openUrl',
    'zoho',

    // CRM-specific
    'thisapp',
    'input',
];

/**
 * Deluge built-in type methods available via dot notation.
 */
export const TYPE_METHODS: Record<string, string[]> = {
    string: [
        'length', 'contains', 'startsWith', 'endsWith', 'indexOf',
        'lastIndexOf', 'substring', 'trim', 'toLowerCase', 'toUpperCase',
        'replaceAll', 'replaceFirst', 'split', 'toList', 'toLong',
        'toDecimal', 'getPrefix', 'getSuffix', 'isNumber', 'isAlpha',
        'isAlphaNumeric', 'isEmpty', 'matches', 'equalsIgnoreCase',
        'leftPad', 'rightPad', 'removeFirstOccurrence', 'removeLastOccurrence',
        'toDate', 'toDateTime', 'toTime', 'toString',
    ],
    list: [
        'add', 'addAll', 'remove', 'removeAll', 'get', 'set', 'size',
        'isEmpty', 'contains', 'containsAll', 'indexOf', 'lastIndexOf',
        'sort', 'distinct', 'subList', 'toMap', 'toString',
    ],
    map: [
        'put', 'putAll', 'get', 'remove', 'containsKey', 'containsValue',
        'keys', 'values', 'size', 'isEmpty', 'toString', 'toJSONString',
    ],
    number: [
        'round', 'ceil', 'floor', 'abs', 'toLong', 'toDecimal', 'toString',
        'pow', 'sqrt', 'log', 'max', 'min',
    ],
    date: [
        'getDay', 'getMonth', 'getYear', 'getDayOfWeek', 'addDay',
        'addMonth', 'addYear', 'subDay', 'subMonth', 'subYear',
        'toString', 'toDateTime', 'daysBetween',
    ],
};
