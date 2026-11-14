import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEquivalences } from '../src/equivalences.js';

const program2018 = { id: 'CS', version: '2018版' };
const program2022 = { id: 'CS', version: '2022版' };
const eqs = [
  { id: 'EQ-OLD', programId: 'CS', programVersion: '2018版', fromCourse: 'CS099', toCourse: 'CS101', validEnrollYears: [2018, 2019, 2020, 2021], note: '旧' },
  { id: 'EQ-NEW', programId: 'CS', programVersion: '2022版', fromCourse: 'CS110', toCourse: 'CS101', validEnrollYears: [2022, 2023], note: '新' },
];

test('等价关系仅在指定方案与入学年份内适用', () => {
  const oldStudent = { id: 'a', enrollYear: 2019, grades: [{ courseId: 'CS099' }] };
  const r1 = resolveEquivalences(oldStudent, program2018, eqs);
  assert.ok(r1.map.has('CS101'));
  assert.equal(r1.map.get('CS101').fromCourse, 'CS099');
  assert.equal(r1.rejected.length, 0);
});

test('新方案替代关系不能套到历史学生：2019 届用不了 2022 版等价', () => {
  const oldStudent = { id: 'a', enrollYear: 2019, grades: [{ courseId: 'CS110' }, { courseId: 'CS099' }] };
  const r = resolveEquivalences(oldStudent, program2018, eqs);
  assert.ok(r.map.has('CS101')); // CS099 仍可用
  const rejectedNew = r.rejected.find((x) => x.equivalenceId === 'EQ-NEW');
  assert.ok(rejectedNew, '2022 版等价对 2019 届应被拒绝并记录原因');
  assert.match(rejectedNew.reason, /2022版/);
});

test('2022 届学生不能使用 2018 版旧课等价', () => {
  const newStudent = { id: 'b', enrollYear: 2022, grades: [{ courseId: 'CS099' }, { courseId: 'CS110' }] };
  const r = resolveEquivalences(newStudent, program2022, eqs);
  assert.equal(r.map.get('CS101')?.fromCourse, 'CS110');
  assert.ok(r.rejected.some((x) => x.equivalenceId === 'EQ-OLD'));
});

test('年份不在有效期内同样拒绝', () => {
  const s = { id: 'c', enrollYear: 2024, grades: [{ courseId: 'CS110' }] };
  const r = resolveEquivalences(s, program2022, eqs);
  assert.ok(!r.map.has('CS101'));
  assert.ok(r.rejected.some((x) => x.equivalenceId === 'EQ-NEW' && /有效入学年份/.test(x.reason)));
});
