// 数据加载与结构校验：导入时即发现字段缺失、引用悬空、版本缺失等问题
export function validateDataset(dataset) {
  const errors = [];
  const warn = (msg) => errors.push(msg);

  const catalog = dataset.catalog;
  const programs = dataset.programs;
  const equivalences = dataset.equivalences || [];
  const prereqDef = dataset.prerequisites || { prerequisites: {} };
  const students = dataset.students || [];

  if (!Array.isArray(catalog) || catalog.length === 0) warn('课程库为空或格式错误');
  const catalogIds = new Set();
  for (const c of catalog || []) {
    if (!c.id || !c.name || typeof c.credits !== 'number') {
      warn(`课程库条目字段不完整：${JSON.stringify(c)}`);
    }
    if (catalogIds.has(c.id)) warn(`课程库存在重复课程编号 ${c.id}`);
    catalogIds.add(c.id);
  }

  if (!Array.isArray(programs) || programs.length === 0) warn('培养方案为空或格式错误');
  const programKeys = new Set();
  for (const p of programs || []) {
    const key = `${p.id}/${p.version}`;
    if (programKeys.has(key)) warn(`培养方案重复：${key}`);
    programKeys.add(key);
    if (!p.id || !p.version) warn(`培养方案缺少 id/version：${JSON.stringify(p)}`);
    if (!Array.isArray(p.effectiveEnrollYears) || p.effectiveEnrollYears.length === 0) {
      warn(`方案 ${key} 缺少 effectiveEnrollYears`);
    }
    if (typeof p.totalCredits !== 'number') warn(`方案 ${key} 缺少 totalCredits`);
    for (const cid of p.required || []) {
      if (!catalogIds.has(cid)) warn(`方案 ${key} 必修 ${cid} 不在课程库`);
    }
    const gids = new Set();
    for (const g of p.electiveGroups || []) {
      if (!g.id || gids.has(g.id)) warn(`方案 ${key} 选修组 id 缺失或重复：${g.id}`);
      gids.add(g.id);
      if (typeof g.minCredits !== 'number') warn(`选修组 ${key}/${g.id} 缺少 minCredits`);
      for (const cid of g.courses || []) {
        if (!catalogIds.has(cid)) warn(`选修组 ${key}/${g.id} 课程 ${cid} 不在课程库`);
      }
    }
  }

  for (const eq of equivalences) {
    if (!eq.id || !eq.programId || !eq.programVersion || !eq.fromCourse || !eq.toCourse) {
      warn(`等价关系字段不完整：${JSON.stringify(eq)}`);
    }
    if (eq.fromCourse && !catalogIds.has(eq.fromCourse)) warn(`等价关系 ${eq.id} 源课程 ${eq.fromCourse} 不在课程库`);
    if (eq.toCourse && !catalogIds.has(eq.toCourse)) warn(`等价关系 ${eq.id} 目标课程 ${eq.toCourse} 不在课程库`);
    const key = `${eq.programId}/${eq.programVersion}`;
    if (eq.programId && !programKeys.has(key)) warn(`等价关系 ${eq.id} 指向不存在的方案 ${key}`);
  }

  const prereqMap = prereqDef.prerequisites || {};
  for (const [cid, rules] of Object.entries(prereqMap)) {
    if (!catalogIds.has(cid)) warn(`先修要求课程 ${cid} 不在课程库`);
    for (const rule of rules) {
      for (const pre of rule.courses || []) {
        if (!catalogIds.has(pre)) warn(`先修要求：${cid} 依赖的 ${pre} 不在课程库`);
      }
    }
  }

  for (const s of students) {
    if (!s.id || !s.programId || typeof s.enrollYear !== 'number') {
      warn(`学生字段不完整：${JSON.stringify(s).slice(0, 120)}`);
    }
    for (const g of s.grades || []) {
      if (!g.courseId || typeof g.score !== 'number' || !g.term) {
        warn(`学生 ${s.id} 成绩条目字段不完整：${JSON.stringify(g)}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// 把分散的导入文件归并为统一数据集；版本号缺失时用 UNVERSIONED 标注（导出时可见）
export function normalizeDataset(input) {
  // 兼容两种导入形态：裸数组/映射，或带版本字段的包装对象
  const catalogDoc = input.catalog;
  const programsDoc = input.programs;
  const equivDoc = input.equivalences;
  const studentsDoc = input.students;

  const catalog = Array.isArray(catalogDoc) ? catalogDoc : (catalogDoc?.courses ?? []);
  const programs = Array.isArray(programsDoc) ? programsDoc : (programsDoc?.programs ?? []);
  const equivalences = Array.isArray(equivDoc) ? equivDoc : (equivDoc?.equivalences ?? []);
  const prereqDef = input.prerequisites?.prerequisites ?? input.prerequisites ?? {};
  const students = Array.isArray(studentsDoc) ? studentsDoc : (studentsDoc?.students ?? []);

  const versionOf = (doc, arrayOverride) => {
    if (arrayOverride) return arrayOverride;
    return (Array.isArray(doc) ? undefined : doc?.version) || 'UNVERSIONED';
  };

  const dataset = {
    catalog,
    programs,
    equivalences,
    prerequisites: prereqDef,
    students,
    versions: {
      catalog: versionOf(catalogDoc, input.catalogVersion),
      programs: versionOf(programsDoc, input.programsVersion),
      equivalences: versionOf(equivDoc, input.equivalencesVersion),
      prerequisites: input.prereqVersion || input.prerequisites?.version || 'UNVERSIONED',
      students: versionOf(studentsDoc, input.studentsVersion),
      exportedAt: new Date().toISOString(),
    },
  };
  return dataset;
}

// 前端合并导入：按顶层 key 替换对应数据域，保留未导入的域
export function mergeDataset(current, incoming) {
  const merged = { ...current };
  for (const key of ['catalog', 'programs', 'equivalences', 'prerequisites', 'students']) {
    if (incoming[key] !== undefined) merged[key] = incoming[key];
  }
  const normalized = normalizeDataset(merged);
  return normalized;
}
