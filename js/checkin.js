import {
  LAST_WEEK,
  LEVEL_WORDS,
  TOTAL_SESSIONS,
  WINS,
  bestByWeek,
  checkinDue,
  confidenceSummary,
  countedRecords,
  firstVsLatest,
  formatMinutes,
  latestPlanWeek,
  nextLongestMinutes,
  nextSkip,
  personalBestMinutes,
  planTarget,
  repeatDecision,
  rollingWeight,
  runnerCheckins,
  runnerRecords,
  sessionsDone,
  shortOption,
  thenVsNow,
  unlockedBadge,
  waistDue,
  winCounts,
} from "./checkin-logic.js";
import { saveData } from "./store.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_LINES = [
  { id: "confidence", label: "Confidence", colour: "#1F3A5F", width: 6, dash: "", offset: -15 },
  { id: "energy", label: "Energy", colour: "#2A9D8F", width: 4, dash: "", offset: -5 },
  { id: "runFeel", label: "Runs", colour: "#E9A23B", width: 4, dash: "12 8", offset: 5 },
  { id: "sleep", label: "Waking", colour: "#5B7DB1", width: 4, dash: "2 9", offset: 15 },
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(text, className, onClick) {
  const node = el("button", className, text);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function svg(tag, attributes, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text != null) node.textContent = text;
  return node;
}

function thenNowCard(title, then, now, note) {
  const card = el("div", "light-card then-now");
  card.append(el("h3", "", title), el("p", "then-now-values", `${then} → ${now}`));
  if (note) card.append(el("p", "light-note", note));
  return card;
}

export function createCheckin({ data, plan, questions, showScreen, renderHome }) {
  const body = document.getElementById("checkin-body");
  const journey = document.getElementById("journey-body");
  const question = (id) => questions.find((candidate) => candidate.id === id);
  let draft = null;

  function setHeader(step) {
    document.getElementById("checkin-week").textContent = `Week ${draft.week}`;
    document.querySelectorAll(".step-dot").forEach((dot, i) => {
      dot.classList.toggle("active", i === step);
    });
  }

  function start(profile) {
    const counted = countedRecords(data.runs, profile.id);
    const mine = runnerCheckins(data.checkins, profile.id);
    const previous = mine.at(-1);
    const after = (record) => !previous || record.date > previous.date;
    draft = {
      profile,
      previous,
      week: latestPlanWeek(profile, counted),
      runs: counted.filter(after).length,
      recordsThisWeek: runnerRecords(data.runs, profile.id).filter(after),
      planBefore: { week: profile.week, day: profile.day, planComplete: profile.planComplete },
      answers: {},
      wins: [],
      weightKg: "",
      waistCm: "",
      existing: null,
    };
    renderQuestions();
    showScreen("checkin");
  }

  function questionLabel(item) {
    return item.label.replace("{nextLongestMin}", nextLongestMinutes(plan, draft.week));
  }

  function renderQuestions() {
    setHeader(0);
    body.replaceChildren();
    body.append(el("p", "checkin-strip", `This week's runs · ${draft.runs} of 3 done · logged automatically`));
    const next = button("Next", "light-primary", renderWins);
    const refresh = () => {
      next.disabled = questions.some((item) => !draft.answers[item.id]);
    };
    for (const item of questions) {
      const row = el("div", "light-card question");
      const text = el("div", "question-text");
      text.append(el("h3", "", questionLabel(item)), el("p", "light-note", item.hint));
      const options = el("div", "question-options");
      item.options.forEach((option, i) => {
        const choice = button(option, "choice", () => {
          draft.answers[item.id] = i + 1;
          options.querySelectorAll(".choice").forEach((other, index) => {
            other.setAttribute("aria-pressed", String(index === i));
          });
          refresh();
        });
        choice.setAttribute("aria-pressed", String(draft.answers[item.id] === i + 1));
        options.append(choice);
      });
      row.append(text, options);
      body.append(row);
    }
    const actions = el("div", "light-actions");
    actions.append(button("Not now", "light-secondary", skip), next);
    body.append(actions);
    refresh();
  }

  function renderWins() {
    setHeader(1);
    body.replaceChildren();
    const winsCard = el("div", "light-card");
    winsCard.append(el("h3", "", "Any wins this week?"));
    const grid = el("div", "wins-grid");
    for (const win of WINS) {
      const toggle = button(win, "win-toggle", () => {
        const on = !draft.wins.includes(win);
        draft.wins = on ? [...draft.wins, win] : draft.wins.filter((other) => other !== win);
        toggle.setAttribute("aria-pressed", String(on));
      });
      toggle.setAttribute("aria-pressed", String(draft.wins.includes(win)));
      grid.append(toggle);
    }
    winsCard.append(grid);
    body.append(winsCard);

    if (draft.profile.trackWeight) {
      const card = el("div", "light-card");
      const weight = measureField("Weight (kg)", "weightKg");
      card.append(weight, el("p", "light-note", "Same day, morning, before breakfast. We show the 3-week trend, not single readings."));
      if (waistDue(runnerCheckins(data.checkins, draft.profile.id))) {
        card.append(measureField("Waist (cm, monthly, optional)", "waistCm"));
      }
      body.append(card);
    }

    const actions = el("div", "light-actions");
    actions.append(button("Back", "light-secondary", renderQuestions), button("Save check-in", "light-primary", save));
    body.append(actions);
  }

  function measureField(label, key) {
    const field = el("label", "light-field");
    const input = el("input");
    input.type = "number";
    input.inputMode = "decimal";
    input.step = "0.1";
    input.min = "0";
    input.value = draft[key];
    input.addEventListener("input", () => {
      draft[key] = input.value;
    });
    field.append(el("span", "", label), input);
    return field;
  }

  function save() {
    const decision = repeatDecision(plan, draft.answers.confidence, draft.previous, draft.recordsThisWeek);
    if (decision === "repeat" || decision === "advance") {
      finish(decision === "repeat");
      return;
    }
    body.replaceChildren();
    const card = el("div", "light-card choice-card");
    card.append(el("h3", "", decision));
    const actions = el("div", "light-actions");
    actions.append(
      button("Move on", "light-secondary", () => finish(false)),
      button("Repeat the week", "light-primary", () => finish(true)),
    );
    body.append(card, actions);
  }

  function finish(repeated) {
    const { profile, planBefore } = draft;
    const checkin = {
      id: draft.existing?.id ?? `checkin-${Date.now()}`,
      runnerId: profile.id,
      planWeek: draft.week,
      date: draft.existing?.date ?? new Date().toISOString(),
      runsCompletedThisWeek: draft.runs,
      answers: { ...draft.answers },
      wins: draft.wins,
      repeated,
    };
    if (draft.weightKg !== "") checkin.weightKg = Number(draft.weightKg);
    if (draft.waistCm !== "") checkin.waistCm = Number(draft.waistCm);

    Object.assign(profile, planBefore);
    if (repeated) Object.assign(profile, { week: draft.week, day: 1, planComplete: false });
    profile.checkinSkip = null;

    if (draft.existing) data.checkins[data.checkins.indexOf(draft.existing)] = checkin;
    else data.checkins.push(checkin);
    draft.existing = checkin;
    saveData(data);
    renderSummary(checkin);
  }

  function renderSummary(checkin) {
    setHeader(2);
    body.replaceChildren();
    const { profile } = draft;
    const mine = runnerCheckins(data.checkins, profile.id);
    const counted = countedRecords(data.runs, profile.id);
    const done = sessionsDone(counted);
    const values = thenVsNow(plan, counted, mine, checkin);
    const badge = unlockedBadge(plan, counted, mine, checkin);

    const layout = el("div", "summary-layout");
    const left = el("div", "light-card summary-ring");
    left.append(progressRing(done));
    left.append(el("h3", "", checkin.runsCompletedThisWeek >= 3 ? `Week ${checkin.planWeek} done` : `Week ${checkin.planWeek}`));
    if (badge) left.append(el("span", "badge", badge));

    const right = el("div", "summary-cards");
    const confidence = question("confidence");
    const [firstWords, nowWords] = firstVsLatest(confidence, mine.slice(0, mine.indexOf(checkin) + 1));
    right.append(
      thenNowCard("Longest run without stopping", formatMinutes(values.longestThen), formatMinutes(values.longestNow)),
      thenNowCard("Running this week", formatMinutes(values.runningThen), formatMinutes(values.runningNow)),
      thenNowCard(
        "Next-week confidence",
        shortOption(firstWords),
        shortOption(nowWords),
        confidenceSummary(checkin, mine[0], checkin.repeated),
      ),
    );
    layout.append(left, right);
    body.append(layout);

    const wins = el("div", "light-card");
    wins.append(el("h3", "", "This week's wins"));
    if (checkin.wins.length) {
      const chips = el("div", "chips");
      for (const win of checkin.wins) chips.append(el("span", "chip", win));
      wins.append(chips);
    } else {
      const times = checkin.runsCompletedThisWeek;
      wins.append(
        el("p", "", times ? `Showing up ${times} ${times === 1 ? "time" : "times"} is the win this week.` : "Checking in is the win this week."),
      );
    }
    body.append(wins);

    const actions = el("div", "light-actions");
    actions.append(
      button("Edit answers", "light-secondary", edit),
      button("See your journey", "light-primary", () => open(profile)),
    );
    body.append(actions);
  }

  function edit() {
    const checkin = draft.existing;
    Object.assign(draft, {
      answers: { ...checkin.answers },
      wins: [...checkin.wins],
      weightKg: checkin.weightKg ?? "",
      waistCm: checkin.waistCm ?? "",
    });
    renderQuestions();
  }

  function progressRing(done) {
    const ring = svg("svg", { viewBox: "0 0 120 120", class: "ring", role: "img", "aria-label": `${done} of ${TOTAL_SESSIONS} runs` });
    const length = 2 * Math.PI * 50;
    ring.append(
      svg("circle", { cx: 60, cy: 60, r: 50, fill: "none", stroke: "#C9D3DF", "stroke-width": 10 }),
      svg("circle", {
        cx: 60, cy: 60, r: 50, fill: "none", stroke: "#2A9D8F", "stroke-width": 10, "stroke-linecap": "round",
        "stroke-dasharray": `${(done / TOTAL_SESSIONS) * length} ${length}`, transform: "rotate(-90 60 60)",
      }),
      svg("text", { x: 60, y: 58, "text-anchor": "middle", class: "ring-big" }, done),
      svg("text", { x: 60, y: 78, "text-anchor": "middle", class: "ring-small" }, `of ${TOTAL_SESSIONS} runs`),
    );
    return ring;
  }

  function skip() {
    const { profile, existing } = draft;
    if (!existing) profile.checkinSkip = nextSkip(profile, data.runs, data.checkins);
    saveData(data);
    renderHome();
  }

  function dismiss(profile) {
    profile.checkinSkip = nextSkip(profile, data.runs, data.checkins);
    saveData(data);
    renderHome();
  }

  // Journey

  function open(profile) {
    const mine = runnerCheckins(data.checkins, profile.id);
    const counted = countedRecords(data.runs, profile.id);
    journey.replaceChildren();
    document.getElementById("journey-title").textContent = `${profile.name}: your journey`;
    const count = mine.length === 1 ? "1 check-in" : `${mine.length} check-ins`;
    document.getElementById("journey-subtitle").textContent = `Week ${profile.week} of ${LAST_WEEK} · ${count}`;
    journey.append(renderPath(profile, counted));
    if (mine.length) {
      journey.append(renderThenNow(mine, counted), renderChart(mine), renderWinsCollected(mine));
      if (profile.trackWeight) journey.append(renderBody(mine));
    } else {
      journey.append(el("p", "light-card", "Your journey fills in after your first check-in."));
    }
    showScreen("journey");
  }

  function renderPath(profile, counted) {
    const card = el("div", "light-card");
    const path = el("div", "week-path");
    const doneWeeks = profile.planComplete ? LAST_WEEK : profile.week - 1;
    const bar = el("div", "path-bar");
    const fill = el("div", "path-fill");
    fill.style.width = `${(doneWeeks / LAST_WEEK) * 100}%`;
    bar.append(fill);
    path.append(bar);
    for (let week = 1; week <= LAST_WEEK; week++) {
      const done = week <= doneWeeks;
      const next = week === profile.week && !profile.planComplete;
      const node = el("div", `week-node ${done ? "done" : next ? "next" : "future"}`);
      const minutes = done ? bestByWeek(plan, counted, week) || planTarget(plan, week) : planTarget(plan, week);
      const caption = week === LAST_WEEK && !done ? "30 min goal" : formatMinutes(minutes);
      node.append(
        el("span", "week-dot", done ? "Done" : next ? "Next" : ""),
        el("strong", "", `Week ${week}`),
        el("span", "light-note", caption),
      );
      path.append(node);
    }
    card.append(el("h3", "", "9-week path"), path);
    return card;
  }

  function renderThenNow(mine, counted) {
    const values = thenVsNow(plan, counted, mine);
    const [firstWords, nowWords] = firstVsLatest(question("confidence"), mine);
    const grid = el("div", "journey-cards");
    grid.append(
      thenNowCard("Longest run", formatMinutes(values.longestThen), formatMinutes(values.longestNow)),
      thenNowCard("Running per week", formatMinutes(values.runningThen), formatMinutes(values.runningNow)),
      (() => {
        const card = el("div", "light-card then-now");
        card.append(el("h3", "", "Runs completed"), el("p", "then-now-values", `${sessionsDone(counted)} of ${TOTAL_SESSIONS}`));
        return card;
      })(),
      thenNowCard("Next-week confidence", shortOption(firstWords), shortOption(nowWords)),
    );
    return grid;
  }

  function renderChart(mine) {
    const card = el("div", "light-card");
    card.append(el("h3", "", "How you've felt"));
    const [width, height, left, right, top, bottom] = [800, 320, 90, 30, 30, 50];
    const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "feel-chart", role: "img", "aria-label": "How you've felt, by check-in" });
    const x = (i) => (mine.length === 1 ? (left + width - right) / 2 : left + (i * (width - left - right)) / (mine.length - 1));
    const y = (level) => top + ((4 - level) * (height - top - bottom)) / 3;
    for (const level of [1, 2, 3, 4]) {
      chart.append(
        svg("line", { x1: left, x2: width - right, y1: y(level), y2: y(level), stroke: "#C9D3DF" }),
        svg("text", { x: left - 12, y: y(level) + 6, "text-anchor": "end", class: "chart-text" }, LEVEL_WORDS[level]),
      );
    }
    mine.forEach((checkin, i) => {
      chart.append(svg("text", { x: x(i), y: height - 10, "text-anchor": "middle", class: "chart-text" }, `Wk ${checkin.planWeek}`));
    });
    // Each line keeps its own small offset, so matching answers stay side by side.
    for (const line of CHART_LINES) {
      const lineY = (checkin) => y(checkin.answers[line.id]) + line.offset;
      const points = mine.map((checkin, i) => `${x(i)},${lineY(checkin)}`).join(" ");
      if (mine.length > 1) {
        chart.append(svg("polyline", {
          points, fill: "none", stroke: line.colour, "stroke-width": line.width, "stroke-dasharray": line.dash, "stroke-linecap": "round",
        }));
      }
      mine.forEach((checkin, i) => {
        chart.append(svg("circle", { cx: x(i), cy: lineY(checkin), r: line.width + 1, fill: line.colour }));
      });
    }
    card.append(chart);
    const key = el("ul", "chart-key");
    for (const line of CHART_LINES) {
      const [first, latest] = firstVsLatest(question(line.id), mine);
      const item = el("li", "");
      const sample = svg("svg", { viewBox: "0 0 44 10", class: "key-sample", "aria-hidden": "true" });
      sample.append(svg("line", { x1: 2, x2: 42, y1: 5, y2: 5, stroke: line.colour, "stroke-width": line.width, "stroke-dasharray": line.dash, "stroke-linecap": "round" }));
      item.append(sample, el("span", "", `${line.label}: ${first} → ${latest}`));
      key.append(item);
    }
    card.append(key);
    return card;
  }

  function renderWinsCollected(mine) {
    const card = el("div", "light-card");
    const counts = winCounts(mine);
    const total = counts.reduce((sum, item) => sum + item.count, 0);
    card.append(el("h3", "", `Wins collected: ${total}`));
    if (!counts.length) {
      card.append(el("p", "", "Your wins will collect here."));
      return card;
    }
    for (const { win, count } of counts) {
      const row = el("div", "win-bar");
      const bar = el("div", "win-bar-track");
      const fill = el("div", "win-bar-fill");
      fill.style.width = `${(count / counts[0].count) * 100}%`;
      bar.append(fill);
      row.append(el("span", "", win), bar, el("strong", "", count));
      card.append(row);
    }
    card.append(el("p", "callout", `Most common win: ${counts[0].win}`));
    return card;
  }

  function renderBody(mine) {
    const card = el("div", "light-card");
    card.append(el("h3", "", "Body"));
    const weighed = mine.filter((checkin) => checkin.weightKg != null);
    const waists = mine.filter((checkin) => checkin.waistCm != null);
    if (weighed.length) {
      const weights = weighed.map((checkin) => checkin.weightKg);
      const rolling = rollingWeight(weights);
      card.append(weightChart(weights, rolling));
      card.append(
        el("p", "", weighed.length >= 3
          ? `3-week trend: ${weightChange(rolling.at(-1) - rolling[0])}`
          : "Your trend shows after 3 weigh-ins."),
      );
    } else {
      card.append(el("p", "", "Add a weight at your next check-in to start your trend."));
    }
    if (waists.length) card.append(el("p", "", `Waist: ${waists.at(-1).waistCm} cm`));
    card.append(el("p", "light-note", "Running alone usually moves the scale slowly, about 1.5 kg over the whole plan. Your running numbers above are the main story."));
    return card;
  }

  function weightChange(change) {
    const rounded = Number(change.toFixed(1));
    return rounded === 0 ? "holding steady" : `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)} kg`;
  }

  function weightChart(weights, rolling) {
    const [width, height, pad] = [800, 180, 30];
    const low = Math.min(...weights) - 1;
    const high = Math.max(...weights) + 1;
    const x = (i) => (weights.length === 1 ? width / 2 : pad + (i * (width - pad * 2)) / (weights.length - 1));
    const y = (value) => pad + ((high - value) * (height - pad * 2)) / (high - low);
    const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "feel-chart", role: "img", "aria-label": "Weight dots with a 3-week rolling average" });
    if (rolling.length > 1) {
      chart.append(svg("polyline", {
        points: rolling.map((value, i) => `${x(i)},${y(value)}`).join(" "), fill: "none", stroke: "#1F3A5F", "stroke-width": 4,
      }));
    }
    weights.forEach((value, i) => chart.append(svg("circle", { cx: x(i), cy: y(value), r: 7, fill: "#5B7DB1" })));
    return chart;
  }

  return {
    start,
    open,
    dismiss,
    isDue: (profile) => checkinDue(profile, data.runs, data.checkins),
  };
}
