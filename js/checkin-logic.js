// Pure weekly check-in and journey logic: no DOM, no storage.

export const LEVEL_WORDS = { 1: "Rough", 2: "Mixed", 3: "Good", 4: "Best" };

export const WINS = [
  "Ran further than before",
  "Runs felt easier",
  "Slept better",
  "More energy day to day",
  "Clothes fit better",
  "Stairs felt easier",
  "Didn't want to skip",
  "Ran with my partner",
];

export const TOTAL_SESSIONS = 27;
export const LAST_WEEK = 9;
export const WAIST_EVERY_DAYS = 28;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const BADGE_MINUTES = [5, 10, 20, 30];
const NUMBER_WORDS = ["Zero", "One", "Two", "Three"];

function segmentsFor(plan, record) {
  return plan.find((entry) => entry.week === record.week && entry.day === record.day)?.segments ?? [];
}

function sessionSeconds(plan, record) {
  return segmentsFor(plan, record).reduce((sum, segment) => sum + segment.seconds, 0);
}

// Run segments finished before the runner stopped.
export function completedRuns(plan, record) {
  const done = [];
  let end = 0;
  for (const segment of segmentsFor(plan, record)) {
    end += segment.seconds;
    if (end > record.duration) break;
    if (segment.type === "run") done.push(segment.seconds);
  }
  return done;
}

export function endedEarly(plan, record) {
  return record.duration < sessionSeconds(plan, record);
}

export function runnerRecords(runs, runnerId) {
  return runs.filter((record) => record.runnerId === runnerId);
}

export function countedRecords(runs, runnerId) {
  return runnerRecords(runs, runnerId).filter((record) => record.completed);
}

export function runnerCheckins(checkins, runnerId) {
  return checkins.filter((checkin) => checkin.runnerId === runnerId);
}

function since(records, checkin) {
  return checkin ? records.filter((record) => record.date > checkin.date) : records;
}

function upTo(records, checkin) {
  return records.filter((record) => record.date <= checkin.date);
}

export function personalBestMinutes(plan, records) {
  const longest = records.flatMap((record) => completedRuns(plan, record));
  return longest.length ? Math.max(...longest) / 60 : 0;
}

export function runningMinutes(plan, records) {
  return records.flatMap((record) => completedRuns(plan, record)).reduce((sum, seconds) => sum + seconds, 0) / 60;
}

export function sessionsDone(records) {
  const unique = new Set(records.map((record) => `${record.week}-${record.day}`));
  return Math.min(unique.size, TOTAL_SESSIONS);
}

export function latestPlanWeek(profile, records) {
  return records.at(-1)?.week ?? profile.week;
}

// The longest single run in the week after this one; week 9 has no next week.
export function nextLongestMinutes(plan, week) {
  const target = Math.min(week + 1, LAST_WEEK);
  const runs = plan
    .filter((entry) => entry.week === target)
    .flatMap((entry) => entry.segments.filter((segment) => segment.type === "run"))
    .map((segment) => segment.seconds);
  return Math.max(...runs) / 60;
}

export function checkinDue(profile, runs, checkins, now = Date.now()) {
  const mine = runnerCheckins(checkins, profile.id);
  const last = mine.at(-1);
  const counted = countedRecords(runs, profile.id);
  if (!last && !counted.length) return false;
  if (profile.planComplete && last?.planWeek === LAST_WEEK) return false;

  const threeDone = since(counted, last).length >= 3;
  const anchor = new Date(last?.date ?? counted[0].date).getTime();
  if (!threeDone && now - anchor < WEEK_MS) return false;

  const skip = profile.checkinSkip;
  const key = last?.id ?? "first";
  if (skip?.key !== key) return true;
  return skip.count < 2 && now - new Date(skip.at).getTime() >= DAY_MS;
}

export function nextSkip(profile, runs, checkins, now = Date.now()) {
  const key = runnerCheckins(checkins, profile.id).at(-1)?.id ?? "first";
  const count = profile.checkinSkip?.key === key ? profile.checkinSkip.count + 1 : 1;
  return { key, count, at: new Date(now).toISOString() };
}

// "repeat", "advance", or text offering the runner the choice.
export function repeatDecision(plan, confidence, previous, recordsThisWeek) {
  if (confidence === 1) return "repeat";
  if (confidence === 2 && previous && previous.answers.confidence <= 2) {
    return "Repeating a week is real progress. Repeat this one, or move on?";
  }
  const early = recordsThisWeek.filter((record) => endedEarly(plan, record)).length;
  if (confidence >= 3 && early >= 2) {
    return `${NUMBER_WORDS[early] ?? early} runs ended early this week. Repeat the week, or move on?`;
  }
  return "advance";
}

export function confidenceSummary(checkin, first, repeated) {
  if (repeated) return "Next week repeats this one. That's the plan working.";
  if (checkin.answers.confidence !== 2) return "";
  const start = first.answers.confidence;
  if (checkin.answers.confidence > start) return "Up from week 1";
  return checkin.answers.confidence === start ? "Same as week 1, and still going" : "Still going, and that counts";
}

export function shortOption(option) {
  return option.split(",")[0];
}

export function firstVsLatest(question, checkins) {
  const words = (checkin) => question.options[checkin.answers[question.id] - 1];
  return [words(checkins[0]), words(checkins.at(-1))];
}

export function thenVsNow(plan, records, checkins, latest = checkins.at(-1)) {
  const first = checkins[0];
  const firstWindow = upTo(records, first);
  const latestIndex = checkins.indexOf(latest);
  const previous = checkins[latestIndex - 1];
  const latestWindow = upTo(since(records, previous), latest);
  return {
    longestThen: personalBestMinutes(plan, firstWindow),
    longestNow: personalBestMinutes(plan, upTo(records, latest)),
    runningThen: runningMinutes(plan, firstWindow),
    runningNow: runningMinutes(plan, latestWindow),
  };
}

export function unlockedBadge(plan, records, checkins, latest) {
  const previous = checkins[checkins.indexOf(latest) - 1];
  const before = previous ? personalBestMinutes(plan, upTo(records, previous)) : 0;
  const now = personalBestMinutes(plan, upTo(records, latest));
  const earned = BADGE_MINUTES.filter((minutes) => before < minutes && now >= minutes);
  return earned.length ? `${earned.at(-1)} min run` : null;
}

export function bestByWeek(plan, records, week) {
  return personalBestMinutes(plan, records.filter((record) => record.week <= week));
}

export function planTarget(plan, week) {
  const runs = plan
    .filter((entry) => entry.week === week)
    .flatMap((entry) => entry.segments.filter((segment) => segment.type === "run"))
    .map((segment) => segment.seconds);
  return Math.max(...runs) / 60;
}

export function winCounts(checkins) {
  const counts = new Map();
  for (const win of checkins.flatMap((checkin) => checkin.wins)) {
    counts.set(win, (counts.get(win) ?? 0) + 1);
  }
  return [...counts].map(([win, count]) => ({ win, count })).sort((a, b) => b.count - a.count);
}

export function rollingWeight(values, size = 3) {
  return values.map((_, i) => {
    const window = values.slice(Math.max(0, i - size + 1), i + 1);
    return window.reduce((sum, value) => sum + value, 0) / window.length;
  });
}

export function waistDue(checkins, now = Date.now()) {
  const last = checkins.filter((checkin) => checkin.waistCm != null).at(-1);
  return !last || now - new Date(last.date).getTime() >= WAIST_EVERY_DAYS * DAY_MS;
}

export function formatMinutes(minutes) {
  return `${Number(minutes.toFixed(1))} min`;
}
