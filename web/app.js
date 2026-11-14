// 前端主逻辑：直接复用 /src 下的同一套引擎，保证页面与测试行为一致
import { auditStudent, normalizeDataset, mergeDataset, validateDataset } from '/src/index.js';
import { runPrerequisiteChecks, buildExportBundle, toCSV } from '/src/export.js';
import { checkPrerequisiteGraph } from '/src/prerequisites.js';

const state = {
  dataset: null,           // normalizeDataset 后的统一数据集
  selectedStudentId: null,
  trial: new Map(),        // courseId -> {term, score}
  prereqCheck: null,
  auditCache: null,        // 当前学生基线审计
  trialAudit: null,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
// 单引号属性内安全嵌入 JSON：只转义 & 与单引号，JSON 本身的双引号保持原样
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;');

// ---------- 数据载入 ----------
async function loadSample(issuePrereq = false) {
  const keys = ['catalog', 'programs', 'equivalences', 'students'];
  const docs = {};
  for (const k of keys) {
    docs[k] = await fetch(`/api/sample/${k}`).then((r) => r.json());
  }
  docs.prerequisites = await fetch(
    `/api/sample/${issuePrereq ? 'prerequisites-issue' : 'prerequisites'}`,
  ).then((r) => r.json());

  state.dataset = normalizeDataset(docs);
  state.selectedStudentId = null;
  state.trial.clear();
  postLoad(issuePrereq ? '已载入内置样本（问题先修图版）' : '已载入内置样本');
}

function postLoad(message) {
  const validation = validateDataset(state.dataset);
  const msg = $('importMessages');
  msg.hidden = false;
  if (!validation.valid) {
    msg.className = 'messages error';
    msg.innerHTML = `<strong>数据校验发现 ${validation.errors.length} 个问题：</strong><ul>${
      validation.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
  } else {
    msg.className = 'messages ok';
    msg.innerHTML = `<strong>${esc(message)}</strong> · 课程 ${state.dataset.catalog.length} 门，方案 ${state.dataset.programs.length} 个，学生 ${state.dataset.students.length} 名`;
  }

  // 先修图检查：成环 / 缺失优先报
  const catalogMap = new Map(state.dataset.catalog.map((c) => [c.id, c]));
  const graph = checkPrerequisiteGraph(state.dataset.prerequisites || {}, catalogMap);
  state.prereqCheck = graph.ok
    ? runPrerequisiteChecks(state.dataset, [])
    : { graph, timing: [] };

  renderRuleVersions();
  $('mainArea').hidden = false;
  $('exportJsonBtn').disabled = false;
  $('exportCsvBtn').disabled = false;
  renderStudentList();
  if (state.dataset.students.length > 0) selectStudent(state.dataset.students[0].id);
  populateTrialCourses();
}

function renderRuleVersions() {
  const v = state.dataset.versions;
  const el = $('ruleVersions');
  el.hidden = false;
  el.innerHTML = '<strong style="display:block;margin-bottom:4px">使用的规则版本</strong>'
    + Object.entries(v).filter(([k]) => k !== 'exportedAt').map(([k, val]) =>
      `<div class="rv-row"><span>${esc(k)}</span><code>${esc(val)}</code></div>`).join('');
}

// ---------- 导入 ----------
$('fileInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  if (files.length === 0) return;
  try {
    const incoming = {};
    for (const file of files) {
      const json = JSON.parse(await file.text());
      // 自动识别数据域：包装对象按其内容键识别，裸数组按文件名提示
      const text = JSON.stringify(json).slice(0, 40);
      if (Array.isArray(json)) {
        const fname = file.name.toLowerCase();
        if (fname.includes('catalog') || json.some((x) => x.credits !== undefined && x.name)) incoming.catalog = json;
        else if (fname.includes('student')) incoming.students = json;
        else if (fname.includes('program')) incoming.programs = json;
        else if (fname.includes('equiv')) incoming.equivalences = json;
        else throw new Error(`无法识别裸数组文件 ${file.name} 的数据域，请使用带键的包装对象`);
      } else {
        for (const key of ['catalog', 'programs', 'equivalences', 'prerequisites', 'students']) {
          if (json[key] !== undefined) incoming[key] = json[key];
        }
      }
    }
    if (Object.keys(incoming).length === 0) throw new Error('文件中未识别到任何已知数据域');
    state.dataset = state.dataset
      ? mergeDataset(state.dataset, incoming)
      : normalizeDataset(incoming);
    state.trial.clear();
    postLoad(`已导入 ${files.map((f) => f.name).join('、')}`);
  } catch (err) {
    const msg = $('importMessages');
    msg.hidden = false;
    msg.className = 'messages error';
    msg.textContent = `导入失败：${err.message}`;
  } finally {
    e.target.value = '';
  }
});

$('loadSampleBtn').addEventListener('click', () => loadSample(false));
$('loadIssueBtn').addEventListener('click', () => loadSample(true));
$('clearBtn').addEventListener('click', () => {
  state.dataset = null;
  state.selectedStudentId = null;
  state.trial.clear();
  $('mainArea').hidden = true;
  $('ruleVersions').hidden = true;
  $('importMessages').hidden = true;
  $('exportJsonBtn').disabled = true;
  $('exportCsvBtn').disabled = true;
});

// ---------- 学生列表 ----------
function renderStudentList() {
  const keyword = $('studentSearch').value.trim().toLowerCase();
  const list = $('studentList');
  const items = state.dataset.students
    .filter((s) => !keyword || s.id.toLowerCase().includes(keyword) || s.name.toLowerCase().includes(keyword));
  list.innerHTML = items.map((s) => {
    const r = auditStudent(s, state.dataset);
    const done = r.totals.earned >= r.program.totalCredits
      && r.requiredRows.every((x) => x.satisfied)
      && r.electiveRows.every((x) => x.satisfied);
    return `<li data-id="${esc(s.id)}" class="${s.id === state.selectedStudentId ? 'active' : ''}">
      <div class="sid">${esc(s.id)} ${esc(s.name)}
        <span class="pill ${done ? 'ok' : 'bad'}">${done ? '达标' : '有缺口'}</span>
      </div>
      <div class="meta">${s.enrollYear} 级 · ${esc(r.program.version)} · ${r.totals.earned}/${r.program.totalCredits} 学分</div>
    </li>`;
  }).join('') || '<li class="empty">无匹配学生</li>';
  list.querySelectorAll('li[data-id]').forEach((li) => {
    li.addEventListener('click', () => selectStudent(li.dataset.id));
  });
}
$('studentSearch').addEventListener('input', renderStudentList);

function selectStudent(id) {
  state.selectedStudentId = id;
  state.trial.clear();
  renderStudentList();
  renderAudit();
}

function currentStudent() {
  return state.dataset.students.find((s) => s.id === state.selectedStudentId);
}

// ---------- 审计渲染 ----------
function renderAudit() {
  const student = currentStudent();
  if (!student) return;
  const trialObj = state.trial.size === 0 ? null : Object.fromEntries(state.trial);
  state.auditCache = auditStudent(student, state.dataset);
  state.trialAudit = trialObj ? auditStudent(student, state.dataset, trialObj) : null;
  const r = state.trialAudit || state.auditCache;

  renderHeader(r);
  renderCards(r);
  renderIssues(student, r);
  renderRequired(r);
  renderElectives(r);
  renderTotals(r);
  renderTrial(student);
}

function renderHeader(r) {
  $('studentHeader').innerHTML = `
    <h2>${esc(r.studentName)} <span class="mono">${esc(r.studentId)}</span>
      ${r.isTrial ? '<span class="pill warn">试选视图</span>' : ''}</h2>
    <div class="prog-meta">
      ${r.enrollYear} 级 · ${esc(r.program.name)} ${esc(r.program.version)}
      · 重修规则：${esc(r.policies.retake.note || r.policies.retake.scoreRule)}
      · 补考规则：${esc(r.policies.makeup.note || `封顶 ${r.policies.makeup.cap}`)}
    </div>`;
}

function renderCards(r) {
  const pct = Math.min(100, Math.round((r.totals.earned / r.program.totalCredits) * 100));
  const reqFail = r.requiredRows.filter((x) => !x.satisfied).length;
  const elecFail = r.electiveRows.filter((x) => !x.satisfied).length;
  $('summaryCards').innerHTML = `
    <div class="card">
      <div class="label">总学分完成</div>
      <div class="value ${r.totals.deficit > 0 ? 'bad' : 'ok'}">${r.totals.earned} / ${r.program.totalCredits}</div>
      <div class="progress"><span style="width:${pct}%"></span></div>
    </div>
    <div class="card">
      <div class="label">必修缺口</div>
      <div class="value ${reqFail ? 'bad' : 'ok'}">${reqFail} 门</div>
    </div>
    <div class="card">
      <div class="label">选修组缺口</div>
      <div class="value ${elecFail ? 'bad' : 'ok'}">${elecFail} 组</div>
    </div>
    <div class="card">
      <div class="label">方案外/未知课程</div>
      <div class="value ${r.totals.outOfUniverse.length + r.totals.unknownCourses.length ? 'warn' : 'ok'}">
        ${r.totals.outOfUniverse.length + r.totals.unknownCourses.length} 门
      </div>
    </div>`;
}

function renderIssues(student, r) {
  const parts = [];
  const graph = state.prereqCheck?.graph;
  if (graph && !graph.ok) {
    if (graph.cycles.length) {
      parts.push(`<div class="issue-item"><strong>先修成环：</strong>${
        graph.cycles.map((c) => esc(c.join(' → '))).join('；')}</div>`);
    }
    if (graph.missingCourses.length) {
      parts.push(`<div class="issue-item"><strong>课程信息缺失：</strong>${
        graph.missingCourses.map((c) => `<code>${esc(c)}</code>`).join('、')}</div>`);
    }
    parts.push('<div class="issue-item warn">先修图不健康，已跳过修读时序检查</div>');
  } else if (state.prereqCheck?.timing) {
    const mine = state.prereqCheck.timing.filter((v) => v.studentId === student.id);
    for (const v of mine) {
      parts.push(`<div class="issue-item warn"><strong>先修时序违规：</strong>${esc(v.reason)}</div>`);
    }
  }
  for (const iss of r.issues) {
    parts.push(`<div class="issue-item warn">${esc(iss.message)}</div>`);
  }
  for (const cid of r.totals.unknownCourses) {
    parts.push(`<div class="issue-item"><strong>课程信息缺失：</strong>成绩中的 <code>${esc(cid)}</code> 不在课程库，无法计入任何要求</div>`);
  }
  for (const rej of r.rejectedEquivalences) {
    parts.push(`<div class="issue-item warn"><strong>等价关系不适用：</strong>${esc(rej.reason)}</div>`);
  }
  $('issuePanel').innerHTML = parts.join('') || '<div class="empty">未发现数据问题或先修违规</div>';
}

function courseName(id) {
  const c = state.dataset.catalog.find((x) => x.id === id);
  return c ? `${c.id} ${c.name}` : id;
}

function renderRequired(r) {
  const rows = r.requiredRows.map((row) => {
    if (row.satisfied) {
      return `<tr>
        <td>${esc(courseName(row.requirementCourse))}</td>
        <td><span class="status-ok">已满足</span></td>
        <td>${esc(courseName(row.matchedCourse))}
          ${row.via === 'equivalence' ? `<span class="tag eq">等价 ${esc(row.equivalenceId)}</span>` : '<span class="tag">直修</span>'}
        </td>
        <td class="mono">—</td>
      </tr>`;
    }
    return `<tr class="gap-row" data-gap='${escAttr(JSON.stringify({ title: courseName(row.requirementCourse), reasons: row.reasons }))}'>
      <td>${esc(courseName(row.requirementCourse))}</td>
      <td><span class="status-bad">缺口</span></td>
      <td>—</td>
      <td class="mono">点击查看原因 →</td>
    </tr>`;
  }).join('');
  $('requiredTable').innerHTML = `<table>
    <thead><tr><th>要求课程</th><th>状态</th><th>抵扣课程 / 依据</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;
  bindGapRows();
}

function renderElectives(r) {
  $('electivePanel').innerHTML = r.electiveRows.map((g) => {
    const head = `<div class="group-block ${g.satisfied ? '' : 'fail'}">
      <div class="group-head">
        <span class="title">${esc(g.groupId)} · ${esc(g.name)}</span>
        <span class="${g.satisfied ? 'status-ok' : 'status-bad'}">${g.earnedCredits} / ${g.minCredits} 学分 ${g.satisfied ? '✓' : `（缺 ${g.minCredits - g.earnedCredits}）`}</span>
      </div>`;
    const assigned = g.assigned.length
      ? `<ul class="assigned-list">${g.assigned.map((a) =>
        `<li><code>${esc(a.courseId)}</code> ${esc(courseName(a.courseId).replace(a.courseId, '').trim())} · ${a.credits} 学分 — ${esc(a.basis)}</li>`).join('')}</ul>`
      : '<div class="empty">无可用分配</div>';
    const reasons = g.reasons.map((x) => `<div class="reason-line">${esc(x.text)}</div>`).join('');
    const unused = g.unusedInGroup.length
      ? `<div class="unused-note">未计入本组的课程：${g.unusedInGroup.map((u) =>
        `<code>${esc(u.courseId)}</code>（${esc(u.reason)}）`).join('；')}</div>`
      : '';
    return `${head}${assigned}${reasons}${unused}</div>`;
  }).join('');
}

function renderTotals(r) {
  const out = r.totals.outOfUniverse.map((o) =>
    `<div class="reason-line"><code>${esc(o.courseId)}</code> · ${o.credits} 学分 — ${esc(o.reason)}</div>`).join('');
  const extra = r.totals.extraInUniverse.map((c) =>
    `<li><code>${esc(c)}</code> ${esc(courseName(c).replace(c, '').trim())}（域内冗余，学分只计一次）</li>`).join('');
  $('totalsPanel').innerHTML = `
    <p>计入总学分的去重课程（${r.totals.countedCourses.length} 门）：</p>
    <p class="mono">${r.totals.countedCourses.map(esc).join('、')}</p>
    ${extra ? `<p>域内已通过但未被要求消耗：</p><ul>${extra}</ul>` : ''}
    <p><strong>总缺口：<span class="${r.totals.deficit ? 'status-bad' : 'status-ok'}">${r.totals.deficit} 学分</span></strong></p>
    ${out || '<div class="empty">无方案外课程</div>'}`;
}

// ---------- 试选 ----------
function populateTrialCourses() {
  const sel = $('trialCourse');
  sel.innerHTML = state.dataset.catalog
    .map((c) => `<option value="${esc(c.id)}">${esc(c.id)} ${esc(c.name)}（${c.credits}学分）</option>`).join('');
}

$('addTrialBtn').addEventListener('click', () => {
  const courseId = $('trialCourse').value;
  const term = $('trialTerm').value.trim();
  const score = Number($('trialScore').value);
  if (!term) return alert('请填写学期，如 2024-2025-1');
  if (!Number.isFinite(score) || score < 0 || score > 100) return alert('分数需在 0-100');
  state.trial.set(courseId, { term, score });
  renderAudit();
});
$('resetTrialBtn').addEventListener('click', () => { state.trial.clear(); renderAudit(); });

function renderTrial(student) {
  const chips = [...state.trial.entries()].map(([cid, v]) =>
    `<span class="trial-chip"><code>${esc(cid)}</code> ${esc(v.term)} · ${v.score}分
      <button data-remove="${esc(cid)}">×</button></span>`).join('');
  $('trialList').innerHTML = chips || '<span class="empty">尚未添加试选课程</span>';
  $('trialList').querySelectorAll('[data-remove]').forEach((b) => {
    b.addEventListener('click', () => { state.trial.delete(b.dataset.remove); renderAudit(); });
  });

  if (!state.trialAudit) { $('trialDelta').innerHTML = ''; return; }
  const base = state.auditCache;
  const trial = state.trialAudit;
  const delta = trial.totals.earned - base.totals.earned;
  const fixedReq = base.requiredRows.filter((x) => !x.satisfied
    && trial.requiredRows.find((y) => y.requirementCourse === x.requirementCourse)?.satisfied)
    .map((x) => x.requirementCourse);
  const fixedGroup = base.electiveRows.filter((x) => !x.satisfied
    && trial.electiveRows.find((y) => y.groupId === x.groupId)?.satisfied)
    .map((x) => x.name);
  const remainReq = trial.requiredRows.filter((x) => !x.satisfied).map((x) => x.requirementCourse);
  const remainGroup = trial.electiveRows.filter((x) => !x.satisfied).map((x) => `${x.name}（缺${x.minCredits - x.earnedCredits}）`);

  $('trialDelta').innerHTML = `
    <div class="reason-line ${delta >= 0 ? '' : 'badge'}">试选新增学分：<strong>${delta}</strong>（${base.totals.earned} → ${trial.totals.earned}，正式成绩未改动）</div>
    ${fixedReq.length ? `<div class="reason-line">新补上的必修：${fixedReq.map(esc).join('、')}</div>` : ''}
    ${fixedGroup.length ? `<div class="reason-line">新达标的选修组：${fixedGroup.map(esc).join('、')}</div>` : ''}
    <div class="reason-line badge">仍未满足 — 必修：${remainReq.length ? remainReq.map(esc).join('、') : '无'}；选修组：${remainGroup.length ? remainGroup.map(esc).join('、') : '无'}；总学分缺口：${trial.totals.deficit}</div>`;
}

// ---------- 缺口弹窗 ----------
function bindGapRows() {
  document.querySelectorAll('tr.gap-row').forEach((tr) => {
    tr.addEventListener('click', () => {
      const data = JSON.parse(tr.dataset.gap);
      $('gapModalTitle').textContent = `为什么 ${data.title} 没被计入？`;
      $('gapModalBody').innerHTML = data.reasons.length
        ? data.reasons.map((x) => `<div class="reason"><code>${esc(x.code)}</code><br>${esc(x.text)}</div>`).join('')
        : '<div class="empty">无具体原因</div>';
      $('gapModal').hidden = false;
    });
  });
}
$('gapModalClose').addEventListener('click', () => { $('gapModal').hidden = true; });
$('gapModal').addEventListener('click', (e) => { if (e.target.id === 'gapModal') $('gapModal').hidden = true; });

// ---------- 导出 ----------
function allAuditResults() {
  return state.dataset.students.map((s) => auditStudent(s, state.dataset));
}

$('exportJsonBtn').addEventListener('click', () => {
  const results = allAuditResults();
  const pre = state.prereqCheck?.graph?.ok
    ? runPrerequisiteChecks(state.dataset, results)
    : state.prereqCheck;
  const bundle = buildExportBundle(results, state.dataset, pre);
  download('audit-export.json', JSON.stringify(bundle, null, 2), 'application/json');
});

$('exportCsvBtn').addEventListener('click', () => {
  download('audit-export.csv', '﻿' + toCSV(allAuditResults()), 'text/csv');
});

function download(name, content, mime) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// 启动即载入样本，便于直接查看
loadSample(false);
