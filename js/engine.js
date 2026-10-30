// Pure run logic: no DOM, no storage, so it can be tested on its own.

export const SEGMENT_LABELS = {
  warmup: "WARM UP",
  run: "RUN",
  walk: "WALK",
  cooldown: "COOL DOWN",
};

const SPOKEN_LABELS = {
  warmup: "Warm up walk",
  run: "Run",
  walk: "Walk",
  cooldown: "Cool down walk",
};

export const WARNING_SECONDS = 10;
export const SWITCH_RUNNER_SECONDS = 120;

export function totalSeconds(segments) {
  return segments.reduce((sum, segment) => sum + segment.seconds, 0);
}

export function locate(segments, elapsed) {
  let end = 0;
  for (let i = 0; i < segments.length; i++) {
    end += segments[i].seconds;
    if (elapsed < end) {
      return {
        index: i,
        segment: segments[i],
        next: segments[i + 1] ?? null,
        remaining: end - elapsed,
      };
    }
  }
  return null;
}

// Cues whose moment falls in the (from, to] window of elapsed seconds.
export function cuesBetween(segments, from, to) {
  const cues = [];
  let end = 0;
  segments.forEach((segment, i) => {
    end += segment.seconds;
    const next = segments[i + 1] ?? null;
    const warnAt = end - WARNING_SECONDS;
    if (from < warnAt && to >= warnAt) cues.push({ kind: "warning", next });
    if (from < end && to >= end) cues.push({ kind: "change", next });
  });
  return cues;
}

export function nextDay(week, day, lastWeek = 9) {
  if (day < 3) return { week, day: day + 1 };
  if (week < lastWeek) return { week: week + 1, day: 1 };
  return null;
}

// Zones are the five "starts at" bpm values. Returns 1 to 5, 0 below zone 1,
// or null when zones haven't been entered.
export function zoneFor(bpm, zones) {
  if (!zones || bpm == null) return null;
  for (let i = zones.length - 1; i >= 0; i--) {
    if (bpm >= zones[i]) return i + 1;
  }
  return 0;
}

export function formatClock(seconds) {
  const whole = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(whole / 60);
  const s = String(whole % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export function spokenDuration(seconds) {
  if (seconds < 60 || seconds === 90) return `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  const unit = minutes === 1 ? "minute" : "minutes";
  return seconds % 60 === 30 ? `${minutes} and a half minutes` : `${minutes} ${unit}`;
}

export function spokenSegment(segment) {
  return `${SPOKEN_LABELS[segment.type]} for ${spokenDuration(segment.seconds)}`;
}

export function shortDuration(seconds) {
  if (seconds < 60) return `${seconds} s`;
  return `${Number((seconds / 60).toFixed(1))} min`;
}

export function describeSession(segments) {
  const runs = segments.filter((segment) => segment.type === "run");
  const running = totalSeconds(runs);
  const count = runs.length === 1 ? "1 run" : `${runs.length} runs`;
  return `${count}, ${shortDuration(running)} running, ${shortDuration(totalSeconds(segments))} total`;
}

// Standard Heart Rate Measurement (0x2A37): bit 0 of the flags byte says
// whether the value is one byte or two.
export function parseHeartRate(dataView) {
  const flags = dataView.getUint8(0);
  return flags & 1 ? dataView.getUint16(1, true) : dataView.getUint8(1);
}
