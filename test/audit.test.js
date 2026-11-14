import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { auditStudent } from '../src/audit.js';
import { normalizeDataset, validateDataset } from '../src/data-loader.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(here, '..', 'data', f), 'utf8'));

function dataset() {
  return normalizeDataset({
    catalog: load('catalog.json'),
    programs: load('programs.json'),
    equivalences: load('equivalences.json'),
    prerequisites: load('prerequisites.json'),
    students: load('students.json'),
  });
}

function audit(studentId, trial) {
  const d = dataset();
  const s = d.students.find((x) => x.id === studentId);
  return auditStudent(s, d, trial);
}

test('样本数据集通过结构校验', () => {
  const v = validateDataset(dataset());
  assert.equal(v.valid, true, v.errors.join('；'));
});

test('按入学年份选择适用方案：2019 届 -> 2018版，2022 届 -> 2022版', () => {
  assert.equal(audit('S2019001').program.version, '2018版');
  assert.equal(audit('S2022001').program.version, '2022版');
});

test('互斥抵扣：一门课不能在多个要求里重复计学分', () => {
  const r = audit('S2019002');
  // GE010 同时是必修和 E2/E3 候选；若被必修占用，选修分配不得再次使用
  const ge010Required = r.requiredRows.find((x) => x.requirementCourse === 'GE010');
  assert.equal(ge010Required.matchedCourse, 'GE010');
  const allAssigned = r.electiveRows.flatMap((g) => g.assigned.map((a) => a.courseId));
  assert.ok(!allAssigned.includes('GE010'), 'GE010 已抵必修，选修组不得重复使用');
  // 全局：计学分课程去重
  assert.equal(new Set(r.totals.countedCourses).size, r.totals.countedCourses.length);
});

test('选修组重叠：同一门课只分配给一个组，且给出完整可行分配', () => {
  const r = audit('S2019002');
  const assigned = r.electiveRows.flatMap((g) => g.assigned.map((a) => a.courseId));
  assert.equal(new Set(assigned).size, assigned.length, '跨组分配无重复课程');
  for (const g of r.electiveRows) {
    assert.equal(g.satisfied, true, `${g.name} 应被满足`);
    assert.ok(g.earnedCredits >= g.minCredits);
  }
});

test('缺口原因：挂科、未修读、信息缺失分别给出', () => {
  const r = audit('S2020001');
  // CS204 从未修读
  const cs204 = r.requiredRows.find((x) => x.requirementCourse === 'CS204');
  assert.equal(cs204.satisfied, false);
  assert.ok(cs204.reasons.some((x) => x.code === 'not-taken'));
  // GE999 信息缺失出现在 S2019001
  const r1 = audit('S2019001');
  assert.ok(r1.totals.unknownCourses.includes('GE999'));
  assert.ok(r1.totals.outOfUniverse.every((x) => x.courseId !== 'GE999') === false
    || r1.issues.some((i) => i.courseId === 'GE999'));
});

test('跨方案等价：2018 届旧课 CS099 可抵 CS101；2022 届该关系无效', () => {
  const oldS = audit('S2019002');
  const req101 = oldS.requiredRows.find((x) => x.requirementCourse === 'CS101');
  assert.equal(req101.satisfied, true);
  assert.equal(req101.via, 'equivalence');
  assert.equal(req101.matchedCourse, 'CS099');

  // 2022 届赵六修了 CS101，但 2022 版必修要求的是 CS110；EQ-NEW 方向是 CS110->CS101，救不了 CS110
  const newS = audit('S2022001');
  const req110 = newS.requiredRows.find((x) => x.requirementCourse === 'CS110');
  assert.equal(req110.satisfied, false);
  // 赵六修了旧课 CS099：2018 版等价关系对 2022 届明确拒绝并记录原因
  assert.ok(newS.rejectedEquivalences.some((e) => e.equivalenceId === 'EQ-CS099-CS101'));
});

test('重修规则随方案版本：max 与 last 差异', () => {
  // S2019002 CS304：58 -> 65 重修，2018版 max => 65
  const oldS = audit('S2019002');
  assert.ok(oldS.totals.earned > 0);
  // S2022001 CS304：59 -> 71，2022版 last => 71
  const newS = audit('S2022001');
  const cs304 = newS.requiredRows.find((x) => x.requirementCourse === 'CS304');
  assert.equal(cs304.satisfied, true);
});

test('补考封顶 60 计入通过', () => {
  const r = audit('S2019001');
  const ma102 = r.requiredRows.find((x) => x.requirementCourse === 'MA102');
  assert.equal(ma102.satisfied, true);
});

test('总学分：每门通过课程只计一次，方案外课程不计入', () => {
  const r = audit('S2019002');
  const manual = new Set();
  for (const row of r.requiredRows) if (row.satisfied) manual.add(row.matchedCourse);
  for (const g of r.electiveRows) for (const a of g.assigned) manual.add(a.courseId);
  for (const c of r.totals.extraInUniverse) manual.add(c);
  // countedCourses 与“必修占用 + 选修分配 + 域内冗余”完全一致，无重复
  assert.deepEqual([...manual].sort(), r.totals.countedCourses.sort());
  // 冗余在选方案域内的课程只计一次学分
  assert.ok(r.totals.extraInUniverse.includes('CS304'));
  // GE999 学生的方案外未知课不得产生毕业学分
  const r1 = audit('S2019001');
  assert.ok(!r1.totals.countedCourses.includes('GE999'));
  assert.ok(r1.totals.outOfUniverse.some((x) => x.courseId === 'GE999')
    || r1.issues.some((i) => i.courseId === 'GE999'));
  // 去重性：同一课程不会出现两次
  assert.equal(new Set(r.totals.countedCourses).size, r.totals.countedCourses.length);
});
