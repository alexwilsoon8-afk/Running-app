let audio = null;

// Browsers only allow sound after a tap, so this runs from the Start button.
export function unlockAudio() {
  audio ??= new AudioContext();
  audio.resume();
}

export function beep(count = 1) {
  if (!audio) return;
  for (let i = 0; i < count; i++) {
    const start = audio.currentTime + i * 0.3;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.6, start);
    gain.gain.exponentialRampToValueAtTime(0.01, start + 0.2);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.2);
  }
}

export function say(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-GB";
  speechSynthesis.speak(utterance);
}
