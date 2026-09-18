// Admin -> Study-Link Leads: everyone who asked for the free practice link on the CDL pages (the site's
// study-link card and desktop popup, 2026-09-18), backed by the API's GET /console/study-link-requests.
// Read-only on purpose -- no "Copy emails": promos to these people wait for the promo pipeline
// (unsubscribe link + postal address), and the table must make consent obvious per row.
//
// Runs the real row helper extracted from wwwroot/js/app.js.
// Run with: node --test test/*.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'wwwroot', 'js', 'app.js'), 'utf8');

function blockAfter(marker) {
  const start = APP.indexOf(marker);
  assert.notEqual(start, -1, `found: ${marker}`);
  let depth = 1, i = start + marker.length;
  for (; i < APP.length && depth; i++) {
    if (APP[i] === '{') depth++;
    else if (APP[i] === '}') depth--;
  }
  return APP.slice(start + marker.length, i - 1);
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rowHtml = (r) => new Function('r', 'escapeHtml', blockAfter('function studyLinkLeadRowHtml(r) {'))(r, escapeHtml);

const NOW = Math.floor(Date.now() / 1000);

test('a row shows who, which track, where they asked, consent, and whether the link went out', () => {
  const html = rowHtml({ email: 'a@example.com', exam_type: 'tx_cdl', source: 'track_exit', marketing_opt_in: 1, opt_in_at: NOW, updated_at: NOW, sent_at: NOW });
  assert.match(html, /a@example\.com/);
  assert.match(html, /tx_cdl/);
  assert.match(html, /Exit popup \(track page\)/);
  assert.match(html, /Yes/);
  assert.doesNotMatch(html, /Not sent/);
});

test('no consent and an unsent link are shown plainly', () => {
  const html = rowHtml({ email: 'b@example.com', exam_type: 'ca_cdl', source: 'category_card', marketing_opt_in: 0, opt_in_at: null, updated_at: NOW, sent_at: null });
  assert.match(html, /\/cdl card/);
  assert.match(html, />No</);
  assert.match(html, /Not sent/);
});

test('emails are escaped', () => {
  const html = rowHtml({ email: '<x>@example.com', exam_type: 'tx_cdl', source: 'track_card', marketing_opt_in: 0, updated_at: NOW, sent_at: NOW });
  assert.doesNotMatch(html, /<x>/);
});

test('the tab is registered, routed, and has no bulk-copy action', () => {
  assert.match(APP, /\['study-link-leads', 'Study-Link Leads'\]/);
  assert.match(APP, /view === 'study-link-leads'\) renderStudyLinkLeads\(\)/);
  assert.match(APP, /\/console\/study-link-requests\?days=/);
  assert.doesNotMatch(APP, /copy-study-link-leads/);
});
