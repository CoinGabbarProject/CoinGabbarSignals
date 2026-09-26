// backend/utils/permissions.js
//
// PART 12A — ADVERTISING APPROVAL + PERMISSIONS
//
// This is NOT a new authentication or permission framework. This project's
// only identity/authorization primitive is User.role ('admin' | 'editor' |
// 'author'), checked by backend/middleware/auth.js's `protect` (who are
// you) and `adminOnly` (are you admin-or-editor). This file adds nothing
// to that model — it is a pure lookup table from the role that already
// exists on req.user to the finer-grained advertising.* permission
// identifiers the spec asks for, plus a small middleware that reads it.
// No new user fields, no new roles collection, no new tokens.
//
// Extend ROLE_PERMISSIONS (not the auth model, not the User schema) if a
// role's advertising access needs to change later.

const ADVERTISING_PERMISSIONS = [
  'advertising.view',
  'advertising.create',
  'advertising.edit',
  'advertising.delete',
  'advertising.publish',
  'advertising.analytics',
  'advertising.settings'
];

// Policy: 'admin' keeps every permission adminOnly already granted it
// (spec section 7/8) — nothing an admin could do before this part is
// taken away. 'editor' keeps view/create/edit/analytics (the day-to-day
// advertising-console work adminOnly already let editors do), but NOT
// publish/delete/settings — this is the one deliberate behavior change
// this part introduces, per spec item 8's explicit instruction: "Do not
// assume every user with advertising.edit can publish." 'author' gets
// nothing here, matching adminOnly's pre-existing exclusion of authors
// from the whole Advertising section.
const ROLE_PERMISSIONS = {
  admin: ADVERTISING_PERMISSIONS.slice(),
  editor: ['advertising.view', 'advertising.create', 'advertising.edit', 'advertising.analytics'],
  author: []
};

function roleHasPermission(role, permission) {
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
}

function userHasPermission(user, permission) {
  return !!user && roleHasPermission(user.role, permission);
}

// All advertising.* permissions a given user currently holds — used to
// hand the console UI enough information to hide controls the API would
// reject anyway (spec item 10), without the UI having to know the
// role->permission mapping itself.
function getUserPermissions(user) {
  return ADVERTISING_PERMISSIONS.filter((p) => userHasPermission(user, p));
}

// Express middleware. Must run after `protect` (needs req.user). Returns
// the same 401/403 JSON shape the rest of this project's auth middleware
// already uses (backend/middleware/auth.js), so callers/tests don't have
// to special-case advertising routes (spec item 9).
function requirePermission(permission) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ message: 'Not authorized, no token' });
    if (!userHasPermission(req.user, permission)) {
      return res.status(403).json({ message: `Forbidden: requires "${permission}" permission` });
    }
    next();
  };
}

module.exports = {
  ADVERTISING_PERMISSIONS,
  ROLE_PERMISSIONS,
  roleHasPermission,
  userHasPermission,
  getUserPermissions,
  requirePermission
};
