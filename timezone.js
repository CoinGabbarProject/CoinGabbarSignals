// Small, dependency-free timezone helper for Campaign scheduling.
//
// There's no tz database library in this project (no moment-timezone /
// luxon in package.json), so this supports a curated list of commonly
// used zones with a STATIC UTC offset each. Zones that observe daylight
// saving (US/EU/AU entries below) use their STANDARD-time offset year
// round — i.e. this is not DST-aware. That's an accepted limitation for
// this module; Asia/Kolkata (the required default) has no DST so it is
// always exact. If real DST correctness is ever needed, swap this file
// for a proper IANA tz database library instead of patching offsets here.

const TIMEZONES = [
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST, UTC+05:30)', offsetMinutes: 330 },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)', offsetMinutes: 0 },
  { value: 'America/New_York', label: 'America/New_York (ET, UTC-05:00)', offsetMinutes: -300 },
  { value: 'America/Chicago', label: 'America/Chicago (CT, UTC-06:00)', offsetMinutes: -360 },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PT, UTC-08:00)', offsetMinutes: -480 },
  { value: 'Europe/London', label: 'Europe/London (GMT, UTC+00:00)', offsetMinutes: 0 },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET, UTC+01:00)', offsetMinutes: 60 },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (UTC+04:00)', offsetMinutes: 240 },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (UTC+08:00)', offsetMinutes: 480 },
  { value: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong (UTC+08:00)', offsetMinutes: 480 },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (UTC+08:00)', offsetMinutes: 480 },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+09:00)', offsetMinutes: 540 },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST, UTC+10:00)', offsetMinutes: 600 }
];

const TIMEZONE_VALUES = TIMEZONES.map((t) => t.value);
const OFFSET_BY_ZONE = new Map(TIMEZONES.map((t) => [t.value, t.offsetMinutes]));

function isValidTimezone(tz) {
  return TIMEZONE_VALUES.includes(tz);
}

// "YYYY-MM-DD" + "HH:mm" wall-clock time in `tz` -> UTC instant (Date).
function combineToUtc(dateStr, timeStr, tz) {
  if (!dateStr || !timeStr || !isValidTimezone(tz)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr).trim());
  const t = /^(\d{2}):(\d{2})$/.exec(String(timeStr).trim());
  if (!m || !t) return null;

  const [, y, mo, d] = m.map((v, i) => (i === 0 ? v : Number(v)));
  const [, hh, mm] = t.map((v, i) => (i === 0 ? v : Number(v)));
  const offset = OFFSET_BY_ZONE.get(tz);

  // Build the instant as if the wall-clock values were UTC, then shift by
  // the zone's offset so the result is the true UTC instant.
  const asIfUtcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm));
  if (Number.isNaN(asIfUtcMs)) return null;
  return new Date(asIfUtcMs - offset * 60000);
}

// UTC instant -> { date: "YYYY-MM-DD", time: "HH:mm" } wall-clock in `tz`.
function splitFromUtc(date, tz) {
  if (!date) return { date: '', time: '' };
  const offset = OFFSET_BY_ZONE.get(tz) || 0;
  const localMs = new Date(date).getTime() + offset * 60000;
  const local = new Date(localMs);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`
  };
}

module.exports = { TIMEZONES, TIMEZONE_VALUES, isValidTimezone, combineToUtc, splitFromUtc };
