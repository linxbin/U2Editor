'use strict';

/* 配置健康总览：汇总各工作台体检结果，只读聚合与筛选，不提供批量修复 */

const SEV_ORDER = { error: 0, warn: 1, info: 2 };

function create(options) {
  const sources = (options && options.sources) || [];

  function collect() {
    const issues = [];
    const sourceStats = [];
    const counts = { error: 0, warn: 0, info: 0 };
    const sourceOrder = new Map();

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      sourceOrder.set(source.key, i);
      let result;
      try {
        result = source.health();
      } catch (e) {
        result = { issues: [], error: e.message };
      }
      const own = { error: 0, warn: 0, info: 0 };
      for (const issue of (result && result.issues) || []) {
        const severity = SEV_ORDER[issue.severity] != null ? issue.severity : 'info';
        own[severity]++;
        counts[severity]++;
        issues.push({
          source: source.key,
          sourceLabel: source.label,
          severity,
          code: issue.code || '',
          message: issue.message || '',
          file: issue.file || '',
          line: issue.line == null ? null : issue.line,
          scope: issue.scope || '',
          index: issue.index == null ? null : issue.index,
          action: issue.action || null
        });
      }
      sourceStats.push({
        key: source.key,
        label: source.label,
        error: own.error,
        warn: own.warn,
        info: own.info,
        total: own.error + own.warn + own.info,
        errorMessage: (result && result.error) || ''
      });
    }

    issues.sort((a, b) =>
      (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) ||
      (sourceOrder.get(a.source) - sourceOrder.get(b.source)) ||
      String(a.code).localeCompare(String(b.code)) ||
      String(a.message).localeCompare(String(b.message), 'zh-CN'));

    return {
      generatedAt: new Date().toISOString(),
      stats: {
        error: counts.error,
        warn: counts.warn,
        info: counts.info,
        total: counts.error + counts.warn + counts.info,
        workbenches: sources.length
      },
      sources: sourceStats,
      issues
    };
  }

  function search(q, limit) {
    const keyword = String(q == null ? '' : q).trim().toLowerCase();
    const max = Math.max(1, Math.min(Number(limit) || 200, 1000));
    const data = collect();
    const list = keyword
      ? data.issues.filter((issue) =>
        issue.message.toLowerCase().includes(keyword) ||
        issue.code.toLowerCase().includes(keyword) ||
        issue.sourceLabel.toLowerCase().includes(keyword) ||
        String(issue.file || '').toLowerCase().includes(keyword) ||
        String(issue.scope || '').toLowerCase().includes(keyword))
      : data.issues;
    return { total: list.length, issues: list.slice(0, max) };
  }

  return {
    list() {
      return collect();
    },
    summary() {
      const data = collect();
      return { generatedAt: data.generatedAt, stats: data.stats, sources: data.sources };
    },
    search,
    invalidate() {
      for (const source of sources) {
        if (typeof source.invalidate === 'function') source.invalidate();
      }
    }
  };
}

module.exports = { create };
