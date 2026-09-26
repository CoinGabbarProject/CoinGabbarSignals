// backend/utils/urlValidation.js
//
// Server-side validation for Advertisement destination URLs and page-URL
// targeting patterns. This is deliberately separate from the click-through
// delivery logic — it only decides whether a value is safe/well-formed to
// store, it never fetches, redirects to, or executes anything.
//
// Reasoning for the two allowed schemes: this project already accepts a
// bare "example.com" for Advertiser.website (see advertiserController's
// normalizeUrl) and auto-upgrades it to https. Destination URLs follow the
// same UX convention, but additionally hard-reject any scheme that could
// execute code in the browser when used as an href/onclick target.

const DANGEROUS_SCHEME_RE = /^(javascript|data|vbscript|file|blob):/i;

// Strips characters browsers ignore when parsing a URL scheme (tabs,
// newlines, carriage returns). Without this, a value like
// "java\tscript:alert(1)" would slip past a naive scheme check but still
// be interpreted as "javascript:" once rendered.
function stripUrlWhitespace(raw) {
  return String(raw).replace(/[\t\r\n]/g, '');
}

/**
 * Validate + normalize an Advertisement destination URL.
 * @param {string} raw
 * @param {{ allowHttp?: boolean }} [opts] allowHttp defaults to true since
 *   this project has no existing https-only enforcement elsewhere (Advertiser
 *   website accepts either scheme once normalized).
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
function validateDestinationUrl(raw, opts = {}) {
  const allowHttp = opts.allowHttp !== false;

  if (!raw || !String(raw).trim()) {
    return { ok: false, error: 'destination_url is required' };
  }

  const cleaned = stripUrlWhitespace(String(raw).trim());

  if (DANGEROUS_SCHEME_RE.test(cleaned)) {
    return { ok: false, error: 'destination_url uses a disallowed scheme' };
  }

  const withProtocol = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;

  let parsed;
  try {
    parsed = new URL(withProtocol);
  } catch (err) {
    return { ok: false, error: 'destination_url is not a valid URL' };
  }

  const allowedProtocols = allowHttp ? ['http:', 'https:'] : ['https:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    return { ok: false, error: 'destination_url uses a disallowed scheme' };
  }

  return { ok: true, url: parsed.toString() };
}

// Cheap boolean version for use as a mongoose schema-level validator
// (defense in depth — the real normalization happens via
// validateDestinationUrl in the controller layer, same division of labor
// as Campaign's schema vs. campaignController.buildFields).
function isSafeUrlScheme(raw) {
  return validateDestinationUrl(raw).ok;
}

// --- URL pattern targeting (e.g. "/en/news/*") ---------------------------
//
// Patterns are matching rules only — they are never eval'd, never used to
// build a shell command, and never passed to a regex engine that accepts
// arbitrary user syntax. Only a narrow, predictable charset + a single
// trailing "*" wildcard is allowed.

const URL_PATTERN_RE = /^\/[a-z0-9\-\/]*\*?$/i;
const MAX_URL_PATTERN_LENGTH = 200;

/**
 * @param {string} raw e.g. "/en/news/*"
 * @returns {{ ok: true, pattern: string } | { ok: false, error: string }}
 */
function validateUrlPattern(raw) {
  if (!raw || !String(raw).trim()) {
    return { ok: false, error: 'URL pattern is required' };
  }
  const pattern = String(raw).trim();

  if (pattern.length > MAX_URL_PATTERN_LENGTH) {
    return { ok: false, error: `URL pattern must be ${MAX_URL_PATTERN_LENGTH} characters or fewer` };
  }
  if (!pattern.startsWith('/')) {
    return { ok: false, error: 'URL pattern must start with "/"' };
  }
  if (!URL_PATTERN_RE.test(pattern)) {
    return { ok: false, error: 'URL pattern may only contain letters, numbers, hyphens, "/" and a trailing "*"' };
  }
  // A "*" is only meaningful as the final path segment marker.
  if (pattern.includes('*') && !pattern.endsWith('*')) {
    return { ok: false, error: 'URL pattern "*" is only allowed at the end' };
  }

  return { ok: true, pattern };
}

// Turns a validated "/en/news/*" pattern into a predictable matcher.
// Intentionally does not use RegExp(pattern) directly on unsanitized
// input — the pattern was already restricted to a safe charset by
// validateUrlPattern, but we still escape before compiling so this stays
// safe even if called on unvalidated input by mistake.
function urlPatternMatches(pattern, path) {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*$/, '.*');
  const re = new RegExp(`^${escaped}$`, 'i');
  return re.test(String(path || ''));
}

module.exports = {
  validateDestinationUrl,
  isSafeUrlScheme,
  validateUrlPattern,
  urlPatternMatches,
  MAX_URL_PATTERN_LENGTH
};
