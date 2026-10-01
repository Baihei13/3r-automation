export const MODULE_ID = "d35e-world-timeline";
export const ROUND_SECONDS = 6;

export function timer(start, seconds) {
  if (!Number.isFinite(start) || !Number.isFinite(seconds) || seconds <= 0) return null;
  return { start, seconds, end: start + seconds };
}

export function remaining(t, now) {
  return Math.max(0, Math.ceil(t.end - now));
}

export function durationLabel(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const n = Math.max(0, Math.ceil(seconds));
  if (n === 0) return "已到期";
  const days = Math.floor(n / 86400);
  const hours = Math.floor((n % 86400) / 3600);
  const minutes = Math.floor((n % 3600) / 60);
  const secs = n % 60;
  return [days && `${days}天`, hours && `${hours}小时`, minutes && `${minutes}分钟`, secs && `${secs}秒`]
    .filter(Boolean).join(" ");
}

export function nativeBuffSeconds(item) {
  const data = item?.system?.timeline;
  if (!item?.system?.active || !data?.enabled) return null;
  const left = Number(data.total) - Number(data.elapsed ?? 0);
  return Number.isFinite(left) && left > 0 ? left * ROUND_SECONDS : null;
}

export function nativeEffectTimer(effect) {
  const seconds = Number(effect?.duration?.seconds);
  const start = Number(effect?.duration?.startTime);
  if (!Number.isFinite(seconds) || seconds <= 0 || effect?.duration?.startTime == null) return null;
  return timer(start, seconds);
}

export function clockLabel(worldTime, calendar) {
  try {
    const c = calendar?.timeToComponents?.(worldTime);
    if (c) {
      const month = game.i18n.localize(calendar.months?.values?.[c.month]?.name ?? `${Number(c.month) + 1}月`);
      const day = Number(c.dayOfMonth) + 1;
      const hh = String(c.hour ?? 0).padStart(2, "0");
      const mm = String(c.minute ?? 0).padStart(2, "0");
      return `${Number(c.year) + 1}年 ${month} ${day}日 ${hh}:${mm}`;
    }
  } catch (_) { /* Calendar is optional. */ }
  return `世界秒数 ${Math.floor(worldTime)}`;
}
