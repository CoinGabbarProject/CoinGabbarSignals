// backend/utils/adInventoryLogic.js
//
// PART 12A — Advertising -> Inventory: pure, DB-free aggregation logic.
//
// Same separation this codebase already established for the delivery
// engine (advertisementLogic.js = pure decision, advertisementDeliveryService.js
// = DB round trip): this file takes already-fetched Placement/Advertisement
// documents (with campaign/advertiser populated) as plain arguments and
// derives the Inventory view for a single placement. It does not query
// Mongo and does not duplicate the public delivery engine — it reuses the
// exact same eligibility primitives from advertisementLogic.js so
// "currently occupied" here can never disagree with what the public site
// actually serves.
//
// IMPORTANT DIFFERENCE FROM THE PUBLIC DELIVERY ENGINE:
// getEligibleAdvertisements()/getAdvertisement() answer "what can be shown
// for THIS page/URL/category/article request". Inventory has no such
// request context — an admin looking at "Sidebar" wants to know what's
// occupying that slot in general, not for one specific article. So this
// module deliberately does NOT call filterAndRankEligibleAdvertisements()
// (which requires a page/url context and resolves per-page targeting
// specificity). Instead it reuses the lower-level, context-free checks
// that function is itself built from: isAdvertisementLiveForDelivery,
// isWithinSchedule, isCampaignLiveForDelivery, isAdvertiserLiveForDelivery,
// matchesDeviceTargeting, placementSupportsDevice. Nothing here re-derives
// or second-guesses those decisions.

const {
  isAdvertisementLiveForDelivery,
  isCampaignLiveForDelivery,
  isAdvertiserLiveForDelivery,
  isWithinSchedule,
  matchesDeviceTargeting,
  placementSupportsDevice,
  NON_ACTIVATABLE_CAMPAIGN_STATUSES,
  validateAdvertiserForActivation
} = require('./advertisementLogic');

const INVENTORY_STATUSES = [
  'disabled',
  'available',
  'occupied',
  'occupied_rotating',
  'scheduled'
];

// Advertisement statuses that can still legitimately go live later (used
// only for FUTURE candidates — an ad sitting in 'scheduled' or 'approved'
// hasn't been flipped to 'active' yet because nothing crosses that
// boundary until its startDate is actually read, same "self-heal on
// read" limitation documented on advertisementController's own
// syncAdvertisementSchedules). 'active' is included too so an ad whose
// schedule genuinely starts in the future but was already (incorrectly)
// left active by an admin edit isn't silently hidden from the forecast.
const FUTURE_ELIGIBLE_AD_STATUSES = ['approved', 'scheduled', 'active'];

function isAdCurrentlyOccupying(ad, placement, { device, date } = {}) {
  if (!ad) return false;
  if (!isAdvertisementLiveForDelivery(ad)) return false;
  if (!isWithinSchedule(ad.schedule, date)) return false;
  if (!isCampaignLiveForDelivery(ad.campaign)) return false;
  if (!isAdvertiserLiveForDelivery(ad.advertiser)) return false;
  if (placement && !placementSupportsDevice(placement.device, device)) return false;
  if (!matchesDeviceTargeting(ad.targeting && ad.targeting.devices, device)) return false;
  return true;
}

// A candidate for "what fills this slot next" — deliberately looser than
// isAdCurrentlyOccupying (an ad that hasn't started yet will never have
// status 'active' the way isAdvertisementLiveForDelivery requires), but
// still only ads that are genuinely booked and approved, never drafts or
// pending/rejected work.
function isAdEligibleForFuture(ad, placement, { device, date } = {}) {
  if (!ad) return false;
  if (!FUTURE_ELIGIBLE_AD_STATUSES.includes(ad.status)) return false;
  if (!ad.approval || ad.approval.status !== 'approved') return false;
  if (!ad.schedule || !ad.schedule.startDate) return false;
  const now = date ? new Date(date) : new Date();
  if (!(new Date(ad.schedule.startDate) > now)) return false; // strictly future
  if (!ad.campaign || NON_ACTIVATABLE_CAMPAIGN_STATUSES.includes(ad.campaign.status)) return false;
  if (!ad.advertiser || validateAdvertiserForActivation(ad.advertiser).length > 0) return false;
  if (placement && !placementSupportsDevice(placement.device, device)) return false;
  if (!matchesDeviceTargeting(ad.targeting && ad.targeting.devices, device)) return false;
  return true;
}

function byEarliestStart(a, b) {
  const diff = new Date(a.schedule.startDate).getTime() - new Date(b.schedule.startDate).getTime();
  if (diff !== 0) return diff;
  return String(a._id).localeCompare(String(b._id)); // deterministic tie-break, same convention as rotation logic
}

// Existing priority convention (Advertisement model / advertisementLogic.js):
// LOWER priority number wins. Used only to pick which of several
// concurrently-occupying ads is the "primary" one shown as currentCampaign
// when more than one is genuinely rotating — it never changes which ads
// are listed in currentAdvertisements.
function byPriorityThenId(a, b) {
  const pa = a.priority ?? Infinity;
  const pb = b.priority ?? Infinity;
  if (pa !== pb) return pa - pb;
  return String(a._id).localeCompare(String(b._id));
}

function serializeCampaignRef(campaign) {
  if (!campaign) return null;
  return {
    id: campaign._id,
    name: campaign.name,
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    status: campaign.status
  };
}

function serializeAdvertisementRef(ad) {
  if (!ad) return null;
  return {
    id: ad._id,
    name: ad.name,
    status: ad.status,
    campaignId: ad.campaign ? ad.campaign._id || ad.campaign : null,
    creatives: Array.isArray(ad.creatives)
      ? ad.creatives.map((c) => ({ id: c._id, name: c.name, status: c.status }))
      : []
  };
}

/**
 * Detect placements/devices/time-periods where more than one campaign is
 * simultaneously eligible AND the placement's own rotation configuration
 * does not account for it.
 *
 * NOTE ON WHY THIS ALMOST ALWAYS RETURNS EMPTY: every AdPlacement in this
 * codebase always has a rotationMode (priority/even/random — see
 * AdPlacement model, default 'priority'). That field's entire purpose is
 * to resolve exactly this situation deterministically, so "simultaneous
 * delivery" is, by this architecture's own design, ALWAYS explicitly
 * supported. Per PART 12A spec item 10 ("if the advertising engine
 * explicitly permits simultaneous rotation, do NOT flag those campaigns
 * as conflicts"), multiple concurrently-occupying ads are therefore
 * represented as `isRotating: true`, not as a conflict. This function is
 * kept as a real, callable check (rather than a hardcoded []) only so a
 * future placement type that opts OUT of rotation has somewhere to plug
 * in — it is not currently reachable given AdPlacement's schema.
 */
function detectConflicts({ placement, currentAds }) {
  if (!placement || !Array.isArray(currentAds) || currentAds.length < 2) return [];
  // AdPlacement.rotationMode is required by schema (defaulted to
  // 'priority') and covers every case this module can see today.
  const rotationExplicitlySupported = !!placement.rotationMode;
  if (rotationExplicitlySupported) return [];

  // Unreachable with the current AdPlacement schema, kept for parity with
  // the spec's required output shape if that ever changes.
  const conflicts = [];
  for (let i = 0; i < currentAds.length; i += 1) {
    for (let j = i + 1; j < currentAds.length; j += 1) {
      const a = currentAds[i];
      const b = currentAds[j];
      conflicts.push({
        campaignId: a.campaign ? a.campaign._id || a.campaign : null,
        campaignName: a.campaign ? a.campaign.name : null,
        overlappingCampaignId: b.campaign ? b.campaign._id || b.campaign : null,
        overlappingCampaignName: b.campaign ? b.campaign.name : null,
        placementId: placement._id,
        device: placement.device,
        startDate: a.schedule.startDate,
        endDate: a.schedule.endDate
      });
    }
  }
  return conflicts;
}

/**
 * Derive the full Inventory row for one placement from its (already
 * fetched, already populated) candidate advertisements. Never queries the
 * database and never invents a value not present in `placement`/`ads`.
 *
 * @param {object} params
 * @param {object} params.placement - AdPlacement document
 * @param {object[]} params.ads - every Advertisement document whose
 *   `placements` array includes this placement (any status/schedule —
 *   filtering into current/future happens here, not by the caller)
 * @param {string} [params.device] - "desktop" | "mobile" | "tablet"
 * @param {Date|string} [params.date] - override "now" (testing/backfill only)
 * @returns {object} one Inventory item, shaped per PART 12A spec item 14
 */
function buildInventoryItem({ placement, ads, device, date } = {}) {
  const now = date ? new Date(date) : new Date();
  const candidates = Array.isArray(ads) ? ads : [];

  if (!placement) {
    return {
      placement: null,
      status: 'disabled',
      currentCampaign: null,
      currentAdvertisements: [],
      nextScheduledCampaign: null,
      nextAvailableAt: null,
      isRotating: false,
      conflicts: []
    };
  }

  const serializedPlacement = {
    id: placement._id,
    key: placement.key,
    name: placement.name,
    dimensions: placement.recommendedDimensions, // real schema field — never split into fake width/height
    device: placement.device,
    active: placement.active,
    rotationMode: placement.rotationMode,
    fallbackBehavior: placement.fallbackBehavior
  };

  // Disabled placement: never considered available, never occupied,
  // regardless of any campaign history (spec item 3).
  if (!placement.active) {
    return {
      placement: serializedPlacement,
      status: 'disabled',
      currentCampaign: null,
      currentAdvertisements: [],
      nextScheduledCampaign: null,
      nextAvailableAt: null,
      isRotating: false,
      conflicts: []
    };
  }

  const currentAds = candidates
    .filter((ad) => isAdCurrentlyOccupying(ad, placement, { device, date: now }))
    .sort(byPriorityThenId);

  const futureAds = candidates
    .filter((ad) => isAdEligibleForFuture(ad, placement, { device, date: now }))
    .sort(byEarliestStart);

  const isRotating = currentAds.length > 1;
  const conflicts = detectConflicts({ placement, currentAds });

  let status;
  if (currentAds.length > 0) {
    status = isRotating ? 'occupied_rotating' : 'occupied';
  } else if (futureAds.length > 0) {
    status = 'scheduled';
  } else {
    status = 'available';
  }

  // currentCampaign: when several ads genuinely rotate (possibly under
  // different campaigns), the highest-priority one is shown as "the"
  // current campaign for display — this never hides the others, which
  // remain listed in currentAdvertisements in full.
  const primaryCurrentAd = currentAds[0] || null;
  const currentCampaign = primaryCurrentAd ? serializeCampaignRef(primaryCurrentAd.campaign) : null;
  const currentAdvertisements = currentAds.map(serializeAdvertisementRef);

  const nextAd = futureAds[0] || null;
  const nextScheduledCampaign = nextAd ? serializeCampaignRef(nextAd.campaign) : null;

  // nextAvailableAt = the actual end of the current occupancy window (the
  // latest-ending currently-occupying ad, since the slot stays occupied
  // as long as ANY current ad is still live) — never a manually entered
  // or invented date (spec item 8). A placement with no current
  // occupant is available right now regardless of a future booking
  // already on the books, so nextAvailableAt is null for 'available' and
  // 'scheduled' alike; 'scheduled' only changes what the console labels
  // the slot, not whether it can be filled today.
  let nextAvailableAt = null;
  if (status === 'occupied' || status === 'occupied_rotating') {
    const latestEnd = currentAds.reduce((max, ad) => {
      const end = new Date(ad.schedule.endDate).getTime();
      return end > max ? end : max;
    }, -Infinity);
    nextAvailableAt = Number.isFinite(latestEnd) ? new Date(latestEnd) : null;
  }

  return {
    placement: serializedPlacement,
    status,
    currentCampaign,
    currentAdvertisements,
    nextScheduledCampaign,
    nextAvailableAt,
    isRotating,
    conflicts
  };
}

module.exports = {
  INVENTORY_STATUSES,
  FUTURE_ELIGIBLE_AD_STATUSES,
  isAdCurrentlyOccupying,
  isAdEligibleForFuture,
  detectConflicts,
  buildInventoryItem
};
