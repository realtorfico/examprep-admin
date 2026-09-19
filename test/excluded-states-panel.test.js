// Admin -> Excluded States panel (EXCLUDED_STATES_BY_CATEGORY) is hand-kept in sync with the public
// homepage's "Not offered in N states" pills (CATEGORY_EXCLUDED_INFO in the site's app.js) -- two
// hardcoded copies in two repos, no shared source. On 2026-09-16, 23 notary tracks and Arizona boating
// were switched off (no exam required in those states); the site pill counts were updated 2026-09-19
// (examprep test/homepage-must-fix.test.js) and this is the admin side of the same numbers.
// Counts checked against track_registry on 2026-09-19: Notary 27 live, Boating 24, Motorcycle 16,
// Real Estate Broker 44 -- each plus its excluded count is 50.
//
// Run with: node --test test/*.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'wwwroot', 'js', 'app.js'), 'utf8');

function excludedList() {
  const marker = 'var EXCLUDED_STATES_BY_CATEGORY = ';
  const start = APP.indexOf(marker);
  assert.notEqual(start, -1);
  const end = APP.indexOf('\n];', start);
  return new Function('return ' + APP.slice(start + marker.length, end + 2))();
}
const statesOf = (c) => c.groups.reduce((acc, g) => acc.concat(g.states), []);

test('each category\'s excluded count matches the public homepage pill', () => {
  const counts = {};
  for (const c of excludedList()) counts[c.category] = statesOf(c).length;
  assert.deepEqual(counts, { 'Notary': 23, 'Real Estate Broker': 6, 'Motorcycle': 34, 'Boating': 26 });
});

test('the 2026-09-16 switch-offs are listed with their reason, and no state is listed twice', () => {
  const list = excludedList();
  const notary = list.find((c) => c.category === 'Notary');
  assert.deepEqual(statesOf(notary).slice().sort(), ['AK', 'AL', 'DE', 'FL', 'GA', 'IA', 'ID', 'KS', 'KY', 'MA', 'MI', 'MN', 'MS',
    'ND', 'NH', 'OK', 'SC', 'SD', 'TN', 'TX', 'VA', 'WA', 'WV']);
  const boating = list.find((c) => c.category === 'Boating');
  const az = boating.groups.find((g) => g.states.includes('AZ'));
  assert.ok(az, 'Arizona boating is listed');
  assert.match(az.reason, /no exam/i);
  for (const c of list) assert.equal(new Set(statesOf(c)).size, statesOf(c).length, c.category + ' lists a state twice');
});
