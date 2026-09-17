// Admin -> Visitors: the Apply button and the visitor count must stand out (owner request 2026-09-17) --
// Apply was a small outlined button lost among a dozen filter controls, and the count was plain summary
// text the same size as its neighbours.
//
// No build or DOM harness in this repo, so these check the source directly.
// Run with: node --test test/*.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'wwwroot', 'js', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'wwwroot', 'css', 'admin.css'), 'utf8');

// Body of the first CSS rule whose selector is exactly `selector`.
function rule(selector) {
  const start = CSS.indexOf(selector + ' {');
  if (start === -1) return null;
  const open = CSS.indexOf('{', start);
  return CSS.slice(open + 1, CSS.indexOf('}', open));
}
function rem(decl, prop) {
  const m = decl && decl.match(new RegExp(prop + ':\\s*([0-9.]+)rem'));
  return m ? parseFloat(m[1]) : null;
}

test('Visitors Apply button is a filled primary button, not a small outlined one', () => {
  const btn = APP.match(/<button class="([^"]*)" type="button" data-act="apply-visitors-filters">Apply<\/button>/);
  assert.ok(btn, 'Apply button markup found');
  const classes = btn[1].split(/\s+/);
  assert.ok(classes.includes('btn-primary'), 'filled accent background');
  assert.ok(classes.includes('visitors-apply-btn'), 'own prominence class');
  assert.ok(!classes.includes('btn-secondary') && !classes.includes('btn-sm'), 'no longer outlined/small');
});

test('CSS: the Apply button is larger than a normal button and has emphasis', () => {
  const r = rule('.visitors-apply-btn');
  assert.ok(r, '.visitors-apply-btn rule exists');
  assert.ok(rem(r, 'font-size') >= 1.05, 'font-size >= 1.05rem (base buttons are 0.9rem)');
  assert.match(r, /font-weight:\s*(700|800)/);
  assert.match(r, /box-shadow:/);
});

test('guard: Reset and Save-default buttons are unchanged (only Apply is promoted)', () => {
  assert.match(APP, /<button class="btn-secondary btn-sm" type="button" data-act="reset-visitors-filters">Reset<\/button>/);
  assert.match(APP, /<button class="btn-secondary btn-sm" type="button" data-act="save-visitors-min-duration-default"/);
});

test('Visitors summary: the visitor count has its own prominent element', () => {
  assert.ok(APP.includes(`'<span class="visitors-count-hero"><strong>' + list.length.toLocaleString() + '</strong> visitors</span>'`));
});

test('CSS: the visitor count number is much bigger than the other summary numbers', () => {
  const r = rule('.visitors-count-hero strong');
  assert.ok(r, '.visitors-count-hero strong rule exists');
  assert.ok(rem(r, 'font-size') >= 2, 'count font-size >= 2rem (summary bar text is 0.9rem)');
  assert.match(r, /font-weight:\s*(700|800)/);
});
