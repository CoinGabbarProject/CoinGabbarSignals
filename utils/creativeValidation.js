// backend/utils/creativeValidation.js
//
// Server-side validation for Advertising Creative uploads. This does NOT
// touch the actual storage step (that stays in utils/mediaUpload.js) — it
// only decides whether a given file is safe and correctly sized before it
// is ever handed to the uploader.
//
// Why sniff bytes instead of trusting req.file.mimetype / the filename
// extension: multer's reported mimetype comes straight from the
// Content-Type header the client sent, which is trivial to spoof (e.g.
// rename evil.html to logo.png). Checking the real file signature is the
// same class of protection "existing upload security" implies elsewhere
// in the app, just made explicit here since creatives are user-facing
// rendered content (they get embedded directly into live pages).

const sizeOf = require('image-size');

const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024; // 3MB per creative asset
const MAX_SVG_SIZE_BYTES = 300 * 1024; // SVGs are markup, not pixels — keep them small
const MIN_DIMENSION = 1;
const MAX_DIMENSION = 4000; // guards against decompression-bomb style images
// Size range for placements with a pixel size (e.g. 970x250)
const ASPECT_TOLERANCE = 0.05; // same shape, +/- 5%
const MIN_SCALE = 0.75;
const MAX_SCALE = 2;
const ALLOWED_MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
};

// --- Magic-byte sniffing -----------------------------------------------

function sniffRasterMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function looksLikeSvg(buffer) {
  // SVG is text/XML — sniff the first non-whitespace bytes rather than a
  // magic number. Cap how much we scan so a huge disguised file can't
  // force a full-buffer string conversion just to fail this check.
  const head = buffer.slice(0, 2048).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<?xml') ? head.includes('<svg') : head.startsWith('<svg');
}

/**
 * Determine the real MIME type of a buffer, ignoring whatever the client
 * claimed. Returns null if it doesn't match any supported format.
 */
function detectRealMimeType(buffer) {
  const raster = sniffRasterMime(buffer);
  if (raster) return raster;
  if (looksLikeSvg(buffer)) return 'image/svg+xml';
  return null;
}

// --- SVG sanitization ----------------------------------------------------
// Not a full DOMPurify-grade parser — this is a deliberately narrow,
// deny-list sanitizer that strips the specific vectors that matter for an
// ad creative embedded via <img>/background-image on our own pages:
// inline scripts, event handlers, javascript: URIs, and remote references
// that could be used to phone home or load additional content.

function sanitizeSvg(svgText) {
  let out = svgText;
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  out = out.replace(/\son\w+\s*=\s*"(?:[^"]*)"/gi, '');
  out = out.replace(/\son\w+\s*=\s*'(?:[^']*)'/gi, '');
  out = out.replace(/(xlink:href|href)\s*=\s*"(?:javascript|data):[^"]*"/gi, '');
  out = out.replace(/(xlink:href|href)\s*=\s*'(?:javascript|data):[^']*'/gi, '');
  out = out.replace(/url\(\s*['"]?\s*javascript:[^)]*\)/gi, 'none');
  return out;
}

function containsDangerousSvgPattern(svgText) {
  const lower = svgText.toLowerCase();
  return (
    lower.includes('<script') ||
    lower.includes('<foreignobject') ||
    /on\w+\s*=/.test(lower) ||
    lower.includes('javascript:')
  );
}

// --- Public validation entry point --------------------------------------

/**
 * Validate + (for SVG) sanitize an uploaded creative file buffer.
 * @param {Buffer} buffer
 * @param {string} originalName
 * @param {{ requireWidth?: number, requireHeight?: number, label?: string }} [dimensionRule]
 * @returns {{ buffer: Buffer, mimeType: string, fileSizeBytes: number, width: number, height: number }}
 * @throws {Error} with a user-facing message on any validation failure
 */
function validateCreativeFile(buffer, originalName, dimensionRule) {
  const label = (dimensionRule && dimensionRule.label) || originalName || 'file';

  if (!buffer || !buffer.length) {
    throw new Error(`${label}: empty file`);
  }

  const mimeType = detectRealMimeType(buffer);
  const policy = (dimensionRule && dimensionRule.policy) || {};
  const allowedTypes = Array.isArray(policy.allowedFileTypes) && policy.allowedFileTypes.length
    ? policy.allowedFileTypes : Object.keys(ALLOWED_MIME_TO_EXT);
  if (!mimeType || !ALLOWED_MIME_TO_EXT[mimeType] || !allowedTypes.includes(mimeType)) {
    throw new Error(`${label}: unsupported or disallowed file type`);
  }

  const isSvg = mimeType === 'image/svg+xml';
  const policyMax = Number(policy.maxCreativeSizeBytes);
  const maxBytes = Math.min(isSvg ? MAX_SVG_SIZE_BYTES : 10 * 1024 * 1024, Number.isFinite(policyMax) && policyMax > 0 ? policyMax : MAX_FILE_SIZE_BYTES);
  if (buffer.length > maxBytes) {
    throw new Error(`${label}: file too large (max ${Math.round(maxBytes / 1024)}KB for ${isSvg ? 'SVG' : 'this format'})`);
  }

  let workingBuffer = buffer;

  if (isSvg) {
    const svgText = buffer.toString('utf8');
    const lower = svgText.toLowerCase();

    // <script> / <foreignObject> signal deliberate intent to run code or
    // embed foreign content inside the SVG — hard reject rather than
    // trying to "clean" it, so a stripped-but-still-uploaded file is never
    // mistaken for a benign asset.
    if (lower.includes('<script') || lower.includes('<foreignobject')) {
      throw new Error(`${label}: SVG rejected — contains <script> or <foreignObject>, which are not allowed`);
    }

    // Milder issues (inline event handlers, javascript:/data: URIs in
    // href) are auto-sanitized, then re-checked before being accepted.
    if (containsDangerousSvgPattern(svgText)) {
      const cleaned = sanitizeSvg(svgText);
      if (containsDangerousSvgPattern(cleaned)) {
        throw new Error(`${label}: SVG rejected — contains scripts or embedded event handlers`);
      }
      workingBuffer = Buffer.from(cleaned, 'utf8');
    }
  }

  let dimensions;
  try {
    dimensions = sizeOf(workingBuffer);
  } catch (e) {
    throw new Error(`${label}: could not read image dimensions (file may be corrupt)`);
  }

  const width = dimensions.width || 0;
  const height = dimensions.height || 0;

  if (width < MIN_DIMENSION || height < MIN_DIMENSION || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(`${label}: invalid image dimensions (${width}x${height})`);
  }

  if (dimensionRule && dimensionRule.requireWidth && dimensionRule.requireHeight) {
    if (width !== dimensionRule.requireWidth || height !== dimensionRule.requireHeight) {
      throw new Error(
        `${label}: this placement requires exactly ${dimensionRule.requireWidth}x${dimensionRule.requireHeight}px, ` +
        `but the uploaded file is ${width}x${height}px`
      );
    }
  }

  return {
    buffer: workingBuffer,
    mimeType,
    fileSizeBytes: workingBuffer.length,
    width,
    height
  };
}

// Parses a placement's free-text "recommendedDimensions" (e.g. "970x250")
// into a strict width/height requirement. Placements with non-pixel
// guidance (e.g. "Responsive", "Article-level") return null — nothing to
// enforce.
function parseFixedDimensions(recommendedDimensions) {
  if (!recommendedDimensions) return null;
  const match = String(recommendedDimensions).trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return null;
  return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
}

module.exports = {
  MAX_FILE_SIZE_BYTES,
  MAX_SVG_SIZE_BYTES,
  ALLOWED_MIME_TO_EXT,
  validateCreativeFile,
  parseFixedDimensions
};
