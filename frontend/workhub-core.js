(function () {
  'use strict';

  const DAY_MS = 86400000;

  function pad(value) { return String(value).padStart(2, '0'); }
  function parseIso(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return new Date(NaN);
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  }
  function iso(date) {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }
  function todayIso() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  function addDays(value, amount) {
    const date = parseIso(value);
    date.setUTCDate(date.getUTCDate() + Number(amount || 0));
    return iso(date);
  }
  function diffDays(start, end) {
    return Math.round((parseIso(end) - parseIso(start)) / DAY_MS);
  }
  function mondayOf(value) {
    const date = parseIso(value);
    const day = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
    return iso(date);
  }
  function weekDates(value) {
    const monday = mondayOf(value);
    return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
  function roundHalf(value) { return Math.round((Number(value) || 0) * 2) / 2; }
  function rateAt(worker, date, field) {
    const base = Number(worker[field]) || 0;
    const history = Array.isArray(worker.rateHistory) ? worker.rateHistory : [];
    return history
      .filter(item => item.effectiveDate <= date)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
      .reduce((result, item) => result == null ? Number(item[field]) || 0 : result, null) ?? base;
  }
  function weeklyPayroll(workers, attendance, dates, groupId) {
    const selected = workers.filter(worker => !groupId || worker.groupId === groupId);
    const rows = selected.map(worker => {
      let workDays = 0;
      let wages = 0;
      let otHours = 0;
      let otPay = 0;
      const days = dates.map(date => {
        const record = attendance[`${date}:${worker.id}`] || { status:'', ot:0 };
        const dailyRate = rateAt(worker, date, 'dailyRate');
        const otRate = rateAt(worker, date, 'otRate');
        if (record.status === 'present') { workDays += 1; wages += dailyRate; }
        const hours = record.status === 'present' ? roundHalf(record.ot) : 0;
        otHours += hours;
        otPay += hours * otRate;
        return { date, status:record.status || '', ot:hours, dailyRate, otRate };
      });
      return { worker, days, workDays, wages, otHours, otPay, total:wages + otPay };
    });
    return {
      rows,
      totals: rows.reduce((sum, row) => ({
        workDays:sum.workDays + row.workDays,
        wages:sum.wages + row.wages,
        otHours:sum.otHours + row.otHours,
        otPay:sum.otPay + row.otPay,
        total:sum.total + row.total,
      }), { workDays:0, wages:0, otHours:0, otPay:0, total:0 }),
    };
  }
  function overlaps(left, right) {
    return left.start <= right.end && right.start <= left.end;
  }

  window.WorkHubCore = Object.freeze({
    parseIso, iso, todayIso, addDays, diffDays, mondayOf, weekDates,
    clamp, roundHalf, rateAt, weeklyPayroll, overlaps,
  });
})();
