import { MODULE_ID } from "./time.mjs";

const FORMAT = "d35e-world-timeline-calendar";
const MAX_EVENTS = 5000;

function text(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function integer(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function plainText(html) {
  const parsed = new DOMParser().parseFromString(String(html ?? ""), "text/html");
  return text(parsed.body.textContent, 500);
}

function normalizeEvent(entry, source) {
  if (!entry || typeof entry !== "object") throw new Error(`第 ${source} 条记录不是对象。`);
  const year = entry.year;
  const month = entry.month;
  const day = entry.day;
  const title = text(entry.title, 100);
  const detail = text(entry.detail, 500);
  const repeat = entry.repeat === "yearly" ? "yearly" : "none";
  if (!integer(year, -999999, 999999) || !integer(month, 0, 999) || !integer(day, 1, 999) || !title) {
    throw new Error(`第 ${source} 条记录的日期或标题无效。`);
  }
  return { id: foundry.utils.randomID(), year, month, day, title, detail, repeat };
}

function validateCalendar(config) {
  if (!config || typeof config !== "object" || !Array.isArray(config.months?.values)
    || !Array.isArray(config.days?.values) || !config.months.values.length || !config.days.values.length) {
    throw new Error("文件中没有可用的月份或星期定义。");
  }
  // Let Foundry validate its own v14 CalendarConfig before it can be saved.
  const model = new CONFIG.time.worldCalendarClass(config);
  model.validate({ strict: true });
  return model.toObject();
}

function validateEventDates(events, calendar) {
  const months = calendar.months.values;
  for (const [index, event] of events.entries()) {
    const month = months[event.month];
    if (!month || event.day > Math.max(month.days, month.leapDays ?? month.days)) {
      throw new Error(`第 ${index + 1} 条记录超出了导入历法的月份天数。`);
    }
  }
  return events;
}

function simpleCalendarConfig(source, fileName) {
  const months = source.months;
  const weekdays = source.weekdays;
  if (!Array.isArray(months) || !months.length || !Array.isArray(weekdays) || !weekdays.length) {
    throw new Error("Simple Calendar 文件没有完整的月份和星期数据。");
  }
  const interval = source.leapYear?.rule === "custom" ? Number(source.leapYear.customMod) : 0;
  const hasLeapDays = months.some(month => month.numberOfLeapYearDays !== month.numberOfDays);
  if (hasLeapDays && (!integer(interval, 2, 10000))) {
    throw new Error("该 Simple Calendar 的闰年规则无法转换为 Foundry 14 的固定闰年间隔。");
  }
  const values = months.map((month, index) => ({
    name: text(month.name, 100) || `月 ${index + 1}`,
    abbreviation: text(month.abbreviation, 20),
    ordinal: index + 1,
    days: month.numberOfDays,
    leapDays: month.numberOfLeapYearDays ?? month.numberOfDays,
    intercalary: !!month.intercalary,
    startingWeekday: Number.isInteger(month.startingWeekday) ? month.startingWeekday : null
  }));
  if (values.some(month => !integer(month.days, 0, 999) || !integer(month.leapDays, 0, 999))) {
    throw new Error("Simple Calendar 的月份天数无效。");
  }
  const config = {
    name: text(source.name, 100) || text(fileName.replace(/\.json$/i, ""), 100) || "导入的历法",
    description: "由 Simple Calendar JSON 导入",
    years: {
      yearZero: 0,
      firstWeekday: Number.isInteger(source.year?.firstWeekday) ? source.year.firstWeekday : 0,
      // The module displays internal year + 1, matching Simple Calendar's numbered years.
      leapYear: hasLeapDays ? { leapStart: interval - 1, leapInterval: interval } : null
    },
    months: { values },
    days: {
      values: weekdays.map((day, index) => ({
        name: text(day.name, 100) || `日 ${index + 1}`,
        abbreviation: text(day.abbreviation, 20), ordinal: index + 1
      })),
      daysPerYear: values.reduce((sum, month) => sum + month.days, 0),
      hoursPerDay: source.time?.hoursInDay ?? 24,
      minutesPerHour: source.time?.minutesInHour ?? 60,
      secondsPerMinute: source.time?.secondsInMinute ?? 60
    },
    seasons: null
  };
  return validateCalendar(config);
}

function simpleCalendarNotes(notes) {
  if (!Array.isArray(notes)) return { events: [], skipped: 0 };
  if (notes.length > MAX_EVENTS) throw new Error("文件中的记录超过 5000 条上限。");
  const events = [];
  let skipped = 0;
  for (const note of notes) {
    const data = note?.flags?.["foundryvtt-simple-calendar"]?.noteData;
    const date = data?.startDate;
    const end = data?.endDate;
    const repeat = data?.repeats ?? 0;
    // Simple Calendar: 0 = never, 3 = yearly. Weekly/monthly repeat and ranges
    // cannot be represented by this module's single-day event records.
    if (!date || ![0, 3].includes(repeat)
      || (end && (end.year !== date.year || end.month !== date.month || end.day !== date.day))) {
      skipped++;
      continue;
    }
    try {
      events.push(normalizeEvent({
        year: date.year - 1, month: date.month, day: date.day + 1,
        title: note.name, detail: plainText(note.content),
        repeat: repeat === 3 ? "yearly" : "none"
      }, events.length + 1));
    } catch { skipped++; }
  }
  return { events, skipped };
}

export function readCalendarFile(data, fileName) {
  if (!data || typeof data !== "object") throw new Error("这不是日历 JSON 对象。");
  if (data.format === FORMAT && data.version === 1) {
    if (!Array.isArray(data.events) || data.events.length > MAX_EVENTS) throw new Error("记录列表无效或超过 5000 条。");
    const calendar = validateCalendar(data.calendar);
    return {
      source: "3R 日历", calendar,
      events: validateEventDates(data.events.map((entry, index) => normalizeEvent(entry, index + 1)), calendar), skipped: 0
    };
  }
  if (data.calendar?.months && Array.isArray(data.notes)) {
    const parsed = simpleCalendarNotes(data.notes);
    const calendar = simpleCalendarConfig(data.calendar, fileName);
    return {
      source: "Simple Calendar", calendar,
      events: validateEventDates(parsed.events, calendar), skipped: parsed.skipped
    };
  }
  throw new Error("不认识这种日历文件；请选择本模组或 Simple Calendar 导出的 JSON。");
}

export function sameMonths(left, right) {
  const a = left?.months?.values ?? [];
  const b = right?.months?.values ?? [];
  return a.length === b.length && a.every((month, index) =>
    month.name.trim().toLowerCase() === b[index].name.trim().toLowerCase()
    && month.days === b[index].days && (month.leapDays ?? month.days) === (b[index].leapDays ?? b[index].days));
}

function fingerprint(event) {
  return JSON.stringify([event.year, event.month, event.day, event.title, event.detail, event.repeat ?? "none"]);
}

export function combineEvents(existing, incoming, replace) {
  if (replace) return incoming;
  const result = [...existing];
  const seen = new Set(existing.map(fingerprint));
  for (const event of incoming) {
    const key = fingerprint(event);
    if (!seen.has(key)) { result.push(event); seen.add(key); }
  }
  if (result.length > MAX_EVENTS) throw new Error("合并后的记录超过 5000 条上限。");
  return result;
}

export function exportCalendar() {
  const data = {
    format: FORMAT, version: 1,
    calendar: game.time.calendar.toObject(),
    events: game.settings.get(MODULE_ID, "calendarEvents")
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `3r-calendar-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
