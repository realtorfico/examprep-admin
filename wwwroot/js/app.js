var appEl = document.getElementById('app');

// ---- Theme / font (localStorage-only here — no app-user token on the admin site) ---

function loadLocalPrefs() {
  return {
    theme: localStorage.getItem('examprep_admin_theme') || 'dark',
    fontScale: parseFloat(localStorage.getItem('examprep_admin_font') || '1'),
  };
}
function saveLocalPrefs(theme, fontScale) {
  localStorage.setItem('examprep_admin_theme', theme);
  localStorage.setItem('examprep_admin_font', String(fontScale));
}
// CSP (style-src 'self', no unsafe-inline) blocks inline styles set via JS too, not just
// style="..." attributes -- so --font-scale can't be set with style.setProperty(). fontScale is
// bounded [0.85, 1.4] in 0.05 steps (12 values, see font-up/down below), so a small fixed set of
// font-scale-NN classes (see admin.css) covers it instead.
function applyTheme(theme, fontScale) {
  var root = document.documentElement;
  if (theme && theme !== 'system') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  if (fontScale) {
    root.className = root.className.replace(/\bfont-scale-\d+\b/g, '').trim();
    root.classList.add('font-scale-' + Math.round(fontScale * 100));
  }
}

function renderTopControls() {
  var local = loadLocalPrefs();
  var nextTheme = local.theme === 'light' ? 'dark' : 'light';
  // Label shows what clicking WILL switch to, not the current theme.
  return '<div class="top-controls">' +
    '<div class="control-group"><button class="btn-secondary btn-sm" data-act="toggle-theme" data-next="' + nextTheme + '">' +
    (nextTheme === 'dark' ? '🌙 Dark' : '☀️ Light') + '</button></div>' +
    '<div class="control-group"><span class="muted font-label">Font:</span>' +
    '<div class="font-size-pill"><button data-act="font-down">A-</button><button data-act="font-up">A+</button></div></div>' +
    '</div>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function renderTabs(active) {
  var tabs = [['settings', 'Settings'], ['points', 'Points'], ['codes', 'Codes'], ['promotions', 'Promotions'], ['refunds', 'Refund Claims'], ['questions', 'Question Bank'], ['stats', 'Stats'], ['stalled', 'Stalled Buyers']];
  return renderTopControls() + '<nav class="tabs">' + tabs.map(function (t) {
    return '<a href="#/' + t[0] + '"' + (active === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</a>';
  }).join('') + '</nav>';
}

// ---- Promotions -------------------------------------------------------
// Admin-managed list of promo banners shown on the public site's home and/or checkout pages.
// A promo with a code is a real discount applied server-side at checkout (see the Worker's
// quoteCheckout) -- one with no code is purely a marketing message. Reorder is up/down-arrow
// swap-with-neighbor rather than drag-and-drop, to keep this simple.

var promotionsCache = [];
var promotionFormState = null; // null (closed) | 'new' | the promotion object being edited

function promotionFormHtml() {
  if (!promotionFormState) return '';
  var editing = promotionFormState !== 'new';
  var p = editing ? promotionFormState : {};
  var discountValueDisplay = p.discount_type === 'flat_cents' ? (p.discount_value ? p.discount_value / 100 : '') : (p.discount_value || '');
  return '<form class="card promotion-form" data-act="save-promotion" data-id="' + (editing ? p.id : '') + '">' +
    '<h3>' + (editing ? 'Edit promotion' : 'Add promotion') + '</h3>' +
    '<label>Title<input type="text" name="title" required value="' + escapeHtml(p.title || '') + '"></label>' +
    '<label>Message<textarea name="body" required rows="2">' + escapeHtml(p.body || '') + '</textarea></label>' +
    '<label>Button label (optional)<input type="text" name="ctaLabel" value="' + escapeHtml(p.cta_label || '') + '"></label>' +
    '<label>Button link (optional)<input type="text" name="ctaUrl" placeholder="https://…" value="' + escapeHtml(p.cta_url || '') + '"></label>' +
    '<label>Where it shows<select name="placement">' +
    ['home', 'checkout', 'refer', 'both'].map(function (pl) {
      return '<option value="' + pl + '"' + (p.placement === pl ? ' selected' : '') + '>' +
        (pl === 'home' ? 'Home page only' : pl === 'checkout' ? 'Checkout page only' :
         pl === 'refer' ? 'Refer-a-friend page only' : 'Both (home + checkout)') + '</option>';
    }).join('') + '</select></label>' +
    '<p class="muted page-intro-text">Leave both the discount value and required email domain blank for a message-only ' +
    'promo with no real discount. Leave just the code blank but set a required email domain (e.g. .edu) to auto-apply ' +
    'the discount whenever a matching email is entered at checkout — no code for the buyer to type, since the domain ' +
    '(and verification, if enabled below) is the real gate anyway.</p>' +
    '<label>Promo code (optional — leave blank for a domain-gated discount to auto-apply with no code)' +
    '<input type="text" name="promoCode" placeholder="e.g. SAVE20" value="' + escapeHtml(p.promo_code || '') + '"></label>' +
    '<label>Discount type<select name="discountType">' +
    '<option value="percent"' + (p.discount_type !== 'flat_cents' ? ' selected' : '') + '>Percent off</option>' +
    '<option value="flat_cents"' + (p.discount_type === 'flat_cents' ? ' selected' : '') + '>Flat amount off ($)</option>' +
    '</select></label>' +
    '<label>Discount value (percent 1-100, or dollars if flat amount)<input type="number" name="discountValue" min="0" step="0.01" value="' + discountValueDisplay + '"></label>' +
    '<label>Require email domain (optional — e.g. .edu for a student discount)<input type="text" name="requiredEmailDomain" placeholder=".edu" value="' + escapeHtml(p.required_email_domain || '') + '"></label>' +
    '<label class="promotion-active-toggle"><input type="checkbox" name="requireEmailVerification"' + (p.require_email_verification ? ' checked' : '') + '> ' +
    'Require email verification (sends a one-time confirmation link before the discount applies — recommended with a domain restriction, since that alone only checks the typed string, not real ownership)</label>' +
    '<p class="muted page-intro-text">A points multiplier is a completely different effect from the discount above — ' +
    'redeemed on the Refer-a-Friend page (not checkout), it multiplies future referral points on that person\'s account ' +
    'for a set number of days. There\'s no domain to check for something like "retired professional," so the promo code ' +
    'itself (plus optional email verification above) is the only real gate — keep it semi-private and hand it out directly ' +
    'rather than advertising it broadly, if that matters for this promo.</p>' +
    '<label>Points multiplier (optional — e.g. 2 to double referral points)<input type="number" name="pointsMultiplier" min="2" step="1" value="' + (p.points_multiplier || '') + '"></label>' +
    '<label>Multiplier lasts (days, once redeemed)<input type="number" name="pointsMultiplierDays" min="1" step="1" placeholder="30" value="' + (p.points_multiplier_days || '') + '"></label>' +
    '<label class="promotion-active-toggle"><input type="checkbox" name="active"' + (p.active ? ' checked' : '') + '> Active</label>' +
    '<div class="progress-reset-actions">' +
    '<button class="btn-primary" type="submit">Save</button>' +
    '<button class="btn-secondary" type="button" data-act="cancel-promotion-form">Cancel</button>' +
    '</div></form>';
}

function promotionRowHtml(p, index, total) {
  var discountLabel = p.discount_type === 'flat_cents' ? '$' + (p.discount_value / 100).toFixed(2) + ' off' : p.discount_value + '% off';
  var codeInfo;
  if (p.discount_value) {
    codeInfo = (p.promo_code ? '<span class="badge">' + escapeHtml(p.promo_code) + '</span> ' : '<span class="badge">No code — auto-applies</span> ') +
      discountLabel +
      (p.required_email_domain ? ' · requires ' + escapeHtml(p.required_email_domain) + ' email' : '') +
      (p.require_email_verification ? ' (verified)' : '') +
      ' · ' + p.redeemed_count + ' redeemed';
  } else if (p.points_multiplier) {
    codeInfo = '<span class="badge">' + escapeHtml(p.promo_code || '—') + '</span> ' +
      p.points_multiplier + '× points for ' + (p.points_multiplier_days || 0) + ' days' +
      (p.require_email_verification ? ' (verified)' : '') +
      ' · ' + p.redeemed_count + ' redeemed';
  } else {
    codeInfo = '<span class="muted">Message only, no discount</span>';
  }
  return '<div class="card promotion-row">' +
    '<div class="promotion-row-top">' +
    '<strong>' + escapeHtml(p.title) + '</strong> ' +
    '<span class="badge' + (p.active ? ' active' : '') + '">' + (p.active ? 'Active' : 'Inactive') + '</span> ' +
    '<span class="muted">' + p.placement + '</span>' +
    '</div>' +
    '<p class="muted promotion-row-body">' + escapeHtml(p.body) + '</p>' +
    '<p class="promotion-row-code">' + codeInfo + '</p>' +
    '<div class="promotion-row-actions">' +
    '<button class="btn-secondary btn-sm" type="button" data-act="reorder-promotion" data-id="' + p.id + '" data-direction="up"' + (index === 0 ? ' disabled' : '') + '>▲</button>' +
    '<button class="btn-secondary btn-sm" type="button" data-act="reorder-promotion" data-id="' + p.id + '" data-direction="down"' + (index === total - 1 ? ' disabled' : '') + '>▼</button>' +
    '<button class="btn-secondary btn-sm" type="button" data-act="toggle-promotion-active" data-id="' + p.id + '" data-active="' + (p.active ? '0' : '1') + '">' + (p.active ? 'Deactivate' : 'Activate') + '</button>' +
    '<button class="btn-secondary btn-sm" type="button" data-act="edit-promotion" data-id="' + p.id + '">Edit</button>' +
    '<button class="btn-secondary btn-sm" type="button" data-act="delete-promotion" data-id="' + p.id + '">Delete</button>' +
    '</div></div>';
}

async function renderPromotions() {
  appEl.innerHTML = renderTabs('promotions') + '<p>Loading…</p>';
  var data = await apiFetch('/console/promotions');
  promotionsCache = data.promotions;
  drawPromotions();
}

function drawPromotions() {
  var rows = promotionsCache.map(function (p, i) { return promotionRowHtml(p, i, promotionsCache.length); }).join('');
  var empty = promotionsCache.length ? '' : '<p class="muted">No promotions yet.</p>';
  var addButton = promotionFormState ? '' : '<button class="btn-primary btn-sm" type="button" data-act="add-promotion">+ Add promotion</button>';
  appEl.innerHTML = renderTabs('promotions') +
    '<p class="muted page-intro-text">Shown on the public site\'s home page and/or checkout page. A promo with a ' +
    'code is a real discount applied at checkout; one with no code is just a marketing message.</p>' +
    '<div class="card"><div id="promotion-form-wrap">' + promotionFormHtml() + '</div>' + addButton + '</div>' +
    empty + rows;
}

// ---- Codes ----------------------------------------------------------------

async function renderCodes() {
  appEl.innerHTML = renderTabs('codes') + '<p>Loading…</p>';
  var data = await apiFetch('/console/codes');
  var rows = data.codes.map(function (c) {
    return '<tr><td>' + c.code + '</td><td>' + c.exam_type + '</td>' +
      '<td><span class="badge ' + c.status + '">' + c.status + '</span></td>' +
      '<td>' + (c.note || '—') + '</td>' +
      '<td>' + (c.expires_at ? new Date(c.expires_at * 1000).toLocaleDateString() : '—') + '</td>' +
      '<td>' + (c.redeemed_at ? new Date(c.redeemed_at * 1000).toLocaleDateString() : '—') + '</td>' +
      '<td>' + (c.status !== 'revoked' ? '<button class="btn" data-act="revoke-code" data-code="' + c.code + '">Revoke</button>' : '') + '</td></tr>';
  }).join('');

  appEl.innerHTML = renderTabs('codes') +
    '<div class="card">' +
    '<form data-act="generate-code" class="generate-form">' +
    '<select name="examType"><option value="notary">Notary</option></select>' +
    '<input type="text" name="note" placeholder="note (optional)">' +
    '<input type="number" name="expiresInDays" placeholder="expires in days (optional)" class="expires-input">' +
    '<button class="btn-primary" type="submit">Generate code</button>' +
    '</form></div>' +
    '<table><thead><tr><th>Code</th><th>Exam</th><th>Status</th><th>Note</th><th>Expires</th><th>Redeemed</th><th></th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>';
}

// ---- Questions --------------------------------------------------------

var EXAM_TYPES = [['notary', 'California Notary'], ['dre', 'California DRE'], ['mlo', 'National MLO']];
var currentQuestionsExamType = 'notary';
var currentQuestionsTopic = null; // null = "All"
var questionsCache = []; // full (unfiltered-by-topic) list for the current exam type

function renderExamSubTabs() {
  return '<nav class="tabs sub-tabs">' + EXAM_TYPES.map(function (t) {
    return '<a href="#" data-act="select-exam-tab" data-exam="' + t[0] + '"' +
      (t[0] === currentQuestionsExamType ? ' aria-current="page"' : '') + '>' + t[1] + '</a>';
  }).join('') + '</nav>';
}

function distinctTopics(questions) {
  var seen = {};
  var topics = [];
  questions.forEach(function (q) {
    if (!seen[q.topic]) { seen[q.topic] = true; topics.push(q.topic); }
  });
  topics.sort();
  return topics;
}

function topicCounts(questions) {
  var counts = {};
  questions.forEach(function (q) { counts[q.topic] = (counts[q.topic] || 0) + 1; });
  return counts;
}

function renderTopicSubTabs(topics) {
  var counts = topicCounts(questionsCache);
  var tabs = [null].concat(topics);
  return '<nav class="tabs sub-tabs topic-sub-tabs">' + tabs.map(function (t) {
    var count = t === null ? questionsCache.length : (counts[t] || 0);
    return '<a href="#" data-act="select-topic-tab" data-topic="' + (t === null ? '' : t) + '"' +
      (t === currentQuestionsTopic ? ' aria-current="page"' : '') + '>' +
      (t === null ? 'All' : t) + ' (' + count + ')</a>';
  }).join('') + '</nav>';
}

async function renderQuestions() {
  appEl.innerHTML = renderTabs('questions') + renderExamSubTabs() + '<p>Loading…</p>';
  var data = await apiFetch('/console/questions?examType=' + currentQuestionsExamType);
  questionsCache = data.questions;
  drawQuestionsTable();
}

function drawQuestionsTable() {
  var topics = distinctTopics(questionsCache);
  var filtered = currentQuestionsTopic
    ? questionsCache.filter(function (q) { return q.topic === currentQuestionsTopic; })
    : questionsCache;

  var rows = filtered.map(function (q) {
    return '<tr><td>' + q.topic + '</td><td>' + q.question.slice(0, 80) + '</td>' +
      '<td>' + q.weight + '</td><td><span class="badge">' + (q.source || '—') + '</span></td>' +
      '<td><button class="btn" data-act="delete-question" data-id="' + q.id + '">Delete</button></td></tr>';
  }).join('');
  var empty = filtered.length ? '' : '<p class="muted">No questions yet for this exam/topic.</p>';

  appEl.innerHTML = renderTabs('questions') + renderExamSubTabs() + renderTopicSubTabs(topics) +
    '<div class="card"><button class="btn-primary" data-act="import-questions">Import JSON…</button> ' +
    '<input type="file" id="import-file" class="hidden-file-input" accept="application/json"></div>' +
    empty +
    '<table><thead><tr><th>Topic</th><th>Question</th><th>Weight</th><th>Source</th><th></th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>';
}

// ---- Stats --------------------------------------------------------------

// Attempts arrive flat (most-recent-first) from /console/exam-attempts -- grouped here by
// userId so each user's full attempt history nests under one summary row, instead of every
// attempt from every user interleaved in one long table.
function groupExamAttemptsByUser(items) {
  var byUser = {}, order = [];
  items.forEach(function (a) {
    if (!byUser[a.userId]) {
      byUser[a.userId] = { userId: a.userId, code: a.code, buyerEmail: a.buyerEmail, examType: a.examType, attempts: [] };
      order.push(a.userId);
    }
    byUser[a.userId].attempts.push(a);
  });
  return order.map(function (id) { return byUser[id]; });
}

function renderExamUserGroup(u) {
  var best = Math.max.apply(null, u.attempts.map(function (a) { return a.percent; }));
  var passedCount = u.attempts.filter(function (a) { return a.passed; }).length;
  var who = u.buyerEmail || u.code || 'Unknown user';
  var whoSub = u.buyerEmail && u.code ? ' <span class="muted">(' + u.code + ')</span>' : '';

  var attemptsHtml = u.attempts.map(function (a) {
    var scoreCls = a.passed ? 'exam-review-correct' : 'exam-review-incorrect';
    return '<details class="exam-attempt-detail" data-attempt-id="' + a.attemptId + '">' +
      '<summary>' + new Date(a.submittedAt * 1000).toLocaleString() + ' — <span class="' + scoreCls + '">' + a.correct + ' / ' + a.total + '</span>' +
      ' (' + a.percent + '%) <span class="badge ' + (a.passed ? 'redeemed' : 'revoked') + '">' +
      (a.passed ? 'Passed' : 'Not passed') + '</span></summary>' +
      '<div class="exam-attempt-review" id="exam-attempt-review-' + a.attemptId + '"><p class="muted">Loading…</p></div>' +
      '</details>';
  }).join('');

  return '<details class="card admin-user-group">' +
    '<summary><strong>' + who + '</strong>' + whoSub + ' — ' + u.examType + ' — ' + u.attempts.length +
    ' attempt' + (u.attempts.length === 1 ? '' : 's') + ', best ' + best + '%, ' + passedCount + ' passed</summary>' +
    '<div class="admin-user-items">' + attemptsHtml + '</div>' +
    '</details>';
}

// Resource-progress rows are already the leaf-level detail (no further drill-down needed like
// exam attempts have), so each grouped user just lists its resources directly -- no nested
// <details>/lazy-fetch for this one.
function groupResourceProgressByUser(items) {
  var byUser = {}, order = [];
  items.forEach(function (r) {
    if (!byUser[r.user_id]) {
      byUser[r.user_id] = { userId: r.user_id, code: r.code, buyerEmail: r.buyer_email, examType: r.exam_type, items: [] };
      order.push(r.user_id);
    }
    byUser[r.user_id].items.push(r);
  });
  return order.map(function (id) { return byUser[id]; });
}

function renderResourceUserGroup(u) {
  var who = u.buyerEmail || u.code || 'Unknown user';
  var whoSub = u.buyerEmail && u.code ? ' <span class="muted">(' + u.code + ')</span>' : '';

  var rows = u.items.map(function (r) {
    var extent = (r.resource_type === 'audio' || r.resource_type === 'video') ? r.percent + '%' : (r.percent >= 100 ? 'Viewed' : '—');
    return '<tr>' +
      '<td>' + r.resource_file + '</td>' +
      '<td class="muted">' + r.resource_type + '</td>' +
      '<td>' + extent + '</td>' +
      '<td>' + r.times_opened + '</td>' +
      '<td class="muted">' + new Date(r.last_opened_at * 1000).toLocaleDateString() + '</td>' +
      '</tr>';
  }).join('');

  return '<details class="card admin-user-group">' +
    '<summary><strong>' + who + '</strong>' + whoSub + ' — ' + u.examType + ' — ' + u.items.length +
    ' resource' + (u.items.length === 1 ? '' : 's') + '</summary>' +
    '<table class="admin-user-table resource-consumption-table"><thead><tr><th>Resource</th><th>Type</th><th>Progress</th><th>Views</th><th>Last viewed</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '</details>';
}

// Quiz-progress rows arrive as one row per (user, topic) -- grouped here into one card per user,
// each holding its own per-topic accuracy table, mirroring the student's own Progress tab.
// Users are ranked by total questions answered, most active first.
//
// NOTE: this "total/correct" is the same "last attempt wins" combined figure the student's own
// Progress tab shows -- the underlying progress table doesn't record whether a question's current
// status came from quiz mode or a mock exam (a question answered in both only reflects whichever
// happened most recently, see index.js's progressUpsertStmt comment). So it is NOT quiz-only, and
// can't be exactly decomposed into quiz-vs-exam portions. The one exact, unambiguous number we can
// add is the mock-exam side, pulled straight from exam_attempts (see attachExamTotals below).
function groupQuizProgressByUser(items) {
  var byUser = {}, order = [];
  items.forEach(function (r) {
    if (!byUser[r.user_id]) {
      byUser[r.user_id] = {
        userId: r.user_id, code: r.code, buyerEmail: r.buyer_email, examType: r.exam_type, topics: [],
        total: 0, correct: 0, examTotal: 0, examCorrect: 0, seen: 0, topicTotal: 0,
      };
      order.push(r.user_id);
    }
    var u = byUser[r.user_id];
    u.topics.push({ topic: r.topic, total: r.total, correct: r.correct, seen: r.seen, topicTotal: r.topicTotal });
    u.total += r.total;
    u.correct += r.correct;
    u.seen += r.seen;
    u.topicTotal += r.topicTotal;
  });
  var grouped = order.map(function (id) { return byUser[id]; });
  grouped.sort(function (a, b) { return b.total - a.total; });
  return grouped;
}

// Sums each user's submitted mock-exam attempts (correct/total) onto their progress group --
// exam_attempts is per-attempt and mode-unambiguous, unlike the merged progress table above.
function attachExamTotals(groups, examAttemptItems) {
  var byUser = {};
  examAttemptItems.forEach(function (a) {
    if (!byUser[a.userId]) byUser[a.userId] = { correct: 0, total: 0 };
    byUser[a.userId].correct += a.correct;
    byUser[a.userId].total += a.total;
  });
  groups.forEach(function (u) {
    var e = byUser[u.userId];
    u.examCorrect = e ? e.correct : 0;
    u.examTotal = e ? e.total : 0;
  });
  return groups;
}

function topicPctOf(t) { return t.total ? Math.round((100 * t.correct) / t.total) : 0; }
function topicCoverageOf(t) { return t.topicTotal ? Math.round((100 * t.seen) / t.topicTotal) : 0; }
var accuracyPassPct = 70; // overwritten from /console/quiz-progress with the admin-configured value
var coveragePassPct = 50; // overwritten from /console/quiz-progress with the admin-configured value
function accuracyRowClass(pct) { return pct < accuracyPassPct ? 'progress-row-low' : 'progress-row-good'; }
function coverageClass(pct) { return pct < coveragePassPct ? 'progress-row-low' : 'progress-row-good'; }

var QUIZ_PROGRESS_TOPIC_COLUMNS = [['topic', 'Topic'], ['pct', 'Accuracy'], ['coverage', 'Coverage'], ['total', 'Questions']];
var quizProgressGroupsCache = []; // userId -> group, so a per-user sort click can redraw without refetching
var quizProgressTopicSort = {}; // userId -> { key, dir }, independent sort state per user's table

function quizProgressTableHtml(u) {
  var sort = quizProgressTopicSort[u.userId] || (quizProgressTopicSort[u.userId] = { key: 'topic', dir: 1 });
  var rows = u.topics.slice().sort(function (a, b) {
    var av = sort.key === 'topic' ? a.topic.toLowerCase() : sort.key === 'pct' ? topicPctOf(a) : sort.key === 'coverage' ? topicCoverageOf(a) : a.total;
    var bv = sort.key === 'topic' ? b.topic.toLowerCase() : sort.key === 'pct' ? topicPctOf(b) : sort.key === 'coverage' ? topicCoverageOf(b) : b.total;
    if (av < bv) return -1 * sort.dir;
    if (av > bv) return 1 * sort.dir;
    return 0;
  }).map(function (t) {
    var pct = topicPctOf(t);
    var coverage = topicCoverageOf(t);
    // Coverage is its own cell-level color, independent of the row's accuracy-based color -- a
    // topic can be low-accuracy but well-covered, or vice versa, two separate signals.
    return '<tr class="' + accuracyRowClass(pct) + '"><td>' + t.topic + '</td><td>' + pct + '%</td>' +
      '<td><span class="' + coverageClass(coverage) + '">' + coverage + '%</span></td><td>' + t.total + '</td></tr>';
  }).join('');
  var headerCells = QUIZ_PROGRESS_TOPIC_COLUMNS.map(function (c) {
    var indicator = sort.key === c[0] ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<th data-act="sort-quiz-progress-topics" data-user-id="' + u.userId + '" data-key="' + c[0] + '">' + c[1] + indicator + '</th>';
  }).join('');
  return '<table class="admin-user-table"><thead><tr>' + headerCells + '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function renderQuizProgressUserGroup(u) {
  var pct = u.total ? Math.round((100 * u.correct) / u.total) : 0;
  var coverage = u.topicTotal ? Math.round((100 * u.seen) / u.topicTotal) : 0;
  var examPct = u.examTotal ? Math.round((100 * u.examCorrect) / u.examTotal) : 0;
  var examLine = u.examTotal
    ? 'Mock exam: ' + u.examCorrect + '/' + u.examTotal + ' (' + examPct + '%)'
    : 'Mock exam: no attempts yet';

  return '<details class="card admin-user-group">' +
    '<summary><strong>' + (u.code || 'Unknown code') + '</strong> - ' + u.examType + ' - (' +
    '<span class="' + accuracyRowClass(pct) + '">' + pct + '% Accuracy</span>, ' +
    '<span class="' + coverageClass(coverage) + '">' + coverage + '% Coverage</span>)</summary>' +
    '<p class="muted admin-user-subline">' + examLine + '</p>' +
    '<div id="quiz-progress-table-' + u.userId + '">' + quizProgressTableHtml(u) + '</div>' +
    '</details>';
}

// Leaderboard -- top 3 by accuracy, top 3 by coverage, per track, built entirely from the same
// quizProgressGroupsCache the "User progress" section above already has (no separate fetch needed,
// unlike the public site which needs its own /leaderboard endpoint to avoid exposing every user's
// data to a student's browser). Only users who've answered at least leaderboardMinQuestions
// qualify. Descending-only sort, no ascending direction.
var leaderboardMinQuestions = 20; // overwritten from /console/quiz-progress
var leaderboardSortKeyByTrack = {}; // examType -> 'accuracy' | 'coverage'

function groupLeaderboardByTrack(groups) {
  var byTrack = {}, order = [];
  groups.forEach(function (u) {
    if (u.total < leaderboardMinQuestions) return;
    if (!byTrack[u.examType]) { byTrack[u.examType] = []; order.push(u.examType); }
    byTrack[u.examType].push({
      userId: u.userId, who: u.buyerEmail || u.code || 'Unknown user',
      total: u.total, accuracy: u.total ? Math.round((100 * u.correct) / u.total) : 0,
      coverage: u.topicTotal ? Math.round((100 * u.seen) / u.topicTotal) : 0,
    });
  });
  return order.map(function (examType) {
    var users = byTrack[examType];
    var topByAccuracy = users.slice().sort(function (a, b) { return b.accuracy - a.accuracy; }).slice(0, 3);
    var topByCoverage = users.slice().sort(function (a, b) { return b.coverage - a.coverage; }).slice(0, 3);
    var seenIds = {};
    var combined = topByAccuracy.concat(topByCoverage).filter(function (u) {
      if (seenIds[u.userId]) return false;
      seenIds[u.userId] = true;
      return true;
    });
    return { examType: examType, users: combined };
  });
}

function leaderboardTrackTableHtml(track) {
  var key = leaderboardSortKeyByTrack[track.examType] || (leaderboardSortKeyByTrack[track.examType] = 'accuracy');
  if (!track.users.length) return '<p class="muted">No one on this track has answered at least ' + leaderboardMinQuestions + ' questions yet.</p>';
  var rows = track.users.slice().sort(function (a, b) { return b[key] - a[key]; }).slice(0, 3).map(function (u) {
    return '<tr><td>' + u.who + '</td><td>' + u.accuracy + '%</td><td>' + u.coverage + '%</td><td>' + u.total + '</td></tr>';
  }).join('');
  var arrow = function (k) { return key === k ? ' ▼' : ''; };
  return '<table class="admin-user-table"><thead><tr>' +
    '<th>User</th>' +
    '<th data-act="sort-leaderboard" data-track="' + track.examType + '" data-key="accuracy">Accuracy' + arrow('accuracy') + '</th>' +
    '<th data-act="sort-leaderboard" data-track="' + track.examType + '" data-key="coverage">Coverage' + arrow('coverage') + '</th>' +
    '<th>Questions</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

var examAttemptDetailCache = {}; // attemptId -> already-fetched review, avoids refetching on re-toggle

async function loadExamAttemptReview(attemptId) {
  var reviewEl = document.getElementById('exam-attempt-review-' + attemptId);
  if (!reviewEl) return;
  if (examAttemptDetailCache[attemptId]) { reviewEl.innerHTML = examAttemptDetailCache[attemptId]; return; }
  try {
    var detail = await apiFetch('/console/exam-attempts/detail?attemptId=' + encodeURIComponent(attemptId));
    var html = detail.review.map(function (r, i) {
      return '<div class="exam-review-row">' +
        '<div><strong>Q' + (i + 1) + '.</strong> ' + r.topic + ' — ' + r.question + '</div>' +
        '<div class="muted">Your answer: ' + (r.yourChoice ? r.yourChoice + '. ' + r.choices[r.yourChoice] : '(not answered)') + '</div>' +
        (r.correct ? '' : '<div class="muted">Correct answer: ' + r.correctChoice + '. ' + r.choices[r.correctChoice] + '</div>') +
        '<div class="' + (r.correct ? 'exam-review-correct' : 'exam-review-incorrect') + '">' + (r.correct ? 'Correct' : 'Incorrect') + '</div>' +
        '</div>';
    }).join('');
    examAttemptDetailCache[attemptId] = html;
    reviewEl.innerHTML = html;
  } catch (err) {
    reviewEl.innerHTML = '<p class="muted">Could not load this attempt.</p>';
  }
}

// Capture phase: the native "toggle" event on <details> doesn't bubble in every browser, but
// capturing always reaches the target on the way down regardless, so this still fires reliably.
appEl.addEventListener('toggle', function (e) {
  var el = e.target;
  if (!el.classList || !el.classList.contains('exam-attempt-detail') || !el.open) return;
  loadExamAttemptReview(el.getAttribute('data-attempt-id'));
}, true);

// Grouped per-track (exam_type) rather than one flat table with an "Exam" column repeating the
// same value on every row -- accuracy/coverage should always read within one track's context, and
// once DRE/MLO have real content a flat list would only get more confusing to scan. Each track is
// its own collapsible group (closed by default, like the User progress cards below it), with
// independent sort/show-all state, mirroring the per-user topic tables' own pattern.
var ACCURACY_NUMERIC_KEYS = new Set(['pct', 'attempts']);
var ACCURACY_TRACK_COLUMNS = [['topic', 'Topic'], ['pct', '% correct'], ['attempts', 'Attempts']];
var statsAccuracyCache = [];
var accuracySortByTrack = {}; // examType -> { key, dir }
var accuracyExpandedByTrack = {}; // examType -> bool (show-all topics within that track)
var ACCURACY_COLLAPSED_COUNT = 8;

function groupAccuracyByTrack(rows) {
  var byTrack = {}, order = [];
  rows.forEach(function (r) {
    if (!byTrack[r.exam_type]) { byTrack[r.exam_type] = []; order.push(r.exam_type); }
    byTrack[r.exam_type].push(r);
  });
  return order.map(function (examType) { return { examType: examType, topics: byTrack[examType] }; });
}

function accuracyTrackTableHtml(track) {
  var sort = accuracySortByTrack[track.examType] || (accuracySortByTrack[track.examType] = { key: 'topic', dir: 1 });
  var sorted = sortTableRows(track.topics, sort, ACCURACY_NUMERIC_KEYS);
  var expanded = accuracyExpandedByTrack[track.examType];
  var truncated = !expanded && sorted.length > ACCURACY_COLLAPSED_COUNT;
  var visible = truncated ? sorted.slice(0, ACCURACY_COLLAPSED_COUNT) : sorted;
  var body = visible.map(function (a) {
    return '<tr class="' + accuracyRowClass(a.pct) + '"><td>' + a.topic + '</td><td>' + a.pct + '%</td><td>' + a.attempts + '</td></tr>';
  }).join('');
  var headerRow = '<tr>' + ACCURACY_TRACK_COLUMNS.map(function (c) {
    var indicator = sort.key === c[0] ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<th data-act="sort-accuracy" data-track="' + track.examType + '" data-key="' + c[0] + '">' + c[1] + indicator + '</th>';
  }).join('') + '</tr>';
  var toggleHtml = sorted.length > ACCURACY_COLLAPSED_COUNT
    ? '<button class="btn-secondary btn-sm" type="button" data-act="toggle-accuracy-topics" data-track="' + track.examType + '">' +
      (truncated ? 'Show all ' + sorted.length + ' ▾' : 'Show fewer ▴') + '</button>'
    : '';
  return '<table><thead>' + headerRow + '</thead><tbody>' + body + '</tbody></table>' + toggleHtml;
}

function drawAccuracyTable() {
  var container = document.getElementById('accuracy-table-container');
  if (!container) return;
  var tracks = groupAccuracyByTrack(statsAccuracyCache);
  container.innerHTML = tracks.map(function (track) {
    return '<details class="card admin-user-group">' +
      '<summary><strong>' + track.examType + '</strong> — ' + track.topics.length + ' topic' + (track.topics.length === 1 ? '' : 's') + '</summary>' +
      '<div id="accuracy-track-table-' + track.examType + '">' + accuracyTrackTableHtml(track) + '</div>' +
      '</details>';
  }).join('');
}

async function renderStats() {
  appEl.innerHTML = renderTabs('stats') + '<p>Loading…</p>';
  var results = await Promise.all([
    apiFetch('/console/stats'), apiFetch('/console/resource-progress'), apiFetch('/console/exam-attempts'), apiFetch('/console/quiz-progress'),
  ]);
  var s = results[0], resourceProgress = results[1], examAttempts = results[2], quizProgress = results[3];
  if (typeof quizProgress.accuracyPassPct === 'number') accuracyPassPct = quizProgress.accuracyPassPct;
  if (typeof quizProgress.coveragePassPct === 'number') coveragePassPct = quizProgress.coveragePassPct;
  if (typeof quizProgress.leaderboardMinQuestions === 'number') leaderboardMinQuestions = quizProgress.leaderboardMinQuestions;
  var codeRows = s.codes.map(function (c) {
    return '<tr><td>' + c.exam_type + '</td><td>' + c.status + '</td><td>' + c.n + '</td></tr>';
  }).join('');
  statsAccuracyCache = s.accuracyByTopic.map(function (a) {
    return { exam_type: a.exam_type, topic: a.topic, attempts: a.attempts, pct: a.attempts ? Math.round((100 * a.correct) / a.attempts) : 0 };
  });
  var resourceUsersHtml = groupResourceProgressByUser(resourceProgress.items).map(renderResourceUserGroup).join('');
  var resourceEmpty = resourceProgress.items.length ? '' : '<p class="muted">No resource activity yet.</p>';
  var examUsersHtml = groupExamAttemptsByUser(examAttempts.items).map(renderExamUserGroup).join('');
  var examEmpty = examAttempts.items.length ? '' : '<p class="muted">No mock exams taken yet.</p>';
  quizProgressGroupsCache = attachExamTotals(groupQuizProgressByUser(quizProgress.items), examAttempts.items);
  var quizUsersHtml = quizProgressGroupsCache.map(renderQuizProgressUserGroup).join('');
  var quizEmpty = quizProgress.items.length ? '' : '<p class="muted">No quiz activity yet.</p>';
  var leaderboardTracksHtml = groupLeaderboardByTrack(quizProgressGroupsCache).map(function (track) {
    return '<details class="card admin-user-group">' +
      '<summary><strong>' + track.examType + '</strong></summary>' +
      '<div id="leaderboard-table-' + track.examType + '">' + leaderboardTrackTableHtml(track) + '</div>' +
      '</details>';
  }).join('');
  var leaderboardEmpty = quizProgressGroupsCache.length ? '' : '<p class="muted">No quiz activity yet.</p>';

  appEl.innerHTML = renderTabs('stats') +
    '<div class="card"><strong>' + s.totalUsers + '</strong> total users</div>' +
    '<div class="stats-grid">' +
    '<div class="stats-column"><h3>Codes by status</h3><table><thead><tr><th>Exam</th><th>Status</th><th>Count</th></tr></thead><tbody>' + codeRows + '</tbody></table></div>' +
    '<div class="stats-column"><h3>Accuracy by topic</h3><div id="accuracy-table-container"></div></div>' +
    '</div>' +
    '<div class="stats-grid">' +
    '<div class="stats-column"><h3>User progress</h3>' +
    '<p class="muted page-intro-text">Per-user accuracy by topic (quiz + mock exam combined, same as each user\'s own Progress tab), plus their mock-exam-only total.</p>' +
    quizEmpty + quizUsersHtml + '</div>' +
    '<div class="stats-column"><h3>Mock exam attempts</h3>' +
    '<p class="muted page-intro-text">Grouped by user, most recently active first. Expand a user to see each attempt; ' +
    'expand an attempt for the full question-by-question review. Capped at the 1000 most recent attempts.</p>' +
    examEmpty + examUsersHtml + '</div>' +
    '</div>' +
    '<div class="stats-column"><h3>Leaderboard</h3>' +
    '<p class="muted page-intro-text">Top 3 by accuracy and by coverage, per track, among users who\'ve answered at least ' +
    leaderboardMinQuestions + ' questions.</p>' +
    leaderboardEmpty + leaderboardTracksHtml + '</div>' +
    '<div class="stats-column"><h3>Resource consumption</h3>' + resourceEmpty + resourceUsersHtml + '</div>';
  drawAccuracyTable();
}

// ---- Settings (course pricing) --------------------------------------------
// Flat list, not sub-tabbed like Questions — only 3 exam types, so one screen showing
// all of them at once is simpler than clicking between tabs to see/edit each price.

async function renderSettings() {
  appEl.innerHTML = renderTabs('settings') + '<p>Loading…</p>';
  var results = await Promise.all([
    apiFetch('/console/pricing'),
    apiFetch('/console/point-rules'),
    apiFetch('/console/settings'),
  ]);
  var pricingData = results[0], pointRulesData = results[1], settingsData = results[2];

  var byExam = {};
  pricingData.pricing.forEach(function (p) { byExam[p.exam_type] = p; });
  var priceRows = EXAM_TYPES.map(function (t) {
    var examType = t[0], label = t[1];
    var p = byExam[examType];
    var dollars = p ? (p.price_cents / 100).toFixed(2) : '';
    return '<div class="card price-row">' +
      '<span class="price-row-label">' + label + '</span>' +
      '<input type="number" step="0.01" min="0" class="price-input" data-exam="' + examType + '" value="' + dollars + '" placeholder="0.00">' +
      '<button class="btn-primary btn-sm" data-act="save-price" data-exam="' + examType + '">Save</button>' +
      '</div>';
  }).join('');

  var ruleRows = pointRulesData.pointRules.map(function (r) {
    return '<div class="card price-row">' +
      '<span class="price-row-label">' + r.label + '</span>' +
      '<input type="number" min="0" class="rule-points-input" data-task="' + r.task_key + '" value="' + r.points + '" placeholder="points">' +
      '<label class="rule-active-label"><input type="checkbox" class="rule-active-input" data-task="' + r.task_key + '"' +
      (r.active ? ' checked' : '') + '> Active</label>' +
      '<button class="btn-primary btn-sm" data-act="save-point-rule" data-task="' + r.task_key + '" data-label="' + r.label + '">Save</button>' +
      '</div>';
  }).join('');

  var bySetting = {};
  settingsData.settings.forEach(function (s) { bySetting[s.key] = s.value; });
  var minChargeCents = parseInt(bySetting.min_paypal_charge_cents, 10);
  var minChargeDollars = Number.isFinite(minChargeCents) ? (minChargeCents / 100).toFixed(2) : '1.00';
  var minChargeRow = '<div class="card price-row">' +
    '<span class="price-row-label">Minimum card/wallet charge</span>' +
    '<input type="number" step="0.01" min="0" class="min-charge-input" value="' + minChargeDollars + '" placeholder="1.00">' +
    '<button class="btn-primary btn-sm" data-act="save-min-charge">Save</button>' +
    '</div>';

  var alertEmail = bySetting.admin_alert_email || '';
  var alertEmailRow = '<div class="card price-row">' +
    '<span class="price-row-label">Alert email</span>' +
    '<input type="email" class="alert-email-input" value="' + alertEmail + '" placeholder="you@example.com">' +
    '<button class="btn-primary btn-sm" data-act="save-alert-email">Save</button>' +
    '</div>';

  var accuracyPassPct = parseInt(bySetting.progress_accuracy_pass_pct, 10);
  var accuracyPassPctVal = Number.isFinite(accuracyPassPct) ? accuracyPassPct : 80;
  var accuracyPassPctRow = '<div class="card price-row">' +
    '<span class="price-row-label">Accuracy turns green at/above</span>' +
    '<input type="number" step="1" min="0" max="100" class="accuracy-pass-pct-input" value="' + accuracyPassPctVal + '" placeholder="80">' +
    '<button class="btn-primary btn-sm" data-act="save-accuracy-pass-pct">Save</button>' +
    '</div>';

  var coveragePassPct = parseInt(bySetting.progress_coverage_pass_pct, 10);
  var coveragePassPctVal = Number.isFinite(coveragePassPct) ? coveragePassPct : 50;
  var coveragePassPctRow = '<div class="card price-row">' +
    '<span class="price-row-label">Coverage turns green at/above</span>' +
    '<input type="number" step="1" min="0" max="100" class="coverage-pass-pct-input" value="' + coveragePassPctVal + '" placeholder="50">' +
    '<button class="btn-primary btn-sm" data-act="save-coverage-pass-pct">Save</button>' +
    '</div>';

  appEl.innerHTML = renderTabs('settings') +
    '<div class="settings-grid">' +
    '<div class="settings-column">' +
    '<h3>Course pricing</h3>' +
    '<p class="muted page-intro-text">Price shown to buyers on the public site\'s self-serve purchase flow, in USD.</p>' +
    priceRows +
    '</div>' +
    '<div class="settings-column">' +
    '<h3>Point rules</h3>' +
    '<p class="muted page-intro-text">How many points each referral task awards (1 point = 1 cent, so these read directly ' +
    'as cents toward a free course). Uncheck Active to stop awarding it without losing history.</p>' +
    ruleRows +
    '</div>' +
    '<div class="settings-column">' +
    '<h3>Points discount floor</h3>' +
    '<p class="muted page-intro-text">A points discount can never leave less than this payable through the card/wallet processor ' +
    '(points fully covering a course still redeem free with zero cash, no charge involved, so this doesn\'t affect that).</p>' +
    minChargeRow +
    '</div>' +
    '<div class="settings-column">' +
    '<h3>Activity alerts</h3>' +
    '<p class="muted page-intro-text">Get emailed when a referral is confirmed or converts, points are redeemed, or someone ' +
    'buys a course. Leave blank to turn alerts off.</p>' +
    alertEmailRow +
    '</div>' +
    '<div class="settings-column">' +
    '<h3>Progress tab colors</h3>' +
    '<p class="muted page-intro-text">Thresholds (%) for when the student\'s headline Accuracy and Coverage numbers on the ' +
    'Progress tab show green (at/above) vs. red (below).</p>' +
    accuracyPassPctRow + coveragePassPctRow +
    '</div>' +
    '</div>';
}

// ---- Points (accounts, manual adjustments, referral log) ------------------

var pointsAccountsCache = [];
var pointsReferralsCache = [];
var accountsSort = { key: 'points', dir: -1 }; // matches the old default: highest points first
var referralsSort = { key: 'created_at', dir: -1 }; // matches the old default: newest first
var statusBadgeClass = { invited: 'unused', verified: '', converted: 'redeemed' };

var ACCOUNTS_NUMERIC_KEYS = new Set(['points', 'referrals_sent', 'referrals_verified', 'referrals_converted', 'created_at']);
var ACCOUNTS_COLUMNS = [
  ['email', 'Email'], ['name', 'Name'], ['points', 'Points'], ['referrals_sent', 'Sent'],
  ['referrals_verified', 'Verified'], ['referrals_converted', 'Converted'], ['created_at', 'Joined'],
];
var REFERRALS_NUMERIC_KEYS = new Set(['created_at', 'verified_at', 'converted_at']);
var REFERRALS_COLUMNS = [
  ['referrer_email', 'Referrer'], ['referrer_name', 'Referrer Name'], ['referred_name', 'Referred Name'],
  ['referred_email', 'Referred Email'], ['status', 'Status'], ['created_at', 'Created'],
  ['verified_at', 'Verified'], ['converted_at', 'Converted'],
];

function sortTableRows(rows, sortState, numericKeys) {
  var sorted = rows.slice();
  var key = sortState.key, dir = sortState.dir;
  sorted.sort(function (a, b) {
    var av = a[key], bv = b[key];
    if (numericKeys.has(key)) {
      av = av == null ? -Infinity : av;
      bv = bv == null ? -Infinity : bv;
      return (av - bv) * dir;
    }
    av = (av == null ? '' : String(av)).toLowerCase();
    bv = (bv == null ? '' : String(bv)).toLowerCase();
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
  return sorted;
}

function sortableHeaderRow(columns, sortState, act) {
  return '<tr>' + columns.map(function (c) {
    var indicator = sortState.key === c[0] ? (sortState.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<th data-act="' + act + '" data-key="' + c[0] + '">' + c[1] + indicator + '</th>';
  }).join('') + '</tr>';
}

function drawAccountsTable() {
  var container = document.getElementById('accounts-table-container');
  if (!container) return;
  var rows = sortTableRows(pointsAccountsCache, accountsSort, ACCOUNTS_NUMERIC_KEYS);
  var body = rows.map(function (a) {
    return '<tr><td>' + a.email + '</td><td>' + (a.name || '—') + '</td><td>' + a.points + '</td>' +
      '<td>' + a.referrals_sent + '</td><td>' + a.referrals_verified + '</td><td>' + a.referrals_converted + '</td>' +
      '<td>' + new Date(a.created_at * 1000).toLocaleDateString() + '</td></tr>';
  }).join('');
  container.innerHTML = '<table><thead>' + sortableHeaderRow(ACCOUNTS_COLUMNS, accountsSort, 'sort-accounts') +
    '</thead><tbody>' + body + '</tbody></table>';
}

function drawReferralsTable() {
  var container = document.getElementById('referrals-table-container');
  if (!container) return;
  var rows = sortTableRows(pointsReferralsCache, referralsSort, REFERRALS_NUMERIC_KEYS);
  var body = rows.map(function (r) {
    return '<tr><td>' + r.referrer_email + '</td><td>' + (r.referrer_name || '—') + '</td><td>' + (r.referred_name || '—') + '</td><td>' + r.referred_email + '</td>' +
      '<td><span class="badge ' + (statusBadgeClass[r.status] || '') + '">' + r.status + '</span></td>' +
      '<td>' + new Date(r.created_at * 1000).toLocaleDateString() + '</td>' +
      '<td>' + (r.verified_at ? new Date(r.verified_at * 1000).toLocaleDateString() : '—') + '</td>' +
      '<td>' + (r.converted_at ? new Date(r.converted_at * 1000).toLocaleDateString() : '—') + '</td></tr>';
  }).join('');
  container.innerHTML = '<table><thead>' + sortableHeaderRow(REFERRALS_COLUMNS, referralsSort, 'sort-referrals') +
    '</thead><tbody>' + body + '</tbody></table>';
}

async function renderPoints() {
  appEl.innerHTML = renderTabs('points') + '<p>Loading…</p>';
  var results = await Promise.all([
    apiFetch('/console/accounts'),
    apiFetch('/console/referrals'),
  ]);
  pointsAccountsCache = results[0].accounts;
  pointsReferralsCache = results[1].referrals;

  var accountsEmpty = pointsAccountsCache.length ? '' : '<p class="muted">No referral accounts yet.</p>';
  var referralsEmpty = pointsReferralsCache.length ? '' : '<p class="muted">No referrals yet.</p>';

  appEl.innerHTML = renderTabs('points') +
    '<div class="card">' +
    '<form data-act="adjust-points" class="generate-form">' +
    '<input type="email" name="accountEmail" placeholder="account email" required>' +
    '<input type="number" name="delta" placeholder="+/- points" required>' +
    '<input type="text" name="reason" placeholder="reason" required>' +
    '<button class="btn-primary" type="submit">Adjust</button>' +
    '</form></div>' +
    '<h3>Accounts</h3>' + accountsEmpty +
    '<div id="accounts-table-container"></div>' +
    '<h3>Referral log</h3>' + referralsEmpty +
    '<div id="referrals-table-container"></div>';
  drawAccountsTable();
  drawReferralsTable();
}

// ---- Refund claims ----------------------------------------------------

async function renderRefunds() {
  appEl.innerHTML = renderTabs('refunds') + '<p>Loading…</p>';
  var data = await apiFetch('/console/refund-claims');
  var claimTypeLabel = { unconditional_7day: '7-Day', exam_failure_50pct: 'Exam Failure 50%' };
  var statusBadgeClass = { pending: '', approved: '', denied: 'revoked', refunded: 'redeemed' };
  var processorLabel = function (note) {
    if (!note) return '—';
    if (note.indexOf('stripe:') === 0) return 'Stripe';
    if (note.indexOf('paypal:') === 0) return 'PayPal';
    if (note.indexOf('points:') === 0) return 'Points (no charge)';
    return note;
  };
  var rows = data.claims.map(function (c) {
    var details = [];
    if (c.exam_date) details.push('Exam: ' + c.exam_date);
    if (c.confirmation_note) details.push('Conf: ' + c.confirmation_note);
    if (c.notes) details.push(c.notes);
    var actions;
    if (c.status === 'pending') {
      actions =
        '<input type="text" class="refund-admin-notes-input" data-claim-id="' + c.id + '" placeholder="admin notes (optional)">' +
        '<button class="btn btn-approve" data-act="review-refund-claim" data-claim-id="' + c.id + '" data-status="approved">Approve</button>' +
        '<button class="btn btn-deny" data-act="review-refund-claim" data-claim-id="' + c.id + '" data-status="denied">Deny</button>';
    } else if (c.status === 'approved') {
      actions =
        '<input type="text" class="refund-admin-notes-input" data-claim-id="' + c.id + '" placeholder="admin notes (optional)">' +
        '<button class="btn btn-primary" data-act="review-refund-claim" data-claim-id="' + c.id + '" data-status="refunded">Mark Refunded</button>';
    } else {
      actions = c.reviewed_by ? ('Reviewed by ' + c.reviewed_by) : '—';
    }
    return '<tr><td>' + c.code + '</td><td>' + c.email + '</td><td>' + (claimTypeLabel[c.claim_type] || c.claim_type) + '</td>' +
      '<td>$' + (c.refund_cents / 100).toFixed(2) + '</td>' +
      '<td>' + processorLabel(c.code_note) + '</td>' +
      '<td><span class="badge ' + (statusBadgeClass[c.status] || '') + '">' + c.status + '</span></td>' +
      '<td>' + (details.join('<br>') || '—') + '</td>' +
      '<td>' + new Date(c.created_at * 1000).toLocaleDateString() + '</td>' +
      '<td class="refund-actions-cell">' + actions + '</td></tr>';
  }).join('');
  var empty = data.claims.length ? '' : '<p class="muted">No refund claims yet.</p>';

  appEl.innerHTML = renderTabs('refunds') +
    '<p class="muted page-intro-text">Approve or deny each claim after review, then process the actual refund with the ' +
    'processor shown below and mark it Refunded here. Marking a 7-Day claim Refunded automatically revokes the code.</p>' +
    empty +
    (data.claims.length
      ? '<table><thead><tr><th>Code</th><th>Email</th><th>Type</th><th>Amount</th><th>Processor</th><th>Status</th><th>Details</th><th>Created</th><th>Actions</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>'
      : '');
}

// ---- Stalled buyers (re-engagement) ------------------------------------
// Admin-triggered, one at a time -- no automation/cron here on purpose, so a bad threshold or a
// bug can't blast emails unsupervised. See handleConsoleStalledBuyerRemind in the Worker.

var stalledBuyersDays = 7;
var stalledBuyersCache = [];
var stalledBuyerSendingIds = {}; // userId -> true while a send is in-flight, disables that row's button

async function loadStalledBuyers() {
  var container = document.getElementById('stalled-buyers-table-container');
  if (container) container.innerHTML = '<p class="muted">Loading…</p>';
  var data = await apiFetch('/console/stalled-buyers?days=' + encodeURIComponent(stalledBuyersDays));
  stalledBuyersCache = data.items;
  drawStalledBuyersTable();
}

function drawStalledBuyersTable() {
  var container = document.getElementById('stalled-buyers-table-container');
  if (!container) return;
  var rows = stalledBuyersCache.map(function (u) {
    var lastSeen = new Date(u.last_seen_at * 1000).toLocaleDateString();
    var lastReminded = u.last_reminder_sent_at ? new Date(u.last_reminder_sent_at * 1000).toLocaleDateString() : '—';
    var sending = stalledBuyerSendingIds[u.user_id];
    var actionCell = !u.buyer_email
      ? '<span class="muted">No email on file</span>'
      : '<button class="btn-secondary btn-sm" type="button" data-act="send-stalled-reminder" data-user-id="' + u.user_id + '"' +
        (sending ? ' disabled' : '') + '>' + (sending ? 'Sending…' : 'Send reminder') + '</button>';
    return '<tr><td>' + (u.buyer_email || '—') + '</td><td>' + u.code + '</td><td class="muted">' + u.exam_type + '</td>' +
      '<td>' + lastSeen + '</td><td class="muted">' + lastReminded + '</td><td>' + actionCell + '</td></tr>';
  }).join('');
  var empty = stalledBuyersCache.length ? '' : '<p class="muted">No stalled buyers at this threshold.</p>';
  container.innerHTML = empty + (stalledBuyersCache.length
    ? '<table><thead><tr><th>Email</th><th>Code</th><th>Exam</th><th>Last active</th><th>Last reminded</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>'
    : '');
}

async function renderStalledBuyers() {
  appEl.innerHTML = renderTabs('stalled') +
    '<p class="muted page-intro-text">Buyers who redeemed a code but haven\'t been active in a while. Sending is manual, ' +
    'per user, one click at a time -- nothing here goes out automatically.</p>' +
    '<div class="card generate-form">' +
    '<label class="muted">Inactive for at least</label>' +
    '<input type="number" id="stalled-days-input" class="stalled-days-input" value="' + stalledBuyersDays + '" min="1">' +
    '<span class="muted">days</span>' +
    '<button class="btn-secondary btn-sm" type="button" data-act="refresh-stalled-buyers">Refresh</button>' +
    '</div>' +
    '<div id="stalled-buyers-table-container"><p class="muted">Loading…</p></div>';
  await loadStalledBuyers();
}

// ---- Routing + delegated events --------------------------------------

function route() {
  var view = (location.hash || '#/codes').replace('#/', '');
  if (view === 'codes') renderCodes();
  else if (view === 'questions') renderQuestions();
  else if (view === 'stats') renderStats();
  else if (view === 'points') renderPoints();
  else if (view === 'settings') renderSettings();
  else if (view === 'refunds') renderRefunds();
  else if (view === 'stalled') renderStalledBuyers();
  else if (view === 'promotions') renderPromotions();
  else renderCodes();
}
window.addEventListener('hashchange', route);

appEl.addEventListener('submit', async function (e) {
  var act = e.target.getAttribute && e.target.getAttribute('data-act');
  if (act === 'generate-code') {
    e.preventDefault();
    var f = e.target;
    await apiFetch('/console/codes/generate', {
      method: 'POST',
      body: {
        examType: f.examType.value,
        note: f.note.value || undefined,
        expiresInDays: f.expiresInDays.value ? Number(f.expiresInDays.value) : undefined,
      },
    });
    renderCodes();
  } else if (act === 'adjust-points') {
    e.preventDefault();
    var af = e.target;
    var delta = Number(af.delta.value);
    if (!delta || isNaN(delta)) { alert('Enter a non-zero points amount (positive or negative).'); return; }
    try {
      await apiFetch('/console/accounts/adjust-points', {
        method: 'POST',
        body: { email: af.accountEmail.value.trim(), delta: delta, reason: af.reason.value.trim() },
      });
      renderPoints();
    } catch (err) {
      alert(err.data && err.data.error === 'account_not_found'
        ? 'No account found for that email — they may not have referred anyone yet.'
        : 'Could not adjust points. Try again.');
    }
  } else if (act === 'save-promotion') {
    e.preventDefault();
    var pf = e.target;
    var promoCode = pf.promoCode.value.trim();
    var discountType = pf.discountType.value;
    var rawDiscountValue = parseFloat(pf.discountValue.value);
    var body = {
      title: pf.title.value.trim(),
      body: pf.body.value.trim(),
      ctaLabel: pf.ctaLabel.value.trim() || undefined,
      ctaUrl: pf.ctaUrl.value.trim() || undefined,
      placement: pf.placement.value,
      promoCode: promoCode || undefined,
      discountType: discountType,
      // Flat amounts are entered in dollars for admin convenience -- stored in cents like every
      // other price in this app. No longer gated on a code being present -- a discount can now
      // auto-apply from a matching email alone (see requiredEmailDomain).
      discountValue: rawDiscountValue > 0 ? (discountType === 'flat_cents' ? Math.round(rawDiscountValue * 100) : Math.round(rawDiscountValue)) : undefined,
      requiredEmailDomain: pf.requiredEmailDomain.value.trim() || undefined,
      requireEmailVerification: pf.requireEmailVerification.checked,
      pointsMultiplier: pf.pointsMultiplier.value ? parseInt(pf.pointsMultiplier.value, 10) : undefined,
      pointsMultiplierDays: pf.pointsMultiplierDays.value ? parseInt(pf.pointsMultiplierDays.value, 10) : undefined,
      active: pf.active.checked,
    };
    var id = pf.getAttribute('data-id');
    await apiFetch(id ? '/console/promotions/update' : '/console/promotions/create', {
      method: 'POST', body: id ? Object.assign({ id: id }, body) : body,
    });
    promotionFormState = null;
    renderPromotions();
  }
});

appEl.addEventListener('click', async function (e) {
  var el = e.target.closest && e.target.closest('[data-act]');
  if (!el) return;
  // Sub-tab links are real <a href="#"> (for the pill styling), but are handled entirely here --
  // without this, the browser's own navigation to "#" clears location.hash and the global router
  // falls back to the Codes tab, undoing the tab switch this handler just made.
  if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
  var act = el.getAttribute('data-act');
  if (act === 'revoke-code') {
    await apiFetch('/console/codes/revoke', { method: 'POST', body: { code: el.getAttribute('data-code') } });
    renderCodes();
  } else if (act === 'add-promotion') {
    promotionFormState = 'new';
    drawPromotions();
  } else if (act === 'edit-promotion') {
    var editId = el.getAttribute('data-id');
    promotionFormState = promotionsCache.filter(function (p) { return p.id === editId; })[0] || 'new';
    drawPromotions();
  } else if (act === 'cancel-promotion-form') {
    promotionFormState = null;
    drawPromotions();
  } else if (act === 'delete-promotion') {
    await apiFetch('/console/promotions/delete', { method: 'POST', body: { id: el.getAttribute('data-id') } });
    renderPromotions();
  } else if (act === 'toggle-promotion-active') {
    await apiFetch('/console/promotions/toggle', {
      method: 'POST', body: { id: el.getAttribute('data-id'), active: el.getAttribute('data-active') === '1' },
    });
    renderPromotions();
  } else if (act === 'reorder-promotion') {
    await apiFetch('/console/promotions/reorder', {
      method: 'POST', body: { id: el.getAttribute('data-id'), direction: el.getAttribute('data-direction') },
    });
    renderPromotions();
  } else if (act === 'review-refund-claim') {
    var claimId = el.getAttribute('data-claim-id');
    var reviewStatus = el.getAttribute('data-status');
    var notesInput = document.querySelector('.refund-admin-notes-input[data-claim-id="' + claimId + '"]');
    await apiFetch('/console/refund-claims/review', {
      method: 'POST',
      body: { claimId: claimId, status: reviewStatus, adminNotes: notesInput ? notesInput.value.trim() || undefined : undefined },
    });
    renderRefunds();
  } else if (act === 'delete-question') {
    await apiFetch('/console/questions/delete', { method: 'POST', body: { id: el.getAttribute('data-id') } });
    renderQuestions();
  } else if (act === 'import-questions') {
    document.getElementById('import-file').click();
  } else if (act === 'select-exam-tab') {
    currentQuestionsExamType = el.getAttribute('data-exam');
    currentQuestionsTopic = null; // topics differ per exam, so reset the topic filter
    renderQuestions();
  } else if (act === 'select-topic-tab') {
    currentQuestionsTopic = el.getAttribute('data-topic') || null;
    drawQuestionsTable();
  } else if (act === 'refresh-stalled-buyers') {
    var daysInput = document.getElementById('stalled-days-input');
    var daysVal = daysInput ? parseInt(daysInput.value, 10) : NaN;
    stalledBuyersDays = Number.isFinite(daysVal) && daysVal > 0 ? daysVal : stalledBuyersDays;
    await loadStalledBuyers();
  } else if (act === 'send-stalled-reminder') {
    var remindUserId = el.getAttribute('data-user-id');
    stalledBuyerSendingIds[remindUserId] = true;
    drawStalledBuyersTable();
    try {
      await apiFetch('/console/stalled-buyers/remind', { method: 'POST', body: { userId: remindUserId } });
      delete stalledBuyerSendingIds[remindUserId];
      await loadStalledBuyers(); // refreshes "Last reminded" and re-applies the threshold filter
    } catch (err) {
      delete stalledBuyerSendingIds[remindUserId];
      drawStalledBuyersTable();
      alert('Could not send reminder: ' + (err.data && err.data.error ? err.data.error : 'unknown error'));
    }
  } else if (act === 'save-price') {
    var examType = el.getAttribute('data-exam');
    var input = document.querySelector('.price-input[data-exam="' + examType + '"]');
    var dollars = parseFloat(input.value);
    if (isNaN(dollars) || dollars < 0) { alert('Enter a valid price.'); return; }
    await apiFetch('/console/pricing', { method: 'POST', body: { examType: examType, priceCents: Math.round(dollars * 100) } });
    renderSettings();
  } else if (act === 'save-point-rule') {
    var taskKey = el.getAttribute('data-task');
    var label = el.getAttribute('data-label');
    var pointsInput = document.querySelector('.rule-points-input[data-task="' + taskKey + '"]');
    var activeInput = document.querySelector('.rule-active-input[data-task="' + taskKey + '"]');
    var pointsVal = parseInt(pointsInput.value, 10);
    if (isNaN(pointsVal) || pointsVal < 0) { alert('Enter a valid points value.'); return; }
    await apiFetch('/console/point-rules', {
      method: 'POST',
      body: { taskKey: taskKey, label: label, points: pointsVal, active: activeInput.checked },
    });
    renderSettings();
  } else if (act === 'save-min-charge') {
    var minChargeInput = document.querySelector('.min-charge-input');
    var minChargeDollarsVal = parseFloat(minChargeInput.value);
    if (isNaN(minChargeDollarsVal) || minChargeDollarsVal < 0) { alert('Enter a valid amount.'); return; }
    await apiFetch('/console/settings', {
      method: 'POST',
      body: { key: 'min_paypal_charge_cents', value: String(Math.round(minChargeDollarsVal * 100)) },
    });
    renderSettings();
  } else if (act === 'save-alert-email') {
    var alertEmailInput = document.querySelector('.alert-email-input');
    var alertEmailVal = alertEmailInput.value.trim();
    await apiFetch('/console/settings', {
      method: 'POST',
      body: { key: 'admin_alert_email', value: alertEmailVal },
    });
    renderSettings();
  } else if (act === 'save-accuracy-pass-pct') {
    var accuracyPassPctInput = document.querySelector('.accuracy-pass-pct-input');
    var accuracyPassPctVal = parseInt(accuracyPassPctInput.value, 10);
    if (!Number.isFinite(accuracyPassPctVal) || accuracyPassPctVal < 0 || accuracyPassPctVal > 100) { alert('Enter a value between 0 and 100.'); return; }
    await apiFetch('/console/settings', {
      method: 'POST',
      body: { key: 'progress_accuracy_pass_pct', value: String(accuracyPassPctVal) },
    });
    renderSettings();
  } else if (act === 'save-coverage-pass-pct') {
    var coveragePassPctInput = document.querySelector('.coverage-pass-pct-input');
    var coveragePassPctVal = parseInt(coveragePassPctInput.value, 10);
    if (!Number.isFinite(coveragePassPctVal) || coveragePassPctVal < 0 || coveragePassPctVal > 100) { alert('Enter a value between 0 and 100.'); return; }
    await apiFetch('/console/settings', {
      method: 'POST',
      body: { key: 'progress_coverage_pass_pct', value: String(coveragePassPctVal) },
    });
    renderSettings();
  } else if (act === 'sort-accounts') {
    var accountsSortKey = el.getAttribute('data-key');
    if (accountsSort.key === accountsSortKey) accountsSort.dir *= -1;
    else { accountsSort.key = accountsSortKey; accountsSort.dir = 1; }
    drawAccountsTable();
  } else if (act === 'sort-referrals') {
    var referralsSortKey = el.getAttribute('data-key');
    if (referralsSort.key === referralsSortKey) referralsSort.dir *= -1;
    else { referralsSort.key = referralsSortKey; referralsSort.dir = 1; }
    drawReferralsTable();
  } else if (act === 'sort-accuracy') {
    var accTrack = el.getAttribute('data-track');
    var accuracySortKey = el.getAttribute('data-key');
    var accSort = accuracySortByTrack[accTrack] || (accuracySortByTrack[accTrack] = { key: 'topic', dir: 1 });
    if (accSort.key === accuracySortKey) accSort.dir *= -1;
    else { accSort.key = accuracySortKey; accSort.dir = 1; }
    var accGroup = groupAccuracyByTrack(statsAccuracyCache).filter(function (t) { return t.examType === accTrack; })[0];
    var accContainer = document.getElementById('accuracy-track-table-' + accTrack);
    if (accContainer && accGroup) accContainer.innerHTML = accuracyTrackTableHtml(accGroup);
  } else if (act === 'toggle-accuracy-topics') {
    var toggleTrack = el.getAttribute('data-track');
    accuracyExpandedByTrack[toggleTrack] = !accuracyExpandedByTrack[toggleTrack];
    var toggleGroup = groupAccuracyByTrack(statsAccuracyCache).filter(function (t) { return t.examType === toggleTrack; })[0];
    var toggleContainer = document.getElementById('accuracy-track-table-' + toggleTrack);
    if (toggleContainer && toggleGroup) toggleContainer.innerHTML = accuracyTrackTableHtml(toggleGroup);
  } else if (act === 'sort-quiz-progress-topics') {
    var qpUserId = el.getAttribute('data-user-id');
    var qpKey = el.getAttribute('data-key');
    var qpSort = quizProgressTopicSort[qpUserId] || (quizProgressTopicSort[qpUserId] = { key: 'topic', dir: 1 });
    if (qpSort.key === qpKey) qpSort.dir *= -1;
    else { qpSort.key = qpKey; qpSort.dir = 1; }
    var qpContainer = document.getElementById('quiz-progress-table-' + qpUserId);
    var qpGroup = quizProgressGroupsCache.filter(function (g) { return g.userId === qpUserId; })[0];
    if (qpContainer && qpGroup) qpContainer.innerHTML = quizProgressTableHtml(qpGroup);
  } else if (act === 'sort-leaderboard') {
    var lbTrack = el.getAttribute('data-track');
    leaderboardSortKeyByTrack[lbTrack] = el.getAttribute('data-key');
    var lbContainer = document.getElementById('leaderboard-table-' + lbTrack);
    var lbGroup = groupLeaderboardByTrack(quizProgressGroupsCache).filter(function (t) { return t.examType === lbTrack; })[0];
    if (lbContainer && lbGroup) lbContainer.innerHTML = leaderboardTrackTableHtml(lbGroup);
  } else if (act === 'toggle-theme') {
    var nextTheme = el.getAttribute('data-next');
    var local = loadLocalPrefs();
    saveLocalPrefs(nextTheme, local.fontScale);
    applyTheme(nextTheme, local.fontScale);
    route();
  } else if (act === 'font-up' || act === 'font-down') {
    var l = loadLocalPrefs();
    var next = Math.max(0.85, Math.min(1.4, l.fontScale + (act === 'font-up' ? 0.05 : -0.05)));
    saveLocalPrefs(l.theme, next);
    applyTheme(l.theme, next);
  }
});

document.addEventListener('change', async function (e) {
  if (e.target.id === 'import-file' && e.target.files[0]) {
    var text = await e.target.files[0].text();
    var questions = JSON.parse(text);
    var result = await apiFetch('/console/questions/import', { method: 'POST', body: { questions: questions } });
    alert('Imported ' + result.imported + ' questions.');
    renderQuestions();
  }
});

(function boot() {
  var local = loadLocalPrefs();
  applyTheme(local.theme, local.fontScale);
  route();
})();
