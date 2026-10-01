import { MODULE_ID, clockLabel } from "./time.mjs";
import { readCalendarFile, sameMonths, combineEvents, exportCalendar } from "./calendar-io.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const WEATHER = {
  clear: { name: "晴朗", icon: "fa-sun", effect: "" },
  partlyCloudy: { name: "多云间晴", icon: "fa-cloud-sun", effect: "" },
  cloudy: { name: "阴云", icon: "fa-cloud", effect: "" },
  rain: { name: "降雨", icon: "fa-cloud-rain", effect: "rain" },
  storm: { name: "雷暴", icon: "fa-cloud-bolt", effect: "rainStorm" },
  snow: { name: "降雪", icon: "fa-snowflake", effect: "snow" },
  blizzard: { name: "暴风雪", icon: "fa-wind", effect: "blizzard" },
  fog: { name: "大雾", icon: "fa-smog", effect: "fog" },
  windy: { name: "大风", icon: "fa-wind", effect: "" }
};

const CLIMATES = {
  temperate: { name: "温带", temperatures: [[8, 19], [20, 31], [7, 20], [-6, 7]],
    weights: [
      { clear: 3, partlyCloudy: 3, cloudy: 2, rain: 3, fog: 1, windy: 1 },
      { clear: 5, partlyCloudy: 3, cloudy: 1, rain: 2, storm: 2 },
      { clear: 2, partlyCloudy: 3, cloudy: 3, rain: 3, fog: 2, windy: 1 },
      { clear: 2, cloudy: 2, snow: 3, blizzard: 1, fog: 1, windy: 1 }
    ] },
  tropical: { name: "热带", temperatures: [[23, 31], [26, 35], [23, 32], [20, 29]],
    weights: [
      { clear: 4, partlyCloudy: 3, rain: 4, storm: 1 },
      { clear: 3, partlyCloudy: 2, rain: 5, storm: 3 },
      { clear: 3, partlyCloudy: 3, rain: 5, storm: 2 },
      { clear: 5, partlyCloudy: 3, rain: 2, fog: 1 }
    ] },
  arid: { name: "干旱", temperatures: [[13, 26], [27, 42], [15, 30], [2, 19]],
    weights: [
      { clear: 7, partlyCloudy: 2, cloudy: 1, windy: 2, rain: 1 },
      { clear: 8, partlyCloudy: 2, windy: 3, storm: 1 },
      { clear: 7, partlyCloudy: 2, cloudy: 1, windy: 2 },
      { clear: 6, partlyCloudy: 2, cloudy: 2, windy: 2, rain: 1 }
    ] },
  cold: { name: "寒带", temperatures: [[-6, 6], [2, 15], [-10, 5], [-30, -9]],
    weights: [
      { clear: 3, cloudy: 2, snow: 3, fog: 1, windy: 1 },
      { clear: 4, partlyCloudy: 3, rain: 2, fog: 1 },
      { clear: 2, cloudy: 3, snow: 3, windy: 2 },
      { clear: 1, cloudy: 2, snow: 5, blizzard: 3, fog: 1 }
    ] }
};

let calendarApp;
let weatherQueue = Promise.resolve();

function localize(value) {
  return value ? game.i18n.localize(value) : "";
}

function dayKey(components = game.time.calendar.timeToComponents(game.time.worldTime)) {
  return `${components.year}:${components.day}`;
}

function seasonIndex(components, calendar) {
  const seasons = calendar.seasons?.values ?? [];
  const season = seasons[components.season];
  const name = localize(season?.name).toLowerCase();
  if (/spring|春/.test(name)) return 0;
  if (/summer|夏/.test(name)) return 1;
  if (/autumn|fall|秋/.test(name)) return 2;
  if (/winter|冬/.test(name)) return 3;
  if (seasons.length === 4 && Number.isInteger(components.season)) return components.season;
  const quarter = Math.min(3, Math.floor(components.month / Math.max(1, calendar.months.values.length) * 4));
  return [3, 0, 1, 2][quarter];
}

function seededRandom(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function generatedWeather(scene, state, components = game.time.calendar.timeToComponents(game.time.worldTime)) {
  const calendar = game.time.calendar;
  const season = seasonIndex(components, calendar);
  const climate = CLIMATES[state.climate] ?? CLIMATES.temperate;
  const seed = `${scene.id}:${dayKey(components)}:${state.seed ?? 0}`;
  const weights = climate.weights[season];
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  let roll = seededRandom(`${seed}:weather`) * total;
  let type = "clear";
  for (const [id, weight] of Object.entries(weights)) {
    roll -= weight;
    if (roll < 0) { type = id; break; }
  }
  const [min, max] = climate.temperatures[season];
  const tempC = Math.round(min + seededRandom(`${seed}:temperature`) * (max - min));
  return { type, tempC };
}

function nativeWeatherType(scene) {
  return Object.keys(WEATHER).find(key => WEATHER[key].effect && WEATHER[key].effect === scene?.weather)
    ?? (scene?.weather ? "other" : "clear");
}

export function weatherSummary(scene = canvas?.scene) {
  if (!scene) return { name: "未选择场景", icon: "fa-cloud", temperature: "", mode: "none" };
  const state = scene.getFlag(MODULE_ID, "weather");
  const auto = state?.mode === "auto";
  const current = auto ? generatedWeather(scene, state) : state?.mode === "manual" ? state : null;
  const type = current?.type ?? nativeWeatherType(scene);
  const preset = WEATHER[type];
  return {
    name: preset?.name ?? (scene.weather ? localize(CONFIG.weatherEffects[scene.weather]?.label) || "其他天气" : "晴朗"),
    icon: preset?.icon ?? "fa-cloud",
    temperature: Number.isFinite(current?.tempC) ? `${current.tempC}°C` : "",
    tempValue: Number.isFinite(current?.tempC) ? current.tempC : 20,
    mode: state?.mode ?? "none",
    modeLabel: auto ? "按日自动" : state?.mode === "manual" ? "GM 手动设定" : "读取场景设置",
    isAuto: auto,
    type: preset ? type : "clear",
    climate: CLIMATES[state?.climate] ? state.climate : "temperate",
    sceneName: scene.name,
    nativeEffect: scene.weather || "无",
    managed: !!state?.mode
  };
}

function monthData(calendar, year, month) {
  const months = calendar.months.values;
  const monthInfo = months[month];
  const leap = calendar.isLeapYear(year);
  const length = leap ? monthInfo.leapDays ?? monthInfo.days : monthInfo.days;
  const dayOffset = months.slice(0, month).reduce((sum, entry) =>
    sum + (leap ? entry.leapDays ?? entry.days : entry.days), 0);
  const timestamp = calendar.componentsToTime({ year, day: dayOffset });
  const weekday = calendar.timeToComponents(timestamp).dayOfWeek;
  const firstWeekday = ((weekday % calendar.days.values.length) + calendar.days.values.length)
    % calendar.days.values.length;
  return { length, dayOffset, firstWeekday };
}

class CalendarWeatherApp extends HandlebarsApplicationMixin(ApplicationV2) {
  viewYear = null;
  viewMonth = null;
  selectedDay = null;
  pendingImport = null;

  static DEFAULT_OPTIONS = {
    id: "d35e-world-calendar",
    classes: ["dwt-calendar-window"],
    window: { title: "3R 日历与天气", resizable: true },
    position: { width: 720, height: 640 },
    actions: {
      previousMonth: CalendarWeatherApp.#previousMonth,
      nextMonth: CalendarWeatherApp.#nextMonth,
      today: CalendarWeatherApp.#today,
      selectDay: CalendarWeatherApp.#selectDay,
      setDate: CalendarWeatherApp.#setDate,
      saveWeather: CalendarWeatherApp.#saveWeather,
      autoWeather: CalendarWeatherApp.#autoWeather,
      rerollWeather: CalendarWeatherApp.#rerollWeather,
      releaseWeather: CalendarWeatherApp.#releaseWeather,
      addEvent: CalendarWeatherApp.#addEvent,
      deleteEvent: CalendarWeatherApp.#deleteEvent,
      exportCalendar: CalendarWeatherApp.#exportCalendar,
      previewImport: CalendarWeatherApp.#previewImport,
      applyImport: CalendarWeatherApp.#applyImport,
      cancelImport: CalendarWeatherApp.#cancelImport
    }
  };

  static PARTS = {
    content: { template: `modules/${MODULE_ID}/templates/calendar-weather.hbs`, scrollable: [".dwt-calendar-content"] }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const calendar = game.time.calendar;
    const now = calendar.timeToComponents(game.time.worldTime);
    const months = calendar.months.values;
    if (!months.length || !calendar.days.values.length) return { ...context, unavailable: true };
    this.viewYear ??= now.year;
    this.viewMonth ??= now.month;
    this.selectedDay ??= now.dayOfMonth + 1;
    const { length, dayOffset, firstWeekday } = monthData(calendar, this.viewYear, this.viewMonth);
    if (this.selectedDay > length) this.selectedDay = length;
    if (length && this.selectedDay < 1) this.selectedDay = 1;
    const events = game.settings.get(MODULE_ID, "calendarEvents");
    const eventDays = new Set(events.filter(event => (event.repeat === "yearly" || event.year === this.viewYear)
      && event.month === this.viewMonth)
      .map(event => event.day));
    const weekdays = calendar.days.values.map(day => ({ name: localize(day.abbreviation || day.name) }));
    const cells = Array.from({ length: firstWeekday }, () => ({ blank: true }));
    for (let day = 1; day <= length; day++) {
      cells.push({ day, today: this.viewYear === now.year && this.viewMonth === now.month && day === now.dayOfMonth + 1,
        selected: day === this.selectedDay, hasEvent: eventDays.has(day) });
    }
    const scene = canvas?.scene;
    const weather = weatherSummary(scene);
    Object.assign(context, {
      calendarName: localize(calendar.name),
      monthName: localize(months[this.viewMonth].name), year: this.viewYear + 1,
      dateTime: clockLabel(game.time.worldTime, calendar), weekdays, cells,
      weekdayCount: calendar.days.values.length,
      selectedDate: length ? `${this.viewYear + 1}年 ${localize(months[this.viewMonth].name)} ${this.selectedDay}日`
        : `${this.viewYear + 1}年 ${localize(months[this.viewMonth].name)}（本年无日期）`,
      noDays: !length,
      events: length ? events.filter(event => event.month === this.viewMonth && event.day === this.selectedDay
        && (event.repeat === "yearly" || event.year === this.viewYear))
        .map(event => ({ ...event, isYearly: event.repeat === "yearly" })) : [],
      hour: now.hour, minute: now.minute, maxHour: calendar.days.hoursPerDay - 1,
      maxMinute: calendar.days.minutesPerHour - 1, isGM: game.user.isGM,
      weather, hasScene: !!scene,
      weatherTypes: Object.entries(WEATHER).map(([id, value]) => ({ id, name: value.name, selected: id === weather.type })),
      climates: Object.entries(CLIMATES).map(([id, value]) => ({ id, name: value.name, selected: id === weather.climate })),
      selectedDayOffset: dayOffset + this.selectedDay - 1,
      pendingImport: this.pendingImport && {
        source: this.pendingImport.source,
        eventCount: this.pendingImport.events.length,
        skipped: this.pendingImport.skipped,
        calendarName: this.pendingImport.calendar.name,
        sameMonths: sameMonths(this.pendingImport.calendar, calendar)
      }
    });
    return context;
  }

  async close(options) {
    if (calendarApp === this) calendarApp = null;
    return super.close(options);
  }

  #moveMonth(delta) {
    const count = game.time.calendar.months.values.length;
    let month = this.viewMonth + delta;
    if (month < 0) { this.viewYear--; month = count - 1; }
    else if (month >= count) { this.viewYear++; month = 0; }
    this.viewMonth = month;
    this.selectedDay = 1;
    this.render();
  }

  static #previousMonth() { this.#moveMonth(-1); }
  static #nextMonth() { this.#moveMonth(1); }
  static #today() {
    const now = game.time.calendar.timeToComponents(game.time.worldTime);
    this.viewYear = now.year;
    this.viewMonth = now.month;
    this.selectedDay = now.dayOfMonth + 1;
    this.render();
  }
  static #selectDay(_event, target) {
    const day = Number(target.dataset.day);
    if (!Number.isSafeInteger(day) || day < 1) return;
    this.selectedDay = day;
    this.render();
  }
  static async #setDate() {
    if (!game.user.isGM) return;
    const calendar = game.time.calendar;
    const { length, dayOffset } = monthData(calendar, this.viewYear, this.viewMonth);
    const hour = Number(this.element.querySelector("[name='hour']")?.value);
    const minute = Number(this.element.querySelector("[name='minute']")?.value);
    if (this.selectedDay < 1 || this.selectedDay > length || !Number.isSafeInteger(hour)
      || !Number.isSafeInteger(minute) || hour < 0 || hour >= calendar.days.hoursPerDay
      || minute < 0 || minute >= calendar.days.minutesPerHour) {
      ui.notifications.warn("请输入有效的日期和时间。");
      return;
    }
    const time = calendar.componentsToTime({ year: this.viewYear, day: dayOffset + this.selectedDay - 1, hour, minute });
    await game.time.set(time);
    this.render();
  }

  #weatherForm() {
    const form = this.element.querySelector(".dwt-weather-form");
    const type = form?.querySelector("[name='weatherType']")?.value;
    const climate = form?.querySelector("[name='climate']")?.value;
    const tempC = Number(form?.querySelector("[name='temperature']")?.value);
    if (!WEATHER[type] || !CLIMATES[climate] || !Number.isFinite(tempC) || tempC < -80 || tempC > 70) {
      ui.notifications.warn("请选择天气和气候，并输入 -80 至 70°C 的气温。");
      return null;
    }
    return { type, climate, tempC };
  }

  static async #saveWeather() {
    if (!game.user.isGM || !canvas?.scene) return;
    const values = this.#weatherForm();
    if (!values) return;
    await canvas.scene.update({ weather: WEATHER[values.type].effect,
      [`flags.${MODULE_ID}.weather`]: { ...values, mode: "manual" } });
    this.render();
  }

  static async #autoWeather() {
    if (!game.user.isGM || !canvas?.scene) return;
    const form = this.element.querySelector(".dwt-weather-form");
    const climate = form?.querySelector("[name='climate']")?.value;
    if (!CLIMATES[climate]) return;
    const state = { mode: "auto", climate, seed: 0, dayKey: dayKey() };
    const value = generatedWeather(canvas.scene, state);
    await canvas.scene.update({ weather: WEATHER[value.type].effect,
      [`flags.${MODULE_ID}.weather`]: state });
    this.render();
  }

  static async #rerollWeather() {
    if (!game.user.isGM || !canvas?.scene) return;
    const prior = canvas.scene.getFlag(MODULE_ID, "weather");
    if (prior?.mode !== "auto") return;
    const state = { ...prior, seed: (prior.seed ?? 0) + 1, dayKey: dayKey() };
    const value = generatedWeather(canvas.scene, state);
    await canvas.scene.update({ weather: WEATHER[value.type].effect,
      [`flags.${MODULE_ID}.weather`]: state });
    this.render();
  }

  static async #releaseWeather() {
    if (!game.user.isGM || !canvas?.scene) return;
    await canvas.scene.unsetFlag(MODULE_ID, "weather");
    this.render();
  }

  static async #addEvent() {
    if (!game.user.isGM) return;
    if (this.selectedDay < 1) return;
    const form = this.element.querySelector(".dwt-calendar-event-form");
    const title = form?.querySelector("[name='eventTitle']")?.value?.trim();
    const detail = form?.querySelector("[name='eventDetail']")?.value?.trim() ?? "";
    const repeat = form?.querySelector("[name='eventRepeat']")?.checked ? "yearly" : "none";
    if (!title || title.length > 100 || detail.length > 500) {
      ui.notifications.warn("事件需要标题；标题最多 100 字，说明最多 500 字。");
      return;
    }
    const events = game.settings.get(MODULE_ID, "calendarEvents");
    await game.settings.set(MODULE_ID, "calendarEvents", [...events, {
      id: foundry.utils.randomID(), year: this.viewYear, month: this.viewMonth,
      day: this.selectedDay, title, detail, repeat
    }]);
    this.render();
  }

  static async #deleteEvent(_event, target) {
    if (!game.user.isGM) return;
    const events = game.settings.get(MODULE_ID, "calendarEvents");
    await game.settings.set(MODULE_ID, "calendarEvents", events.filter(entry => entry.id !== target.dataset.eventId));
    this.render();
  }

  static #exportCalendar() {
    if (!game.user.isGM) return;
    exportCalendar();
  }

  static async #previewImport() {
    if (!game.user.isGM) return;
    const file = this.element.querySelector("[name='calendarFile']")?.files?.[0];
    if (!file) return ui.notifications.warn("先选择一个 JSON 日历文件。");
    if (file.size > 2_000_000) return ui.notifications.error("日历文件不能超过 2 MB。");
    try {
      this.pendingImport = readCalendarFile(JSON.parse(await file.text()), file.name);
      this.render();
    } catch (error) {
      this.pendingImport = null;
      ui.notifications.error(`无法读取日历：${error.message}`);
    }
  }

  static async #applyImport() {
    if (!game.user.isGM || !this.pendingImport) return;
    const form = this.element.querySelector(".dwt-calendar-import-options");
    const importDefinition = !!form?.querySelector("[name='importDefinition']")?.checked;
    const importEvents = !!form?.querySelector("[name='importEvents']")?.checked;
    const replace = !!form?.querySelector("[name='replaceEvents']")?.checked;
    if (!importDefinition && !importEvents) return ui.notifications.warn("至少选择一项要导入的内容。");
    if (importEvents && !importDefinition && !sameMonths(this.pendingImport.calendar, game.time.calendar)) {
      return ui.notifications.error("文件月份与当前历法不一致；请同时导入历法定义，避免节日落在错误日期。");
    }
    try {
      const current = game.settings.get(MODULE_ID, "calendarEvents");
      if (importDefinition && !sameMonths(this.pendingImport.calendar, game.time.calendar)
        && current.length && (!importEvents || !replace)) {
        return ui.notifications.error("月份结构将改变；为避免旧记录错位，请同时导入记录并勾选替换现有日期记录。先导出备份即可保留旧记录文件。");
      }
      const combined = importEvents ? combineEvents(current, this.pendingImport.events, replace) : null;
      if (importDefinition) await game.settings.set(MODULE_ID, "calendarDefinition", this.pendingImport.calendar);
      if (importEvents) await game.settings.set(MODULE_ID, "calendarEvents", combined);
      const count = importEvents ? combined.length - (replace ? 0 : current.length) : 0;
      ui.notifications.info(`日历已导入：${importDefinition ? "历法已更新；" : ""}记录 ${count} 条。世界当前时间未改变。`);
      this.pendingImport = null;
      const now = game.time.calendar.timeToComponents(game.time.worldTime);
      this.viewYear = now.year;
      this.viewMonth = now.month;
      this.selectedDay = now.dayOfMonth + 1;
      this.render();
    } catch (error) {
      ui.notifications.error(`导入失败：${error.message}`);
    }
  }

  static #cancelImport() {
    this.pendingImport = null;
    this.render();
  }
}

export function openCalendarWeather() {
  calendarApp ??= new CalendarWeatherApp();
  calendarApp.render({ force: true });
}

function syncAutoWeather() {
  if (!game.user.isActiveGM) return;
  weatherQueue = weatherQueue.then(async () => {
    const today = dayKey();
    for (const scene of game.scenes.contents) {
      const state = scene.getFlag(MODULE_ID, "weather");
      if (state?.mode !== "auto" || state.dayKey === today) continue;
      const value = generatedWeather(scene, state);
      await scene.update({ weather: WEATHER[value.type].effect,
        [`flags.${MODULE_ID}.weather`]: { ...state, dayKey: today } });
    }
  }).catch(error => console.error(`${MODULE_ID}: weather update failed`, error));
}

export function initCalendarWeather() {
  Hooks.on("updateWorldTime", () => { calendarApp?.render(); syncAutoWeather(); });
  Hooks.on("updateScene", () => calendarApp?.render());
  Hooks.on("canvasReady", () => calendarApp?.render());
  syncAutoWeather();
}

export function registerCalendarSettings() {
  game.settings.register(MODULE_ID, "calendarDefinition", {
    scope: "world", config: false, type: Object, default: {},
    onChange: definition => applyCalendarDefinition(definition)
  });
  game.settings.register(MODULE_ID, "calendarEvents", {
    scope: "world", config: false, type: Array, default: [], onChange: () => calendarApp?.render()
  });
}

function applyCalendarDefinition(definition) {
  if (!definition?.months?.values?.length || !game.time) return;
  try {
    CONFIG.time.worldCalendarConfig = foundry.utils.deepClone(definition);
    game.time.initializeCalendar();
    if (calendarApp) {
      const now = game.time.calendar.timeToComponents(game.time.worldTime);
      calendarApp.viewYear = now.year;
      calendarApp.viewMonth = now.month;
      calendarApp.selectedDay = now.dayOfMonth + 1;
    }
    calendarApp?.render();
  } catch (error) {
    console.error(`${MODULE_ID}: calendar configuration failed`, error);
    ui.notifications.error("导入的历法无法应用；请查看控制台错误。");
  }
}

export function loadCalendarDefinition() {
  applyCalendarDefinition(game.settings.get(MODULE_ID, "calendarDefinition"));
}
