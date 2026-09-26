// backend/utils/advertisementRotationLogic.js
//
// PART 8B — Advertisement Rotation, Fallback & Final Delivery Engine.
//
// This file owns the actual rotation/fallback DECISION as pure, DB-free
// functions — same separation PART 8A already established between
// advertisementLogic.js (pure eligibility/ranking decision) and
// services/advertisementDeliveryService.js (DB round trip only). The
// service file is the only caller: it fetches eligibility candidates +
// their delivery-tracking metadata (lastServedAt/deliveryCount) via
// getEligibleAdvertisements(), hands both to selectPaidAdvertisement()
// here, then persists the outcome (recordDelivery) and resolves the
// house-ad fallback. Nothing in this file talks to Mongoose, which keeps
// every branch here testable with plain fixtures.
//
// IMPORTANT: this module does not re-implement eligibility. It only
// decides, among the candidates advertisementLogic.js already declared
// eligible, which single one (if any) wins for this request.

// Mirrors AdPlacement's ROTATION_MODES / FALLBACK_BEHAVIORS statics
// exactly (backend/models/AdPlacement.js) — duplicated as a plain
// constant here (rather than importing the model) so this stays a
// DB-free module, consistent with advertisementLogic.js's own
// PAGE_TARGETING_KEYS/DEVICE_TARGETING_VALUES pattern of re-declaring the
// shared vocabulary instead of requiring a Mongoose model just for an
// enum list.
const ROTATION_MODES = ['priority', 'even', 'random'];
const DEFAULT_ROTATION_MODE = 'priority'; // "safest existing default" per spec item 2

const FALLBACK_BEHAVIORS = ['hide', 'collapse', 'house_ad'];
const DEFAULT_FALLBACK_BEHAVIOR = 'hide'; // matches AdPlacement schema's own default

/**
 * An unrecognized/missing rotation mode must never throw or silently
 * serve nothing — fail toward the safest default instead (spec item 12,
 * "invalid rotation mode").
 */
function resolveRotationMode(mode) {
  return ROTATION_MODES.includes(mode) ? mode : DEFAULT_ROTATION_MODE;
}

/**
 * Same defensive default for an unrecognized/missing fallback behavior
 * (spec item 12, "invalid fallback mode").
 */
function resolveFallbackBehavior(behavior) {
  return FALLBACK_BEHAVIORS.includes(behavior) ? behavior : DEFAULT_FALLBACK_BEHAVIOR;
}

/**
 * Targeting specificity (see advertisementLogic.TARGETING_SPECIFICITY)
 * is a *targeting* concept, not a rotation one — a broadly-targeted "all
 * pages" ad should never out-compete a page-specific ad just because
 * rotation mode happens to be "even" or "random". So rotation always
 * operates only within the best (lowest-number = most specific) tier
 * already present in the eligible list; the eligible list itself is
 * already sorted with that tier first (filterAndRankEligibleAdvertisements),
 * so this just re-groups by the winning tier's value rather than
 * re-deriving specificity.
 * @returns {object[]}
 */
function pickTopSpecificityTier(ads) {
  if (!Array.isArray(ads) || ads.length === 0) return [];
  let best = Infinity;
  ads.forEach((ad) => {
    const s = ad && ad.targetingSpecificity != null ? ad.targetingSpecificity : Infinity;
    if (s < best) best = s;
  });
  return ads.filter((ad) => (ad && ad.targetingSpecificity != null ? ad.targetingSpecificity : Infinity) === best);
}

// rotationMeta is keyed by String(ad.id) -> { lastServedAt: Date|null, deliveryCount: number }.
// An ad missing from the map (never served, or metadata unavailable) is
// treated as "never served" — the most favorable case for rotation
// fairness, so a brand-new advertisement isn't penalized for lacking
// history.
function lastServedTime(ad, rotationMeta) {
  const meta = rotationMeta && rotationMeta[String(ad.id)];
  if (!meta || !meta.lastServedAt) return 0; // epoch — "never served" sorts first
  const t = new Date(meta.lastServedAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function deliveryCountOf(ad, rotationMeta) {
  const meta = rotationMeta && rotationMeta[String(ad.id)];
  const n = meta && Number.isFinite(meta.deliveryCount) ? meta.deliveryCount : 0;
  return n < 0 ? 0 : n;
}

// Final, fully-deterministic tie-breaker so two requests at the exact
// same instant with identical priority/history still agree on a winner
// (spec item 3: "deterministic tie-breaking"). Never used as the primary
// sort key — only reached once priority/recency/count are equal.
function byStableId(a, b) {
  return String(a.id).localeCompare(String(b.id));
}

/**
 * PRIORITY rotation: lower `priority` number wins (existing project
 * convention). Ties (including "no priority set" on every candidate) are
 * broken by least-recently-served first, so a persistent priority tie
 * doesn't nail the same advertisement to the slot forever (spec item 3).
 */
function selectPriorityWinner(pool, rotationMeta) {
  const sorted = [...pool].sort((a, b) => {
    const pa = a.priority ?? Infinity;
    const pb = b.priority ?? Infinity;
    if (pa !== pb) return pa - pb;
    const diff = lastServedTime(a, rotationMeta) - lastServedTime(b, rotationMeta);
    if (diff !== 0) return diff;
    return byStableId(a, b);
  });
  return sorted[0];
}

/**
 * EVEN rotation: whichever eligible ad has been served the fewest times
 * goes next (persistent round-robin via deliveryCount, not Math.random —
 * spec item 4). Ties broken by least-recently-served, then stable id.
 */
function selectEvenWinner(pool, rotationMeta) {
  const sorted = [...pool].sort((a, b) => {
    const diff = deliveryCountOf(a, rotationMeta) - deliveryCountOf(b, rotationMeta);
    if (diff !== 0) return diff;
    const tDiff = lastServedTime(a, rotationMeta) - lastServedTime(b, rotationMeta);
    if (tDiff !== 0) return tDiff;
    return byStableId(a, b);
  });
  return sorted[0];
}

/**
 * RANDOM rotation: uniform pick from the (already-eligible) pool only.
 * `rng` is injectable so tests can assert exact selection without
 * relying on real randomness; defaults to Math.random in production.
 */
function selectRandomWinner(pool, rng) {
  const random = typeof rng === 'function' ? rng : Math.random;
  const r = random();
  const safeR = Number.isFinite(r) && r >= 0 && r < 1 ? r : 0;
  const index = Math.min(pool.length - 1, Math.floor(safeR * pool.length));
  return pool[index];
}

/**
 * Reduce the eligible-ads list to exactly one paid winner (or null if the
 * list is empty) for the placement's configured rotation mode.
 * @param {object[]} ads - output of filterAndRankEligibleAdvertisements
 * @param {string} rotationMode - AdPlacement.rotationMode (validated/defaulted here)
 * @param {object} rotationMeta - { [adId]: { lastServedAt, deliveryCount } }
 * @param {function} [rng] - injectable RNG for RANDOM mode (testing only)
 * @returns {object|null}
 */
function selectPaidAdvertisement({ ads, rotationMode, rotationMeta = {}, rng } = {}) {
  if (!Array.isArray(ads) || ads.length === 0) return null;

  const pool = pickTopSpecificityTier(ads);
  if (pool.length === 0) return null; // defensive — should be unreachable if `ads` is non-empty

  const mode = resolveRotationMode(rotationMode);
  if (mode === 'even') return selectEvenWinner(pool, rotationMeta);
  if (mode === 'random') return selectRandomWinner(pool, rng);
  return selectPriorityWinner(pool, rotationMeta);
}

/**
 * Shape every possible outcome identically (spec item 9), so callers
 * never have to special-case which branch produced the result.
 */
function buildDeliveryResult({ status, source = null, advertisement = null, placement = null, rotationMode = null, reason = '' } = {}) {
  return { status, source, advertisement, placement, rotationMode, reason };
}

module.exports = {
  ROTATION_MODES,
  DEFAULT_ROTATION_MODE,
  FALLBACK_BEHAVIORS,
  DEFAULT_FALLBACK_BEHAVIOR,
  resolveRotationMode,
  resolveFallbackBehavior,
  pickTopSpecificityTier,
  selectPriorityWinner,
  selectEvenWinner,
  selectRandomWinner,
  selectPaidAdvertisement,
  buildDeliveryResult
};
