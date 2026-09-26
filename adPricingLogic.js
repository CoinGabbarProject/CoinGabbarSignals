// backend/utils/adPricingLogic.js
//
// PART 10B — Advertising Pricing & Revenue Management.
//
// Single source of truth for the pricing vocabulary (models, currencies,
// billing periods) and the validation rules tying them together, so the
// Campaign schema, campaignController and the Content Console UI all
// validate against the same lists — same convention this project already
// uses for advertisementLogic.js (types/statuses/targeting) and
// timezone.js (TIMEZONES).
//
// SCOPE NOTE: pricing is configured at the Campaign level, not per
// Advertisement. Campaign already established budget/pricingModel/
// pricingRate as the advertising system's existing (informal) pricing
// surface, and Campaign already carries the real start/end schedule that
// time-based billing (daily/weekly/monthly) needs — extending that
// existing surface avoids duplicating a second pricing concept on
// Advertisement, and keeps one campaign's pricing consistent across every
// advertisement running under it. The legacy top-level
// `pricingModel`/`pricingRate` fields on Campaign are left untouched for
// backward compatibility but are NOT used by revenue calculation — the
// nested `pricing` object below (added this part) is the only source
// revenue math reads from.

const PRICING_MODELS = ['CPM', 'CPC', 'FLAT', 'DAILY', 'WEEKLY', 'MONTHLY', 'SPONSORED_ARTICLE', 'CUSTOM'];

const PRICING_MODEL_LABELS = {
  CPM: 'CPM (Cost per 1,000 Impressions)',
  CPC: 'CPC (Cost per Click)',
  FLAT: 'Flat Rate',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  SPONSORED_ARTICLE: 'Sponsored Article',
  CUSTOM: 'Custom'
};

// Only these two — never invent or display another currency.
const CURRENCIES = ['USD', 'INR'];

const BILLING_PERIODS = [
  'per_1000_impressions',
  'per_click',
  'one_time',
  'daily',
  'weekly',
  'monthly',
  'sponsored_article',
  'custom'
];

const BILLING_PERIOD_LABELS = {
  per_1000_impressions: 'Per 1,000 Impressions',
  per_click: 'Per Click',
  one_time: 'One-time',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  sponsored_article: 'Sponsored Article',
  custom: 'Custom'
};

// Which billing periods are valid for a given pricing model — the UI
// filters its billing-period select down to this list whenever the
// pricing model changes, and the server re-validates the same
// constraint rather than trusting the client to have enforced it.
// CUSTOM deliberately accepts every period, since a custom arrangement
// may still be billed on a standard cadence (e.g. "custom rate, billed
// monthly") — the thing that stays unresolved for CUSTOM is the revenue
// formula, not the billing cadence.
const MODEL_BILLING_PERIODS = {
  CPM: ['per_1000_impressions'],
  CPC: ['per_click'],
  FLAT: ['one_time'],
  DAILY: ['daily'],
  WEEKLY: ['weekly'],
  MONTHLY: ['monthly'],
  SPONSORED_ARTICLE: ['sponsored_article'],
  CUSTOM: BILLING_PERIODS.slice()
};

function isValidPricingModel(model) {
  return PRICING_MODELS.includes(model);
}

function isValidCurrency(currency) {
  return CURRENCIES.includes(currency);
}

function billingPeriodsFor(model) {
  return MODEL_BILLING_PERIODS[model] || [];
}

/**
 * Validate a pricing payload against the rules in the spec:
 *   - model, rate, currency, billingPeriod are always required together
 *   - billingPeriod must be one this model actually supports
 *   - rate must be a non-negative number
 *   - includedImpressions / includedClicks, if provided, must be
 *     non-negative integers
 * Returns an array of human-readable error strings (empty = valid).
 */
function validatePricingPayload(body = {}) {
  const errors = [];

  if (!body.model || !isValidPricingModel(body.model)) {
    errors.push('pricing model is required and must be one of: ' + PRICING_MODELS.join(', '));
    return errors; // nothing else can be validated meaningfully without a model
  }

  if (body.rate === undefined || body.rate === null || body.rate === '' || isNaN(Number(body.rate)) || Number(body.rate) < 0) {
    errors.push('rate is required and must be a non-negative number');
  }

  if (!body.currency || !isValidCurrency(body.currency)) {
    errors.push('currency is required and must be one of: ' + CURRENCIES.join(', '));
  }

  const allowedPeriods = billingPeriodsFor(body.model);
  if (!body.billingPeriod || !allowedPeriods.includes(body.billingPeriod)) {
    errors.push(`billing period is required and must be one of: ${allowedPeriods.join(', ')} for the ${body.model} pricing model`);
  }

  if (body.includedImpressions !== undefined && body.includedImpressions !== null && body.includedImpressions !== '') {
    if (isNaN(Number(body.includedImpressions)) || Number(body.includedImpressions) < 0) {
      errors.push('included impressions must be a non-negative number');
    }
  }

  if (body.includedClicks !== undefined && body.includedClicks !== null && body.includedClicks !== '') {
    if (isNaN(Number(body.includedClicks)) || Number(body.includedClicks) < 0) {
      errors.push('included clicks must be a non-negative number');
    }
  }

  return errors;
}

module.exports = {
  PRICING_MODELS,
  PRICING_MODEL_LABELS,
  CURRENCIES,
  BILLING_PERIODS,
  BILLING_PERIOD_LABELS,
  MODEL_BILLING_PERIODS,
  isValidPricingModel,
  isValidCurrency,
  billingPeriodsFor,
  validatePricingPayload
};
