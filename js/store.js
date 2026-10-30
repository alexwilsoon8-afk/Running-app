const KEY = "c25k-data";

export function newProfile() {
  return {
    id: `runner-${Date.now()}`,
    name: "",
    week: 1,
    day: 1,
    planComplete: false,
    useHr: false,
    age: null,
    maxHr: null,
    restingHr: null,
    zones: null,
    hrCeiling: null,
  };
}

function defaults() {
  return { profiles: [], runs: [], active: null };
}

export function loadData() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? defaults();
  } catch {
    return defaults();
  }
}

export function saveData(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage blocked or full: the run carries on from memory.
  }
}
