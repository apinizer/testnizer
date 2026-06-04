/**
 * HTTP status code reference (RFC 9110 + IANA registry, common WebDAV codes).
 * Categories used by the UI:
 *   1xx — Informational
 *   2xx — Successful
 *   3xx — Redirection
 *   4xx — Client error
 *   5xx — Server error
 */

export type HttpStatus = {
  code: number
  name: string
  category: '1xx' | '2xx' | '3xx' | '4xx' | '5xx'
  description: string
}

export const HTTP_STATUS_CODES: HttpStatus[] = [
  // ── 1xx ──────────────────────────────────────────────────
  {
    code: 100,
    name: 'Continue',
    category: '1xx',
    description:
      'The initial part of the request has been received and the client should continue with the rest of the request.',
  },
  {
    code: 101,
    name: 'Switching Protocols',
    category: '1xx',
    description:
      "The server is switching protocols as requested by the client's Upgrade header (e.g. to WebSocket).",
  },
  {
    code: 102,
    name: 'Processing',
    category: '1xx',
    description: 'WebDAV: the server has received the request but no response is available yet.',
  },
  {
    code: 103,
    name: 'Early Hints',
    category: '1xx',
    description:
      'Used to return preliminary headers (e.g. Link: rel=preload) before the final response.',
  },

  // ── 2xx ──────────────────────────────────────────────────
  { code: 200, name: 'OK', category: '2xx', description: 'Standard success response.' },
  {
    code: 201,
    name: 'Created',
    category: '2xx',
    description:
      'The request succeeded and a new resource was created. Location header points at it.',
  },
  {
    code: 202,
    name: 'Accepted',
    category: '2xx',
    description: 'The request was accepted for processing but processing is asynchronous.',
  },
  {
    code: 203,
    name: 'Non-Authoritative Information',
    category: '2xx',
    description: 'Response headers were modified by an intermediate proxy / transformation.',
  },
  {
    code: 204,
    name: 'No Content',
    category: '2xx',
    description: 'The request succeeded; the response intentionally has no body.',
  },
  {
    code: 205,
    name: 'Reset Content',
    category: '2xx',
    description: 'Like 204, but the client should reset the document view that caused the request.',
  },
  {
    code: 206,
    name: 'Partial Content',
    category: '2xx',
    description: 'Range request succeeded; only the requested byte range is returned.',
  },
  {
    code: 207,
    name: 'Multi-Status',
    category: '2xx',
    description: 'WebDAV: response carries XML describing multiple individual statuses.',
  },
  {
    code: 208,
    name: 'Already Reported',
    category: '2xx',
    description: 'WebDAV: bindings already enumerated in a preceding response part.',
  },
  {
    code: 226,
    name: 'IM Used',
    category: '2xx',
    description: 'Server has fulfilled a GET using one or more instance-manipulations.',
  },

  // ── 3xx ──────────────────────────────────────────────────
  {
    code: 300,
    name: 'Multiple Choices',
    category: '3xx',
    description: 'Multiple representations are available; the client should choose one.',
  },
  {
    code: 301,
    name: 'Moved Permanently',
    category: '3xx',
    description: 'The resource has a new permanent URL — clients should update bookmarks.',
  },
  {
    code: 302,
    name: 'Found',
    category: '3xx',
    description: 'The resource is temporarily at another URL.',
  },
  {
    code: 303,
    name: 'See Other',
    category: '3xx',
    description: 'After POST, redirects the client to GET another resource.',
  },
  {
    code: 304,
    name: 'Not Modified',
    category: '3xx',
    description: 'Conditional GET — the cached copy is still valid.',
  },
  {
    code: 305,
    name: 'Use Proxy',
    category: '3xx',
    description: 'Deprecated. Resource must be accessed through the indicated proxy.',
  },
  {
    code: 307,
    name: 'Temporary Redirect',
    category: '3xx',
    description: 'Like 302, but the request method must NOT change when following the redirect.',
  },
  {
    code: 308,
    name: 'Permanent Redirect',
    category: '3xx',
    description: 'Like 301, but the request method must NOT change when following the redirect.',
  },

  // ── 4xx ──────────────────────────────────────────────────
  {
    code: 400,
    name: 'Bad Request',
    category: '4xx',
    description:
      'The server cannot process the request due to client error (malformed syntax, etc.).',
  },
  {
    code: 401,
    name: 'Unauthorized',
    category: '4xx',
    description: 'Authentication is required (or has failed). WWW-Authenticate header must be set.',
  },
  {
    code: 402,
    name: 'Payment Required',
    category: '4xx',
    description: 'Reserved for future use; rarely seen in production.',
  },
  {
    code: 403,
    name: 'Forbidden',
    category: '4xx',
    description: 'Authenticated, but the client is not allowed to access this resource.',
  },
  {
    code: 404,
    name: 'Not Found',
    category: '4xx',
    description: 'The resource does not exist (or the server hides its existence).',
  },
  {
    code: 405,
    name: 'Method Not Allowed',
    category: '4xx',
    description:
      'The HTTP method is not supported for the target resource. Allow header lists allowed.',
  },
  {
    code: 406,
    name: 'Not Acceptable',
    category: '4xx',
    description: 'The resource cannot produce a representation acceptable to the Accept headers.',
  },
  {
    code: 407,
    name: 'Proxy Authentication Required',
    category: '4xx',
    description: 'Like 401, but authentication must be performed against an intermediate proxy.',
  },
  {
    code: 408,
    name: 'Request Timeout',
    category: '4xx',
    description: 'The server timed out waiting for the request.',
  },
  {
    code: 409,
    name: 'Conflict',
    category: '4xx',
    description:
      'The request conflicts with current state of the resource (e.g. version mismatch).',
  },
  {
    code: 410,
    name: 'Gone',
    category: '4xx',
    description: 'The resource is permanently removed and no forwarding address is known.',
  },
  {
    code: 411,
    name: 'Length Required',
    category: '4xx',
    description: 'The Content-Length header is required but was not provided.',
  },
  {
    code: 412,
    name: 'Precondition Failed',
    category: '4xx',
    description: 'A condition in If-Match / If-None-Match / etc. was not met.',
  },
  {
    code: 413,
    name: 'Content Too Large',
    category: '4xx',
    description: 'Request body exceeds the size the server is willing to process.',
  },
  {
    code: 414,
    name: 'URI Too Long',
    category: '4xx',
    description: 'The request URI is longer than the server can interpret.',
  },
  {
    code: 415,
    name: 'Unsupported Media Type',
    category: '4xx',
    description: 'The request body media type is not supported by the resource.',
  },
  {
    code: 416,
    name: 'Range Not Satisfiable',
    category: '4xx',
    description: 'A Range header value is outside the available content range.',
  },
  {
    code: 417,
    name: 'Expectation Failed',
    category: '4xx',
    description: 'An Expect header expectation could not be met by the server.',
  },
  {
    code: 418,
    name: "I'm a teapot",
    category: '4xx',
    description: 'RFC 2324 (April Fools, 1998). Used by some APIs for "computer says no".',
  },
  {
    code: 421,
    name: 'Misdirected Request',
    category: '4xx',
    description: 'The request was directed at a server that is not able to produce a response.',
  },
  {
    code: 422,
    name: 'Unprocessable Content',
    category: '4xx',
    description: 'Request is well-formed but semantically invalid (e.g. validation error).',
  },
  {
    code: 423,
    name: 'Locked',
    category: '4xx',
    description: 'WebDAV: the source or destination resource is locked.',
  },
  {
    code: 424,
    name: 'Failed Dependency',
    category: '4xx',
    description: 'WebDAV: the request failed because of a previous request failure.',
  },
  {
    code: 425,
    name: 'Too Early',
    category: '4xx',
    description: 'Server is unwilling to process a request that might be replayed.',
  },
  {
    code: 426,
    name: 'Upgrade Required',
    category: '4xx',
    description: 'The client must upgrade to a different protocol (Upgrade header lists which).',
  },
  {
    code: 428,
    name: 'Precondition Required',
    category: '4xx',
    description: 'The origin server requires the request to be conditional (avoids lost updates).',
  },
  {
    code: 429,
    name: 'Too Many Requests',
    category: '4xx',
    description: 'Rate limit exceeded. Retry-After header may indicate when to retry.',
  },
  {
    code: 431,
    name: 'Request Header Fields Too Large',
    category: '4xx',
    description: 'Server is unwilling to process the request because its headers are too large.',
  },
  {
    code: 451,
    name: 'Unavailable For Legal Reasons',
    category: '4xx',
    description:
      'The resource is blocked due to legal demands (RFC 7725 — 451 references Fahrenheit 451).',
  },

  // ── 5xx ──────────────────────────────────────────────────
  {
    code: 500,
    name: 'Internal Server Error',
    category: '5xx',
    description: 'A generic server-side error — something went wrong on the server.',
  },
  {
    code: 501,
    name: 'Not Implemented',
    category: '5xx',
    description: 'The server does not support the functionality required to fulfill the request.',
  },
  {
    code: 502,
    name: 'Bad Gateway',
    category: '5xx',
    description: 'An upstream server returned an invalid response to the gateway / proxy.',
  },
  {
    code: 503,
    name: 'Service Unavailable',
    category: '5xx',
    description: 'Temporarily overloaded or down for maintenance. Retry-After may be set.',
  },
  {
    code: 504,
    name: 'Gateway Timeout',
    category: '5xx',
    description: 'A gateway / proxy did not get a response from the upstream in time.',
  },
  {
    code: 505,
    name: 'HTTP Version Not Supported',
    category: '5xx',
    description: 'The HTTP version used in the request is not supported by the server.',
  },
  {
    code: 506,
    name: 'Variant Also Negotiates',
    category: '5xx',
    description: 'Transparent content negotiation has resulted in a circular reference.',
  },
  {
    code: 507,
    name: 'Insufficient Storage',
    category: '5xx',
    description: 'WebDAV: server cannot store the representation needed to complete the request.',
  },
  {
    code: 508,
    name: 'Loop Detected',
    category: '5xx',
    description: 'WebDAV: the server detected an infinite loop while processing the request.',
  },
  {
    code: 510,
    name: 'Not Extended',
    category: '5xx',
    description: 'Further extensions to the request are required for the server to fulfill it.',
  },
  {
    code: 511,
    name: 'Network Authentication Required',
    category: '5xx',
    description: 'The client must authenticate to gain network access (e.g. captive portal).',
  },
]
