// backend/utils/advertisementLogic.js
//
// Pure(-ish) business logic for the Advertisement entity: stable type/
// status vocabularies, status-transition rules, targeting validation, and
// placement/creative compatibility checks.
//
// This file deliberately takes already-fetched documents (advertiser,
// campaign, placement docs, creative docs) as plain arguments rather than
// querying the database itself — that keeps every function here testable
// without a DB connection, and keeps the actual fetch/authorize/persist
// orchestration in the controller layer, same separation campaignController
// already uses (validatePayload/buildFields are pure, the exported route
// handlers do the I/O).
//
// PART 7A-2 (API endpoints/action handlers) is expected to call into this
// module rather than re-implementing any of these rules inline.

const { parseFixedDimensions } = require('./creativeValidation');
const { validateUrlPattern, urlPatternMatches } = require('./urlValidation');

/* ============================================================
   ADVERTISEMENT TYPES
   Stable internal keys only — human-readable labels belong in the
   application/console layer, not scattered through the backend.
============================================================ */
const ADVERTISEMENT_TYPES = [
  'display_banner',
  'sponsored_article',
  'homepage_feature',
  'newsletter_promotion',
  'native_advertisement',
  'text_advertisement',
  'custom_advertisement'
];
const DEFAULT_ADVERTISEMENT_TYPE = 'display_banner';

/* ============================================================
   STATUS MODEL
   Mirrors the vocabulary Campaign already established
   (draft/pending_review/approved/scheduled/active/paused/expired), plus
   "archived" for Advertisement's own soft-delete/end-of-life state.
   New advertisements MUST start at "draft" — nothing in this module ever
   returns "active" as a default.
============================================================ */
const ADVERTISEMENT_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'scheduled',
  'active',
  'paused',
  'expired',
  'archived'
];
const DEFAULT_ADVERTISEMENT_STATUS = 'draft';

// Allowed forward transitions. Deliberately a plain allow-list rather than
// "anything goes" — Part 7A-2's permission layer decides *who* may invoke
// a transition; this decides which transitions are structurally valid at
// all, regardless of who's asking.
const STATUS_TRANSITIONS = {
  draft: ['pending_review', 'archived'],
  pending_review: ['approved', 'draft', 'archived'],
  approved: ['scheduled', 'archived'],
  scheduled: ['active', 'archived'],
  active: ['paused', 'expired'],
  paused: ['active', 'expired'],
  expired: ['archived'],
  archived: []
};

function canTransitionStatus(from, to) {
  if (!ADVERTISEMENT_STATUSES.includes(from) || !ADVERTISEMENT_STATUSES.includes(to)) return false;
  if (from === to) return false;
  return (STATUS_TRANSITIONS[from] || []).includes(to);
}

/* ============================================================
   PAGE TARGETING
   Kept as Advertisement-specific keys rather than reusing Article.section
   directly: some required options ("Homepage", "Ranking", "Article
   Category", "Specific Article") aren't Article-section concepts at all
   (Homepage/Rankings are standalone pages; category/article are handled
   via the targeting.categories / targeting.articles id arrays, not a page
   key). "news"/"price-prediction"/"academy" intentionally match
   Article.section values so matching stays a simple equality check for
   the future delivery function. "crypto-explained" doesn't correspond to
   an existing Article.section yet — kept here anyway since it's an
   explicit requirement, and it's harmless as an unused enum value until
   that section exists.
============================================================ */
const PAGE_TARGETING_KEYS = [
  'all',
  'homepage',
  'news',
  'price-prediction',
  'crypto-explained',
  'academy',
  'ranking',
  'category',
  'article'
];

const DEVICE_TARGETING_VALUES = ['desktop', 'mobile', 'tablet'];
// Matches Article.language exactly so targeting can be compared directly
// against an Article document without a translation table.
const LANGUAGE_TARGETING_VALUES = ['en', 'hi'];

/**
 * Validate a targeting payload shape. Does not hit the database — id
 * arrays (categories/articles) are only checked for well-formedness here;
 * existence is the controller's job (same division as advertiser/campaign
 * existence checks elsewhere in this module).
 * @returns {string[]} list of error strings (empty = valid)
 */
function validateTargeting(targeting, isValidObjectId) {
  const errors = [];
  if (!targeting || typeof targeting !== 'object') return errors; // targeting is optional; empty = no restriction

  const { pages, devices, languages, categories, articles, urlPatterns } = targeting;

  if (pages !== undefined) {
    if (!Array.isArray(pages)) errors.push('targeting.pages must be an array');
    else pages.forEach((p) => {
      if (!PAGE_TARGETING_KEYS.includes(p)) errors.push(`targeting.pages contains an unrecognized value: ${p}`);
    });
    if (Array.isArray(pages) && pages.includes('category') && (!Array.isArray(categories) || !categories.length)) {
      errors.push('targeting.categories is required when targeting.pages includes "category"');
    }
    if (Array.isArray(pages) && pages.includes('article') && (!Array.isArray(articles) || !articles.length)) {
      errors.push('targeting.articles is required when targeting.pages includes "article"');
    }
  }

  if (devices !== undefined) {
    if (!Array.isArray(devices)) errors.push('targeting.devices must be an array');
    else devices.forEach((d) => {
      if (!DEVICE_TARGETING_VALUES.includes(d)) errors.push(`targeting.devices contains an unrecognized value: ${d}`);
    });
  }

  if (languages !== undefined) {
    if (!Array.isArray(languages)) errors.push('targeting.languages must be an array');
    else languages.forEach((l) => {
      if (!LANGUAGE_TARGETING_VALUES.includes(l)) errors.push(`targeting.languages contains an unrecognized value: ${l}`);
    });
  }

  if (categories !== undefined) {
    if (!Array.isArray(categories)) errors.push('targeting.categories must be an array');
    else if (typeof isValidObjectId === 'function') {
      categories.forEach((id) => { if (!isValidObjectId(id)) errors.push(`targeting.categories contains an invalid id: ${id}`); });
    }
  }

  if (articles !== undefined) {
    if (!Array.isArray(articles)) errors.push('targeting.articles must be an array');
    else if (typeof isValidObjectId === 'function') {
      articles.forEach((id) => { if (!isValidObjectId(id)) errors.push(`targeting.articles contains an invalid id: ${id}`); });
    }
  }

  if (urlPatterns !== undefined) {
    if (!Array.isArray(urlPatterns)) errors.push('targeting.urlPatterns must be an array');
    else urlPatterns.forEach((p) => {
      const result = validateUrlPattern(p);
      if (!result.ok) errors.push(`targeting.urlPatterns: ${result.error} (got "${p}")`);
    });
  }

  return errors;
}

/* ============================================================
   ADVERTISER / CAMPAIGN ELIGIBILITY
============================================================ */

// Statuses that may never be used for activation or public delivery,
// regardless of what an Advertisement's own status says.
const BLOCKED_ADVERTISER_STATUSES = ['blocked', 'archived', 'pending'];

function validateAdvertiserForActivation(advertiser) {
  const errors = [];
  if (!advertiser) {
    errors.push('advertiser does not exist');
    return errors;
  }
  if (BLOCKED_ADVERTISER_STATUSES.includes(advertiser.status)) {
    errors.push(`advertiser status "${advertiser.status}" cannot be activated or served publicly`);
  }
  return errors;
}

// Campaign statuses an Advertisement is never allowed to activate under.
const NON_ACTIVATABLE_CAMPAIGN_STATUSES = ['cancelled', 'rejected', 'completed'];

/**
 * @param {object|null} campaign - already-fetched Campaign doc, or null if
 *   the Advertisement has no campaign (allowed — see Advertisement model).
 * @param {string} advertiserId - the Advertisement's advertiser id, to
 *   enforce ownership.
 */
function validateCampaignForAdvertisement(campaign, advertiserId) {
  const errors = [];
  if (!campaign) return errors; // campaign is optional at the model level

  if (String(campaign.advertiser) !== String(advertiserId)) {
    errors.push('campaign does not belong to the selected advertiser');
  }
  if (NON_ACTIVATABLE_CAMPAIGN_STATUSES.includes(campaign.status)) {
    errors.push(`campaign status "${campaign.status}" cannot be activated`);
  }
  return errors;
}

/**
 * An Advertisement's own schedule must fall within its Campaign's
 * schedule, when a campaign is attached — an ad can't outlive the budget
 * window it was funded under.
 */
function validateScheduleWithinCampaign(adStart, adEnd, campaign) {
  const errors = [];
  if (!campaign || !campaign.startDate || !campaign.endDate) return errors;
  if (adStart < campaign.startDate || adEnd > campaign.endDate) {
    errors.push('advertisement schedule must fall within the campaign schedule');
  }
  return errors;
}

/* ============================================================
   PLACEMENT / CREATIVE COMPATIBILITY
============================================================ */

/**
 * @param {object} creative - AdCreative doc (needs desktop/mobile/status)
 * @param {object} placement - AdPlacement doc (needs device/recommendedDimensions/active)
 * @returns {string[]} errors (empty = compatible)
 */
function checkCreativePlacementCompatibility(creative, placement) {
  const errors = [];
  if (!creative) { errors.push('creative does not exist'); return errors; }
  if (!placement) { errors.push('placement does not exist'); return errors; }

  if (creative.status !== 'active') {
    errors.push(`creative status "${creative.status}" is not available for serving`);
  }
  if (placement.active === false) {
    errors.push(`placement "${placement.name}" is not active`);
  }

  const hasDesktop = !!(creative.desktop && creative.desktop.fileUrl);
  const hasMobile = !!(creative.mobile && creative.mobile.fileUrl);
  if (!hasDesktop && !hasMobile) {
    errors.push('creative has no uploaded desktop or mobile asset');
    return errors;
  }

  const fixed = parseFixedDimensions(placement.recommendedDimensions);

  function dimensionMismatch(asset) {
    return fixed && asset && (asset.width !== fixed.width || asset.height !== fixed.height);
  }

  if (placement.device === 'desktop') {
    if (!hasDesktop) {
      errors.push(`creative has no desktop asset, but placement "${placement.name}" is desktop-only`);
    } else if (dimensionMismatch(creative.desktop)) {
      errors.push(`creative desktop asset is ${creative.desktop.width}x${creative.desktop.height}, placement requires ${fixed.width}x${fixed.height}`);
    }
  } else if (placement.device === 'mobile') {
    // Mobile-scoped placements may use a desktop asset as a fallback only
    // when no dedicated mobile asset exists (per AdCreative's documented
    // fallback rule) — but a *desktop-only* creative used here still must
    // match the placement's required dimensions if one is enforced.
    const asset = hasMobile ? creative.mobile : creative.desktop;
    if (dimensionMismatch(asset)) {
      errors.push(`creative asset is ${asset.width}x${asset.height}, placement "${placement.name}" requires ${fixed.width}x${fixed.height}`);
    }
  } else {
    // device === 'both': desktop asset is mandatory, mobile is optional
    // (falls back to desktop when absent).
    if (!hasDesktop) {
      errors.push(`creative has no desktop asset, required for placement "${placement.name}"`);
    } else if (dimensionMismatch(creative.desktop)) {
      errors.push(`creative desktop asset is ${creative.desktop.width}x${creative.desktop.height}, placement requires ${fixed.width}x${fixed.height}`);
    }
    if (hasMobile && dimensionMismatch(creative.mobile)) {
      errors.push(`creative mobile asset is ${creative.mobile.width}x${creative.mobile.height}, placement requires ${fixed.width}x${fixed.height}`);
    }
  }

  return errors;
}

/* ============================================================
   PRIORITY
   Existing convention (see Advertisement model comment, established
   before this file): LOWER number = HIGHER priority, only meaningful
   when the placement's rotationMode is "priority".
============================================================ */
function validatePriority(priority) {
  if (priority === undefined || priority === null || priority === '') return [];
  const n = Number(priority);
  if (Number.isNaN(n) || !Number.isFinite(n)) return ['priority must be a number'];
  if (!Number.isInteger(n)) return ['priority must be an integer'];
  if (n < 1) return ['priority must be 1 or greater'];
  return [];
}

/* ============================================================
   DELIVERY-COMPATIBLE ELIGIBILITY FILTER
   Not a public-page delivery implementation (out of scope per spec) —
   just a Mongo filter builder so a future getEligibleAdvertisements()
   service has a single, tested source of truth for "which fields must
   match" rather than re-deriving it inline.
============================================================ */
function buildEligibilityFilter({ placement, page, language, device, date } = {}) {
  const now = date ? new Date(date) : new Date();
  const filter = {
    status: 'active',
    // PART 8A: public delivery additionally requires sign-off, not just
    // the "active" status flag — see isAdvertisementLiveForDelivery below
    // for the equivalent check on already-fetched documents (JS side).
    'approval.status': 'approved',
    'schedule.startDate': { $lte: now },
    'schedule.endDate': { $gte: now }
  };

  if (placement) filter.placements = placement;

  const and = [];
  if (page) {
    and.push({ $or: [{ 'targeting.pages': { $size: 0 } }, { 'targeting.pages': 'all' }, { 'targeting.pages': page }] });
  }
  if (language) {
    and.push({ $or: [{ 'targeting.languages': { $size: 0 } }, { 'targeting.languages': language }] });
  }
  if (device) {
    and.push({ $or: [{ 'targeting.devices': { $size: 0 } }, { 'targeting.devices': device }] });
  }
  if (and.length) filter.$and = and;

  return filter;
}

function computeCtr(impressions, clicks) {
  const impr = Number(impressions) || 0;
  const clk = Number(clicks) || 0;
  if (impr <= 0) return 0;
  return Math.round((clk / impr) * 100 * 100) / 100; // 2 decimal places
}

/* ============================================================
   PART 8A — PUBLIC DELIVERY: PAGE / URL TARGETING RESOLUTION
   Pure, DB-free targeting-match logic consumed by
   services/advertisementDeliveryService.js. Kept here (rather than in
   the service file) so it stays unit-testable without a Mongo
   connection, matching this file's existing pure/impure split — the
   service owns the DB round trip, this owns the actual decision.
============================================================ */

// Lower number = more specific match, per the required targeting
// priority order: Specific Article URL > Category > Page Type >
// Wildcard/page pattern > All Pages.
const TARGETING_SPECIFICITY = {
  ARTICLE: 1,
  CATEGORY: 2,
  PAGE_TYPE: 3,
  URL_PATTERN: 4,
  ALL: 5
};

/**
 * Normalize a page path/URL for comparison: strips scheme+host if a full
 * URL was passed, drops the query string and hash fragment, collapses
 * duplicate slashes, enforces a single leading slash and no trailing
 * slash (root "/" is kept as-is), and lowercases the result so matching
 * is case-insensitive.
 */
function normalizeUrlPath(raw) {
  if (!raw) return '';
  let path = String(raw).trim();
  path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, ''); // strip scheme+host, if any
  path = path.split('?')[0].split('#')[0]; // drop query params / hash fragment
  path = path.replace(/\/{2,}/g, '/'); // collapse duplicate slashes
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, ''); // drop trailing slash, keep root
  return path.toLowerCase();
}

/**
 * Whether an AdPlacement scoped to `placementDevice` (desktop/mobile/both
 * — AdPlacement's own vocabulary) may serve a request for
 * `requestedDevice` (desktop/mobile/tablet — the broader targeting
 * vocabulary). Tablet has no distinct AdPlacement device option, so a
 * "mobile" placement is treated as tablet-compatible too — the same
 * fallback direction AdCreative already documents (mobile-scoped slots
 * accept a desktop asset when no mobile asset exists). This is an
 * explicit assumption for Part 8A; flag for product review if tablet
 * ever needs its own placement-level scoping.
 */
function placementSupportsDevice(placementDevice, requestedDevice) {
  if (!requestedDevice) return true; // no device filter requested
  if (!placementDevice || placementDevice === 'both') return true;
  if (placementDevice === requestedDevice) return true;
  if (placementDevice === 'mobile' && requestedDevice === 'tablet') return true;
  return false;
}

// Empty/undefined targeting array means "no restriction", the same
// convention this module already documents for Advertisement.targeting.
function matchesDeviceTargeting(devices, requestedDevice) {
  if (!requestedDevice) return true;
  if (!Array.isArray(devices) || devices.length === 0) return true;
  return devices.includes(requestedDevice);
}

function matchesLanguageTargeting(languages, requestedLanguage) {
  if (!requestedLanguage) return true;
  if (!Array.isArray(languages) || languages.length === 0) return true;
  return languages.includes(requestedLanguage);
}

/**
 * Resolve whether an Advertisement's page-level targeting matches the
 * requested placement context, and how specific that match is.
 *
 * Every targeting mechanism (page-type key, category id, article id, URL
 * pattern) is evaluated independently and the *most specific* match
 * wins — an advertisement is never made broader by one field just
 * because another field also happens to match. That is what keeps
 * "specific article" targeting from ever leaking into a full
 * category/page match unless the advertisement explicitly also targets
 * that broader page/category.
 *
 * @param {object} targeting - Advertisement.targeting (pages/categories/articles/urlPatterns)
 * @param {{ page?: string, url?: string, categoryId?: string, articleId?: string }} context
 * @returns {{ matched: boolean, specificity: number|null }}
 */
function resolvePageTargetingMatch(targeting, context = {}) {
  const t = targeting || {};
  const pages = Array.isArray(t.pages) ? t.pages : [];
  const categories = Array.isArray(t.categories) ? t.categories.map(String) : [];
  const articles = Array.isArray(t.articles) ? t.articles.map(String) : [];
  const urlPatterns = Array.isArray(t.urlPatterns) ? t.urlPatterns : [];

  const requestedPage = context.page || null;
  const requestedUrl = context.url !== undefined && context.url !== null ? normalizeUrlPath(context.url) : null;
  const requestedCategoryId = context.categoryId ? String(context.categoryId) : null;
  const requestedArticleId = context.articleId ? String(context.articleId) : null;

  const matches = [];

  // Specific Article URL — via an explicit Article id...
  if (pages.includes('article') && requestedArticleId && articles.includes(requestedArticleId)) {
    matches.push(TARGETING_SPECIFICITY.ARTICLE);
  }
  // ...or via an exact (non-wildcard) URL pattern, which is inherently
  // as specific as a single article regardless of whether "article" is
  // also listed in targeting.pages.
  if (requestedUrl) {
    urlPatterns.forEach((pattern) => {
      if (!pattern.endsWith('*') && normalizeUrlPath(pattern) === requestedUrl) {
        matches.push(TARGETING_SPECIFICITY.ARTICLE);
      }
    });
  }

  // Category
  if (pages.includes('category') && requestedCategoryId && categories.includes(requestedCategoryId)) {
    matches.push(TARGETING_SPECIFICITY.CATEGORY);
  }

  // Page Type (homepage/news/price-prediction/crypto-explained/academy/ranking)
  if (requestedPage && requestedPage !== 'all' && pages.includes(requestedPage)) {
    matches.push(TARGETING_SPECIFICITY.PAGE_TYPE);
  }

  // Wildcard / page pattern (e.g. "/en/news/*")
  if (requestedUrl) {
    urlPatterns.forEach((pattern) => {
      if (pattern.endsWith('*') && urlPatternMatches(pattern, requestedUrl)) {
        matches.push(TARGETING_SPECIFICITY.URL_PATTERN);
      }
    });
  }

  // All Pages — either explicit "all", or no page-targeting configured at
  // all (empty pages + empty urlPatterns means "no restriction", the
  // same convention already documented on Advertisement.targeting).
  const noPageTargetingConfigured = pages.length === 0 && urlPatterns.length === 0;
  if (pages.includes('all') || noPageTargetingConfigured) {
    matches.push(TARGETING_SPECIFICITY.ALL);
  }

  if (matches.length === 0) return { matched: false, specificity: null };
  return { matched: true, specificity: Math.min(...matches) };
}

/* ============================================================
   PART 8A — PUBLIC DELIVERY: STATUS / SCHEDULE / CAMPAIGN CHECKS
   Distinct from validateCampaignForAdvertisement / validateAdvertiserForActivation
   above: those answer "is this allowed to be activated at all" (a
   workflow-time question — e.g. a "paused" campaign still passes there,
   since pausing is a deliberate temporary admin override, not a
   disqualification). Public delivery asks a stricter, narrower question
   — "should this be shown to a visitor right now" — so a paused campaign
   correctly fails delivery even though it would pass activation.
============================================================ */

function isAdvertisementLiveForDelivery(ad) {
  if (!ad) return false;
  if (ad.status !== 'active') return false;
  if (!ad.approval || ad.approval.status !== 'approved') return false;
  return true;
}

function isCampaignLiveForDelivery(campaign) {
  return !!campaign && campaign.status === 'active';
}

function isAdvertiserLiveForDelivery(advertiser) {
  return !!advertiser && validateAdvertiserForActivation(advertiser).length === 0;
}

function isWithinSchedule(schedule, date) {
  if (!schedule || !schedule.startDate || !schedule.endDate) return false;
  const now = date ? new Date(date) : new Date();
  return now >= new Date(schedule.startDate) && now <= new Date(schedule.endDate);
}

/* ============================================================
   PART 8A — PUBLIC DELIVERY: CREATIVE SELECTION
============================================================ */

/**
 * Pick the first creative (in the Advertisement's own creative order)
 * that is active and compatible with the requested placement, reusing
 * checkCreativePlacementCompatibility so "what counts as a deliverable
 * creative" is still defined in exactly one place.
 * @returns {object|null}
 */
function selectDeliveryCreative(creatives, placement) {
  if (!Array.isArray(creatives)) return null;
  for (const creative of creatives) {
    if (checkCreativePlacementCompatibility(creative, placement).length === 0) return creative;
  }
  return null;
}

// Only the fields the delivery layer/renderer actually needs — never the
// full AdCreative document (no uploadedBy, no library-assignment arrays).
function serializeCreativeAsset(asset) {
  if (!asset || !asset.fileUrl) return null;
  return {
    fileUrl: asset.fileUrl,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType,
    fileSizeBytes: asset.fileSizeBytes
  };
}

function serializeCreativeForDelivery(creative) {
  if (!creative) return null;
  return {
    id: creative._id,
    name: creative.name,
    altText: creative.altText || '',
    desktop: serializeCreativeAsset(creative.desktop),
    mobile: serializeCreativeAsset(creative.mobile)
  };
}

/* ============================================================
   PART 8A — PUBLIC DELIVERY: FULL ELIGIBILITY + RANKING
   Pure orchestration over already-fetched documents. The DB round trip
   (status/approval/schedule/placement pre-filter at the query level,
   plus populating advertiser/campaign/creatives) is
   services/advertisementDeliveryService.js's job; everything that
   decides whether a given candidate actually qualifies — and how the
   qualifying candidates should be ordered for Part 8B's rotation step —
   lives here, so it is testable with plain fixtures and no live Mongo
   connection.
   Existing priority convention preserved: LOWER `priority` number wins.
   @returns {object[]} eligible ads, most-specific-targeting-first, then
     by priority — NOT yet reduced to a single ad (Part 8B's job).
============================================================ */
function filterAndRankEligibleAdvertisements({ ads, placement, page, url, categoryId, articleId, language, device, date } = {}) {
  // Defense in depth: services/advertisementDeliveryService.js already
  // short-circuits on a disabled placement before ever querying
  // Advertisement, but this function is the actual centralized
  // eligibility decision (spec item 11), so a disabled placement must
  // never yield eligible ads even if called some other way.
  if (placement && placement.active === false) return [];

  const candidates = Array.isArray(ads) ? ads : [];
  const results = [];

  candidates.forEach((ad) => {
    if (!ad) return;
    if (!isAdvertisementLiveForDelivery(ad)) return;
    if (!isWithinSchedule(ad.schedule, date)) return;
    if (!isCampaignLiveForDelivery(ad.campaign)) return;
    if (!isAdvertiserLiveForDelivery(ad.advertiser)) return;
    if (!matchesLanguageTargeting(ad.targeting && ad.targeting.languages, language)) return;
    if (!matchesDeviceTargeting(ad.targeting && ad.targeting.devices, device)) return;
    if (placement && !placementSupportsDevice(placement.device, device)) return;

    const pageMatch = resolvePageTargetingMatch(ad.targeting, { page, url, categoryId, articleId });
    if (!pageMatch.matched) return;

    const creative = selectDeliveryCreative(ad.creatives, placement);
    if (!creative) return;

    results.push({
      id: ad._id,
      campaignId: ad.campaign ? (ad.campaign._id || ad.campaign) : null,
      advertiserId: ad.advertiser ? (ad.advertiser._id || ad.advertiser) : null,
      placementId: placement ? placement._id : null,
      type: ad.type,
      priority: ad.priority,
      rotationWeight: ad.rotationWeight,
      rotationMode: placement ? placement.rotationMode : null,
      targetingSpecificity: pageMatch.specificity,
      creative: serializeCreativeForDelivery(creative),
      destinationUrl: ad.destinationUrl,
      openInNewTab: ad.openInNewTab !== false
    });
  });

  // Most-specific targeting first; the existing priority convention
  // (lower number = higher priority) breaks ties within the same
  // specificity band. Final head-to-head selection between remaining
  // candidates (priority/even/random rotation, fallback/house ads) is
  // Part 8B's job — this only needs to be a stable, deterministic
  // candidate list with the metadata that step requires.
  results.sort((a, b) => {
    if (a.targetingSpecificity !== b.targetingSpecificity) return a.targetingSpecificity - b.targetingSpecificity;
    return (a.priority ?? Infinity) - (b.priority ?? Infinity);
  });

  return results;
}

module.exports = {
  ADVERTISEMENT_TYPES,
  DEFAULT_ADVERTISEMENT_TYPE,
  ADVERTISEMENT_STATUSES,
  DEFAULT_ADVERTISEMENT_STATUS,
  STATUS_TRANSITIONS,
  canTransitionStatus,
  PAGE_TARGETING_KEYS,
  DEVICE_TARGETING_VALUES,
  LANGUAGE_TARGETING_VALUES,
  validateTargeting,
  BLOCKED_ADVERTISER_STATUSES,
  validateAdvertiserForActivation,
  NON_ACTIVATABLE_CAMPAIGN_STATUSES,
  validateCampaignForAdvertisement,
  validateScheduleWithinCampaign,
  checkCreativePlacementCompatibility,
  validatePriority,
  buildEligibilityFilter,
  computeCtr,
  TARGETING_SPECIFICITY,
  normalizeUrlPath,
  placementSupportsDevice,
  matchesDeviceTargeting,
  matchesLanguageTargeting,
  resolvePageTargetingMatch,
  isAdvertisementLiveForDelivery,
  isCampaignLiveForDelivery,
  isAdvertiserLiveForDelivery,
  isWithinSchedule,
  selectDeliveryCreative,
  serializeCreativeForDelivery,
  filterAndRankEligibleAdvertisements
};
