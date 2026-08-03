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
function applyTheme(theme, fontScale) {
  var root = document.documentElement;
  if (theme && theme !== 'system') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  if (fontScale) root.style.setProperty('--font-scale', fontScale);
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

function renderTabs(active) {
  var tabs = [['settings', 'Settings'], ['points', 'Points'], ['codes', 'Codes'], ['refunds', 'Refund Claims'], ['questions', 'Question Bank'], ['stats', 'Stats']];
  return renderTopControls() + '<nav class="tabs">' + tabs.map(function (t) {
    return '<a href="#/' + t[0] + '"' + (active === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</a>';
  }).join('') + '</nav>';
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
    return '<details class="exam-attempt-detail" data-attempt-id="' + a.attemptId + '">' +
      '<summary>' + new Date(a.submittedAt * 1000).toLocaleString() + ' — ' + a.correct + ' / ' + a.total +
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
function groupQuizProgressByUser(items) {
  var byUser = {}, order = [];
  items.forEach(function (r) {
    if (!byUser[r.user_id]) {
      byUser[r.user_id] = { userId: r.user_id, code: r.code, buyerEmail: r.buyer_email, examType: r.exam_type, topics: [], total: 0, correct: 0 };
      order.push(r.user_id);
    }
    var u = byUser[r.user_id];
    u.topics.push({ topic: r.topic, total: r.total, correct: r.correct });
    u.total += r.total;
    u.correct += r.correct;
  });
  var grouped = order.map(function (id) { return byUser[id]; });
  grouped.sort(function (a, b) { return b.total - a.total; });
  return grouped;
}

function topicPctOf(t) { return t.total ? Math.round((100 * t.correct) / t.total) : 0; }

var QUIZ_PROGRESS_TOPIC_COLUMNS = [['topic', 'Topic'], ['pct', 'Accuracy'], ['total', 'Questions']];
var quizProgressGroupsCache = []; // userId -> group, so a per-user sort click can redraw without refetching
var quizProgressTopicSort = {}; // userId -> { key, dir }, independent sort state per user's table

function quizProgressTableHtml(u) {
  var sort = quizProgressTopicSort[u.userId] || (quizProgressTopicSort[u.userId] = { key: 'topic', dir: 1 });
  var rows = u.topics.slice().sort(function (a, b) {
    var av = sort.key === 'topic' ? a.topic.toLowerCase() : sort.key === 'pct' ? topicPctOf(a) : a.total;
    var bv = sort.key === 'topic' ? b.topic.toLowerCase() : sort.key === 'pct' ? topicPctOf(b) : b.total;
    if (av < bv) return -1 * sort.dir;
    if (av > bv) return 1 * sort.dir;
    return 0;
  }).map(function (t) {
    return '<tr><td>' + t.topic + '</td><td>' + topicPctOf(t) + '%</td><td>' + t.total + '</td></tr>';
  }).join('');
  var headerCells = QUIZ_PROGRESS_TOPIC_COLUMNS.map(function (c) {
    var indicator = sort.key === c[0] ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<th data-act="sort-quiz-progress-topics" data-user-id="' + u.userId + '" data-key="' + c[0] + '">' + c[1] + indicator + '</th>';
  }).join('');
  return '<table class="admin-user-table"><thead><tr>' + headerCells + '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function renderQuizProgressUserGroup(u) {
  var who = u.buyerEmail || u.code || 'Unknown user';
  var whoSub = u.buyerEmail && u.code ? ' <span class="muted">(' + u.code + ')</span>' : '';
  var pct = u.total ? Math.round((100 * u.correct) / u.total) : 0;

  return '<details class="card admin-user-group">' +
    '<summary><strong>' + who + '</strong>' + whoSub + ' — ' + u.examType + ' — ' + u.total +
    ' answered, ' + pct + '% accuracy</summary>' +
    '<div id="quiz-progress-table-' + u.userId + '">' + quizProgressTableHtml(u) + '</div>' +
    '</details>';
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

var ACCURACY_NUMERIC_KEYS = new Set(['pct', 'attempts']);
var ACCURACY_COLUMNS = [['exam_type', 'Exam'], ['topic', 'Topic'], ['pct', '% correct'], ['attempts', 'Attempts']];
var statsAccuracyCache = [];
var accuracySort = { key: 'exam_type', dir: 1 }; // matches the old default: API order, grouped by exam
var ACCURACY_COLLAPSED_COUNT = 8;
var accuracyExpanded = false;

function drawAccuracyTable() {
  var container = document.getElementById('accuracy-table-container');
  if (!container) return;
  var rows = sortTableRows(statsAccuracyCache, accuracySort, ACCURACY_NUMERIC_KEYS);
  var truncated = !accuracyExpanded && rows.length > ACCURACY_COLLAPSED_COUNT;
  var visible = truncated ? rows.slice(0, ACCURACY_COLLAPSED_COUNT) : rows;
  var body = visible.map(function (a) {
    return '<tr><td>' + a.exam_type + '</td><td>' + a.topic + '</td><td>' + a.pct + '%</td><td>' + a.attempts + '</td></tr>';
  }).join('');
  var toggleHtml = rows.length > ACCURACY_COLLAPSED_COUNT
    ? '<button class="btn-secondary btn-sm" type="button" data-act="toggle-accuracy-topics">' +
      (truncated ? 'Show all ' + rows.length + ' ▾' : 'Show fewer ▴') + '</button>'
    : '';
  container.innerHTML = '<table><thead>' + sortableHeaderRow(ACCURACY_COLUMNS, accuracySort, 'sort-accuracy') +
    '</thead><tbody>' + body + '</tbody></table>' + toggleHtml;
}

async function renderStats() {
  appEl.innerHTML = renderTabs('stats') + '<p>Loading…</p>';
  var results = await Promise.all([
    apiFetch('/console/stats'), apiFetch('/console/resource-progress'), apiFetch('/console/exam-attempts'), apiFetch('/console/quiz-progress'),
  ]);
  var s = results[0], resourceProgress = results[1], examAttempts = results[2], quizProgress = results[3];
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
  quizProgressGroupsCache = groupQuizProgressByUser(quizProgress.items);
  var quizUsersHtml = quizProgressGroupsCache.map(renderQuizProgressUserGroup).join('');
  var quizEmpty = quizProgress.items.length ? '' : '<p class="muted">No quiz activity yet.</p>';

  appEl.innerHTML = renderTabs('stats') +
    '<div class="card"><strong>' + s.totalUsers + '</strong> total users</div>' +
    '<div class="stats-grid stats-grid-quarter-half-quarter">' +
    '<div class="stats-column"><h3>Codes by status</h3><table><thead><tr><th>Exam</th><th>Status</th><th>Count</th></tr></thead><tbody>' + codeRows + '</tbody></table></div>' +
    '<div class="stats-column"><h3>Accuracy by topic</h3><div id="accuracy-table-container"></div></div>' +
    '<div class="stats-column"><h3>Resource consumption</h3>' + resourceEmpty + resourceUsersHtml + '</div>' +
    '</div>' +
    '<h3 class="stats-section-heading">User quiz progress</h3>' +
    '<p class="muted page-intro-text">Practice-quiz accuracy per user, broken down by topic — the same data each user sees on their own Progress tab.</p>' +
    quizEmpty + quizUsersHtml +
    '<h3 class="stats-section-heading">Mock exam attempts</h3>' +
    '<p class="muted page-intro-text">Grouped by user, most recently active first. Expand a user to see each attempt; ' +
    'expand an attempt for the full question-by-question review. Capped at the 1000 most recent attempts.</p>' +
    examEmpty + examUsersHtml;
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

// ---- Routing + delegated events --------------------------------------

function route() {
  var view = (location.hash || '#/codes').replace('#/', '');
  if (view === 'codes') renderCodes();
  else if (view === 'questions') renderQuestions();
  else if (view === 'stats') renderStats();
  else if (view === 'points') renderPoints();
  else if (view === 'settings') renderSettings();
  else if (view === 'refunds') renderRefunds();
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
    var accuracySortKey = el.getAttribute('data-key');
    if (accuracySort.key === accuracySortKey) accuracySort.dir *= -1;
    else { accuracySort.key = accuracySortKey; accuracySort.dir = 1; }
    drawAccuracyTable();
  } else if (act === 'toggle-accuracy-topics') {
    accuracyExpanded = !accuracyExpanded;
    drawAccuracyTable();
  } else if (act === 'sort-quiz-progress-topics') {
    var qpUserId = el.getAttribute('data-user-id');
    var qpKey = el.getAttribute('data-key');
    var qpSort = quizProgressTopicSort[qpUserId] || (quizProgressTopicSort[qpUserId] = { key: 'topic', dir: 1 });
    if (qpSort.key === qpKey) qpSort.dir *= -1;
    else { qpSort.key = qpKey; qpSort.dir = 1; }
    var qpContainer = document.getElementById('quiz-progress-table-' + qpUserId);
    var qpGroup = quizProgressGroupsCache.filter(function (g) { return g.userId === qpUserId; })[0];
    if (qpContainer && qpGroup) qpContainer.innerHTML = quizProgressTableHtml(qpGroup);
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
