import {
  SEGMENT_LABELS,
  GARMIN_ZONE_INFO,
  HR_PEAK_READINGS,
  SWITCH_RUNNER_SECONDS,
  ZONE_INFO,
  calculateGarminZones,
  calculateZones,
  cuesBetween,
  describeIntervals,
  describeSession,
  formatClock,
  locate,
  nextDay,
  spokenSegment,
  sustainedPeak,
  totalSeconds,
  zoneFor,
} from "./engine.js";
import { HeartRateMonitor } from "./heart-rate.js";
import { beep, say, unlockAudio } from "./cues.js";
import { loadData, newProfile, saveData } from "./store.js";

const SAVE_EVERY_MS = 10000;
const HR_HIGH_AFTER_MS = 30000;
const HR_HIGH_REPEAT_MS = 60000;
const UNLOCK_HOLD_MS = 2000;
const BANNER_MS = 5000;
const CUE_MAX_GAP_SECONDS = 3;

const $ = (id) => document.getElementById(id);

const data = loadData();
const hr = new HeartRateMonitor();
let plan = [];
let run = null;
let selected = null;
let lastElapsed = 0;
let lastSave = 0;
let hrHighSince = null;
let lastHrBanner = 0;
let recentHr = [];
let bannerTimer = null;
let wakeLock = null;
let unlockTimer = null;

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.hidden = screen.id !== `screen-${name}`;
  });
  window.scrollTo(0, 0);
}

function profileById(id) {
  return data.profiles.find((profile) => profile.id === id);
}

function nextRunner() {
  const index = data.profiles.findIndex((profile) => profile.id === run.profileId);
  return data.profiles[(index + 1) % data.profiles.length];
}

function sessionFor(week, day) {
  return plan.find((entry) => entry.week === week && entry.day === day);
}

function elapsedSeconds() {
  const live = run.resumedAt ? Date.now() - run.resumedAt : 0;
  return (run.accumulatedMs + live) / 1000;
}

// Home

function renderHome() {
  const list = $("profile-list");
  list.replaceChildren();
  for (const profile of data.profiles) {
    const session = sessionFor(profile.week, profile.day);
    const card = $("profile-template").content.cloneNode(true);
    card.querySelector(".profile-name").textContent = profile.name;
    card.querySelector(".profile-progress").textContent = profile.planComplete
      ? "Plan complete"
      : `Week ${profile.week}, Day ${profile.day}`;
    card.querySelector(".profile-session").textContent = describeSession(session.segments);
    card.querySelector(".profile-pick").addEventListener("click", () => openPrep(profile));
    const planButton = card.querySelector(".profile-plan");
    planButton.setAttribute("aria-label", `${profile.name}'s plan`);
    planButton.addEventListener("click", () => openPlan(profile));
    const settings = card.querySelector(".profile-settings");
    settings.setAttribute("aria-label", `${profile.name} settings`);
    settings.addEventListener("click", () => openSettings(profile));
    list.append(card);
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "add-runner";
  add.textContent = "Add runner";
  add.addEventListener("click", () => openSettings(null));
  list.append(add);
  showScreen("home");
}

// Plan overview

function weekStatus(profile, week) {
  if (profile.planComplete || week < profile.week) return "Done";
  return week === profile.week ? `This week: Day ${profile.day} is next` : "Upcoming";
}

// Days with the same session share a row, so most weeks read as one line.
function groupWeekDays(week) {
  const groups = [];
  for (const entry of plan.filter((candidate) => candidate.week === week)) {
    const text = describeIntervals(entry.segments);
    const last = groups.at(-1);
    if (last?.text === text) last.days.push(entry.day);
    else groups.push({ text, days: [entry.day], segments: entry.segments });
  }
  return groups;
}

function openPlan(profile) {
  $("plan-title").textContent = `${profile.name}'s plan`;
  const list = $("plan-weeks");
  list.replaceChildren();
  let current = null;
  for (const week of new Set(plan.map((entry) => entry.week))) {
    const card = $("plan-week-template").content.cloneNode(true);
    const section = card.querySelector(".plan-week");
    const status = weekStatus(profile, week);
    card.querySelector(".plan-week-title").textContent = `Week ${week}`;
    card.querySelector(".plan-week-status").textContent = status;
    if (week === profile.week && !profile.planComplete) {
      section.classList.add("current");
      current = section;
    }
    if (status === "Done") section.classList.add("done");
    const days = card.querySelector(".plan-days");
    for (const group of groupWeekDays(week)) {
      const row = $("plan-day-template").content.cloneNode(true);
      const first = group.days[0];
      const last = group.days.at(-1);
      row.querySelector(".plan-day-label").textContent =
        first === last ? `Day ${first}` : `Days ${first} to ${last}`;
      row.querySelector(".plan-day-steps").textContent = group.text;
      row.querySelector(".plan-day-total").textContent = describeSession(group.segments);
      days.append(row);
    }
    list.append(card);
  }
  showScreen("plan");
  current?.scrollIntoView({ block: "center" });
}

// Before the run

function openPrep(profile) {
  selected = profile;
  $("prep-title").textContent = `${profile.name}: Week ${profile.week}, Day ${profile.day}`;
  $("prep-session").textContent = describeSession(sessionFor(profile.week, profile.day).segments);
  $("prep-hr").hidden = !profile.useHr;
  $("prep-hr-message").textContent = "";
  renderHrStatus();
  showScreen("prep");
}

async function pairHr(messageId) {
  const message = $(messageId);
  message.textContent = "";
  try {
    await hr.pair();
  } catch (error) {
    if (error.name === "NotFoundError") return; // Picker cancelled.
    message.textContent = `Couldn't connect: ${error.message}`;
  }
}

function hrStatusText() {
  if (!hr.supported) return "Bluetooth isn't available here. Open the app in Chrome.";
  switch (hr.status) {
    case "connecting":
      return `Connecting to ${hr.deviceName}...`;
    case "connected":
      return hr.bpm == null ? `${hr.deviceName}: waiting for signal` : `${hr.deviceName}: ${hr.bpm} bpm`;
    case "lost":
      return `${hr.deviceName}: signal lost, reconnecting`;
    default:
      return "Not connected";
  }
}

function renderHrStatus() {
  $("prep-hr-status").textContent = hrStatusText();
  $("settings-hr-status").textContent = hrStatusText();
  if (run && !$("screen-run").hidden) renderRunHr();
}

// Run screen

function startRun(profile) {
  unlockAudio();
  const session = sessionFor(profile.week, profile.day);
  beginRun({
    profileId: profile.id,
    week: profile.week,
    day: profile.day,
    segments: session.segments,
    accumulatedMs: 0,
    hrSum: 0,
    hrCount: 0,
    hrMax: 0,
    ended: null,
  });
  say(spokenSegment(session.segments[0]));
}

function beginRun(state) {
  run = { hrPeak: 0, ...state, resumedAt: Date.now() };
  recentHr = [];
  lastElapsed = elapsedSeconds();
  lastSave = Date.now();
  hrHighSince = null;
  $("run-paused").hidden = true;
  $("run-main").hidden = false;
  $("pause-button").hidden = false;
  persistRun();
  requestWakeLock();
  showScreen("run");
  renderRun();
}

function persistRun() {
  const { resumedAt, ...state } = run;
  data.active = { ...state, accumulatedMs: elapsedSeconds() * 1000 };
  saveData(data);
}

function tick() {
  if (!run || !run.resumedAt) return;
  const elapsed = elapsedSeconds();
  // A big gap means the tablet slept: don't replay the cues it missed.
  if (elapsed - lastElapsed <= CUE_MAX_GAP_SECONDS) playCues(lastElapsed, elapsed);
  lastElapsed = elapsed;
  if (elapsed >= totalSeconds(run.segments)) {
    endRun("complete");
    return;
  }
  checkHrCeiling();
  renderRun();
  if (Date.now() - lastSave >= SAVE_EVERY_MS) {
    persistRun();
    lastSave = Date.now();
  }
}

function playCues(from, to) {
  for (const cue of cuesBetween(run.segments, from, to)) {
    if (cue.kind === "warning") {
      beep(1);
      const text = cue.next
        ? `${SEGMENT_LABELS[cue.next.type].toLowerCase()} in 10 seconds`
        : "10 seconds to go";
      say(text);
      showBanner(text.charAt(0).toUpperCase() + text.slice(1));
    } else {
      beep(2);
      if (cue.next) say(spokenSegment(cue.next));
      else say("Run complete. Well done.");
    }
  }
}

function renderRun() {
  const elapsed = elapsedSeconds();
  const profile = profileById(run.profileId);
  const total = totalSeconds(run.segments);
  const place = locate(run.segments, elapsed) ?? locate(run.segments, total - 1);

  $("run-runner").textContent = profile.name;
  $("run-session").textContent = `Week ${run.week}, Day ${run.day}`;
  $("run-elapsed").textContent = formatClock(elapsed);
  $("run-label").textContent = SEGMENT_LABELS[place.segment.type];
  $("run-countdown").textContent = formatClock(place.remaining);
  $("run-next").textContent = place.next
    ? `${SEGMENT_LABELS[place.next.type]} ${formatClock(place.next.seconds)}`
    : "Finish";
  $("run-left").textContent = formatClock(total - elapsed);

  const other = nextRunner();
  const canSwitch = run.resumedAt && elapsed < SWITCH_RUNNER_SECONDS && other.id !== run.profileId;
  $("switch-button").hidden = !canSwitch;
  $("switch-button").textContent = `Switch to ${other.name}`;

  renderRunHr();
}

function renderRunHr() {
  const profile = profileById(run.profileId);
  const place = locate(run.segments, elapsedSeconds()) ?? locate(run.segments, totalSeconds(run.segments) - 1);
  const value = $("run-hr");
  const detail = $("run-hr-detail");
  const button = $("run-hr-tile");
  const live = profile.useHr && hr.connected;
  const zone = live ? zoneFor(hr.bpm, profile.zones) : null;
  const info = zone ? GARMIN_ZONE_INFO[zone - 1] : null;

  $("run-hr-purpose").hidden = !info;
  $("run-hr-purpose").textContent = info?.purpose ?? "";
  button.disabled = !profile.useHr || hr.status === "connected" || hr.status === "lost";
  if (!profile.useHr) {
    value.textContent = "--";
    detail.textContent = "HR off";
  } else if (live) {
    value.textContent = hr.bpm;
    detail.textContent = zone == null ? "bpm" : zone === 0 ? "Below zone 1" : `Zone ${zone}: ${info.name}`;
  } else if (hr.status === "lost") {
    value.textContent = "--";
    detail.textContent = "HR lost";
  } else if (hr.status === "connected" || hr.status === "connecting") {
    value.textContent = "--";
    detail.textContent = "Waiting for HR";
  } else {
    value.textContent = "--";
    detail.textContent = "Tap to connect";
  }

  let background = place.segment.type;
  if (!run.resumedAt) background = "paused";
  else if (zone != null) background = `zone${zone}`;
  $("screen-run").dataset.background = background;
}

function recordHr(bpm) {
  if (!run || !run.resumedAt || !profileById(run.profileId).useHr) return;
  run.hrSum += bpm;
  run.hrCount += 1;
  run.hrMax = Math.max(run.hrMax, bpm);
  recentHr = [...recentHr, bpm].slice(-HR_PEAK_READINGS);
  run.hrPeak = sustainedPeak(recentHr, run.hrPeak);
}

function checkHrCeiling() {
  const { useHr, hrCeiling } = profileById(run.profileId);
  const now = Date.now();
  if (!useHr || !hrCeiling || !hr.connected || hr.bpm <= hrCeiling) {
    hrHighSince = null;
    return;
  }
  hrHighSince ??= now;
  if (now - hrHighSince >= HR_HIGH_AFTER_MS && now - lastHrBanner >= HR_HIGH_REPEAT_MS) {
    lastHrBanner = now;
    showBanner("HR high, consider walking", true);
  }
}

function showBanner(text, alert = false) {
  const banner = $("banner");
  banner.textContent = text;
  banner.classList.toggle("alert", alert);
  banner.classList.add("visible");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove("visible"), BANNER_MS);
}

function pauseRun() {
  run.accumulatedMs = elapsedSeconds() * 1000;
  run.resumedAt = null;
  persistRun();
  speechSynthesis.cancel();
  $("run-main").hidden = true;
  $("pause-button").hidden = true;
  $("run-paused").hidden = false;
  renderRun();
}

function resumeRun() {
  unlockAudio();
  run.resumedAt = Date.now();
  lastElapsed = elapsedSeconds();
  $("run-paused").hidden = true;
  $("run-main").hidden = false;
  $("pause-button").hidden = false;
  renderRun();
}

// Keeps the elapsed time: the warm-up is the same for everyone, so only the
// plan and HR readings change hands.
function switchRunner() {
  const other = nextRunner();
  run.profileId = other.id;
  run.week = other.week;
  run.day = other.day;
  run.segments = sessionFor(other.week, other.day).segments;
  run.hrSum = 0;
  run.hrCount = 0;
  run.hrMax = 0;
  run.hrPeak = 0;
  recentHr = [];
  persistRun();
  showBanner(`${other.name} is running`);
  renderRun();
}

function setLocked(locked) {
  $("lock-overlay").hidden = !locked;
}

function startUnlock() {
  $("lock-overlay").classList.add("holding");
  unlockTimer = setTimeout(() => {
    cancelUnlock();
    setLocked(false);
  }, UNLOCK_HOLD_MS);
}

function cancelUnlock() {
  clearTimeout(unlockTimer);
  $("lock-overlay").classList.remove("holding");
}

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {
    // Low battery or unsupported: the run still works.
  }
}

function releaseWakeLock() {
  wakeLock?.release();
  wakeLock = null;
}

// After the run

function endRun(reason) {
  run.accumulatedMs = Math.min(elapsedSeconds(), totalSeconds(run.segments)) * 1000;
  run.resumedAt = null;
  run.ended = reason;
  persistRun();
  releaseWakeLock();
  setLocked(false);
  renderFinish();
}

function renderFinish() {
  const complete = run.ended === "complete";
  $("finish-title").textContent = complete ? "Run complete" : "Count this run?";
  $("finish-yes").textContent = complete ? "Mark complete" : "Yes, count it";
  $("finish-no").textContent = complete ? "Don't count it" : "No, don't count it";
  $("finish-time").textContent = formatClock(run.accumulatedMs / 1000);
  $("finish-avg-hr").textContent = run.hrCount ? Math.round(run.hrSum / run.hrCount) : "--";
  $("finish-max-hr").textContent = run.hrCount ? run.hrMax : "--";
  const profile = profileById(run.profileId);
  const newPeak = profile.useHr && profile.maxHr && run.hrPeak > profile.maxHr;
  $("finish-peak").hidden = !newPeak;
  $("finish-peak-update").hidden = false;
  $("finish-peak-text").textContent =
    `New highest HR: ${run.hrPeak}. Your max HR is ${profile.maxHr}. Update it? This replaces your saved zones.`;
  showScreen("finish");
}

function updateMaxHr() {
  const profile = profileById(run.profileId);
  profile.maxHr = run.hrPeak;
  profile.zones = calculateGarminZones(run.hrPeak);
  saveData(data);
  $("finish-peak-update").hidden = true;
  $("finish-peak-text").textContent = `Max HR updated to ${run.hrPeak}, and your zones have been recalculated.`;
}

function settleRun(counted) {
  const profile = profileById(run.profileId);
  data.runs.push({
    date: new Date().toISOString(),
    runnerId: profile.id,
    runner: profile.name,
    week: run.week,
    day: run.day,
    completed: counted,
    duration: Math.round(run.accumulatedMs / 1000),
    distance: null,
    averageHr: run.hrCount ? Math.round(run.hrSum / run.hrCount) : null,
    maxHr: run.hrCount ? run.hrMax : null,
    effort: null,
  });
  if (counted) {
    const next = nextDay(run.week, run.day);
    if (next) Object.assign(profile, next);
    else profile.planComplete = true;
  }
  data.active = null;
  saveData(data);
  run = null;
  renderHome();
}

// Picking up an interrupted run

function offerResume() {
  const active = data.active;
  if (active.ended) {
    run = { ...active, resumedAt: null };
    renderFinish();
    return;
  }
  const profile = profileById(active.profileId);
  $("resume-detail").textContent =
    `${profile.name}, Week ${active.week}, Day ${active.day}, ${formatClock(active.accumulatedMs / 1000)} in`;
  showScreen("resume");
}

// Settings

// No profile means a new runner, which is only stored once it's saved.
function openSettings(profile) {
  selected = profile;
  const shown = profile ?? newProfile();
  $("settings-title").textContent = profile ? `${profile.name}'s settings` : "New runner";
  $("settings-name").value = shown.name;
  $("settings-use-hr").checked = shown.useHr;
  $("settings-age").value = shown.age ?? "";
  $("settings-max-hr").value = shown.maxHr ?? "";
  $("settings-resting-hr").value = shown.restingHr ?? "";
  document.querySelectorAll(".zone-input").forEach((input, i) => {
    input.value = shown.zones?.[i] ?? "";
  });
  renderZoneMethod();
  $("settings-ceiling").value = shown.hrCeiling ?? "";
  $("settings-message").textContent = "";
  $("settings-hr-message").textContent = "";
  $("settings-delete").hidden = !profile;
  setDeleteConfirm(false);
  renderHrStatus();
  showScreen("settings");
  if (!profile) $("settings-name").focus();
}

function setDeleteConfirm(open) {
  $("delete-runner").hidden = open;
  $("delete-confirm").hidden = !open;
  if (open) {
    $("delete-text").textContent =
      `Delete ${selected.name}? This permanently removes their progress, zones and run history.`;
  }
}

function deleteRunner() {
  data.profiles = data.profiles.filter((profile) => profile.id !== selected.id);
  data.runs = data.runs.filter((entry) => entry.runnerId !== selected.id);
  selected = null;
  saveData(data);
  renderHome();
}

function readZoneDetails() {
  return {
    age: Number($("settings-age").value) || null,
    maxHr: Number($("settings-max-hr").value) || null,
    restingHr: Number($("settings-resting-hr").value) || null,
  };
}

function fillZones() {
  const details = readZoneDetails();
  const garmin = $("settings-use-hr").checked;
  const zones = garmin ? calculateGarminZones(details.maxHr) : calculateZones(details);
  const message = $("settings-zone-message");
  if (!zones) {
    message.textContent = garmin
      ? "Enter your max HR from the watch or Garmin Connect."
      : "Enter a resting HR, plus an age or max HR. Resting HR must be below max HR.";
    return;
  }
  document.querySelectorAll(".zone-input").forEach((input, i) => {
    input.value = zones[i];
  });
  message.textContent = "";
}

function saveSettings(event) {
  event.preventDefault();
  const zoneValues = [...document.querySelectorAll(".zone-input")].map((input) => input.value.trim());
  const entered = zoneValues.filter(Boolean).length;
  const zones = zoneValues.map(Number);
  const ascending = zones.every((bpm, i) => i === 0 || bpm > zones[i - 1]);
  const message = $("settings-message");
  if (entered > 0 && (entered < 5 || !ascending)) {
    message.textContent = "Enter all five zones, lowest to highest, or leave them all blank.";
    return;
  }
  const name = $("settings-name").value.trim();
  if (!name) {
    message.textContent = "Enter a name.";
    return;
  }
  if (!selected) {
    selected = newProfile();
    data.profiles.push(selected);
  }
  selected.name = name;
  selected.useHr = $("settings-use-hr").checked;
  Object.assign(selected, readZoneDetails());
  selected.zones = entered ? zones : null;
  selected.hrCeiling = Number($("settings-ceiling").value) || null;
  saveData(data);
  renderHome();
}

// Wiring

// A ticked sensor box means Garmin's zones. Otherwise the evidence-based ones.
function renderZoneMethod() {
  const garmin = $("settings-use-hr").checked;
  const info = garmin ? GARMIN_ZONE_INFO : ZONE_INFO;
  $("settings-zone-title").textContent = garmin ? "Use Garmin's zones" : "Calculate HR zones";
  $("settings-zone-intro").textContent = garmin
    ? "Enter your max HR from the watch or Garmin Connect. If you've customised your zones, type all five below instead."
    : "Enter a resting HR and an age. A measured max HR is more accurate than age, so use it if you have one. Results are estimates.";
  $("settings-max-label").textContent = garmin ? "Max HR from Garmin" : "Measured max HR (optional)";
  $("settings-resting-field").hidden = garmin;
  $("settings-age-field").hidden = garmin;
  $("settings-zone-message").textContent = "";
  document.querySelectorAll(".zone-field").forEach((field, i) => {
    field.querySelector(".zone-name").textContent = `Zone ${i + 1}: ${info[i].name}`;
    field.querySelector(".zone-box").textContent = info[i].purpose;
  });
}

function bindEvents() {
  $("plan-back").addEventListener("click", renderHome);
  $("prep-back").addEventListener("click", renderHome);
  $("prep-connect").addEventListener("click", () => pairHr("prep-hr-message"));
  $("prep-start").addEventListener("click", () => startRun(selected));
  $("pause-button").addEventListener("click", pauseRun);
  $("resume-button").addEventListener("click", resumeRun);
  $("end-button").addEventListener("click", () => endRun("early"));
  $("switch-button").addEventListener("click", switchRunner);
  $("lock-button").addEventListener("click", () => setLocked(true));
  $("run-hr-tile").addEventListener("click", () => pairHr("prep-hr-message"));
  $("finish-peak-update").addEventListener("click", updateMaxHr);
  $("finish-yes").addEventListener("click", () => settleRun(true));
  $("finish-no").addEventListener("click", () => settleRun(false));
  $("resume-yes").addEventListener("click", () => {
    unlockAudio();
    beginRun(data.active);
  });
  $("resume-no").addEventListener("click", () => {
    data.active = null;
    saveData(data);
    renderHome();
  });
  $("settings-form").addEventListener("submit", saveSettings);
  $("delete-runner").addEventListener("click", () => setDeleteConfirm(true));
  $("delete-cancel").addEventListener("click", () => setDeleteConfirm(false));
  $("delete-yes").addEventListener("click", deleteRunner);
  $("settings-calculate").addEventListener("click", fillZones);
  $("settings-use-hr").addEventListener("change", renderZoneMethod);
  $("settings-back").addEventListener("click", renderHome);
  $("settings-connect").addEventListener("click", () => pairHr("settings-hr-message"));

  const overlay = $("lock-overlay");
  overlay.addEventListener("pointerdown", startUnlock);
  overlay.addEventListener("pointerup", cancelUnlock);
  overlay.addEventListener("pointercancel", cancelUnlock);
  overlay.addEventListener("pointerleave", cancelUnlock);
  document.addEventListener("contextmenu", (event) => event.preventDefault());

  document.addEventListener("visibilitychange", () => {
    if (!run || run.ended) return;
    if (document.hidden) persistRun();
    else requestWakeLock();
  });

  hr.onchange = renderHrStatus;
  hr.onreading = recordHr;
}

async function init() {
  bindEvents();
  plan = await (await fetch("plan.json")).json();
  if (data.active) offerResume();
  else renderHome();
  setInterval(tick, 200);
  navigator.storage?.persist?.();
  reloadOnUpdate();
  navigator.serviceWorker?.register("sw.js");
}

// A new version takes over while this one is open, so reload to match it.
// Only from the home screen: never during a run or while filling in a form.
function reloadOnUpdate() {
  if (!navigator.serviceWorker?.controller) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!$("screen-home").hidden) location.reload();
  });
}

init();
