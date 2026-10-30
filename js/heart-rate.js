import { parseHeartRate } from "./engine.js";

const RECONNECT_MS = 5000;
const SIGNAL_TIMEOUT_MS = 10000;

// Works with any standard Bluetooth heart rate source: the Garmin's HR
// broadcast or a chest strap. Status: idle, connecting, connected or lost.
export class HeartRateMonitor {
  constructor() {
    this.status = "idle";
    this.bpm = null;
    this.deviceName = null;
    this.onchange = () => {};
    this.onreading = () => {};
    this.device = null;
    this.reconnectTimer = null;
    this.signalTimer = null;
    this.retrying = false;
    this.handleValue = (event) => this.receive(parseHeartRate(event.target.value));
    this.handleDisconnect = () => this.markLost();
  }

  get supported() {
    return Boolean(navigator.bluetooth);
  }

  get connected() {
    return this.status === "connected" && this.bpm != null;
  }

  // Must be called from a tap: Chrome only opens its device picker then.
  async pair() {
    if (!this.supported) throw new Error("Bluetooth isn't available here. Open the app in Chrome.");
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ["heart_rate"] }],
    });
    this.forget();
    this.device = device;
    this.deviceName = device.name || "Heart rate sensor";
    device.addEventListener("gattserverdisconnected", this.handleDisconnect);
    this.setStatus("connecting");
    try {
      await this.subscribe();
    } catch (error) {
      this.markLost();
      throw error;
    }
  }

  async subscribe() {
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService("heart_rate");
    const characteristic = await service.getCharacteristic("heart_rate_measurement");
    characteristic.addEventListener("characteristicvaluechanged", this.handleValue);
    await characteristic.startNotifications();
    this.clearReconnect();
    this.setStatus("connected");
    this.watchSignal();
  }

  receive(bpm) {
    this.bpm = bpm;
    this.status = "connected";
    this.clearReconnect();
    this.watchSignal();
    this.onreading(bpm);
    this.onchange();
  }

  // Bluetooth can stay connected after the watch stops sending, so a silent
  // sensor counts as lost too.
  watchSignal() {
    clearTimeout(this.signalTimer);
    this.signalTimer = setTimeout(() => this.markLost(), SIGNAL_TIMEOUT_MS);
  }

  markLost() {
    clearTimeout(this.signalTimer);
    this.bpm = null;
    this.setStatus("lost");
    if (this.device && !this.reconnectTimer) {
      this.reconnectTimer = setInterval(() => this.retry(), RECONNECT_MS);
    }
  }

  async retry() {
    if (this.retrying) return; // Android connects can outlast the interval.
    this.retrying = true;
    try {
      if (this.device.gatt.connected) this.device.gatt.disconnect();
      await this.subscribe();
    } catch {
      // Still out of reach. The interval tries again.
    }
    this.retrying = false;
  }

  clearReconnect() {
    clearInterval(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  forget() {
    this.clearReconnect();
    clearTimeout(this.signalTimer);
    if (this.device) {
      this.device.removeEventListener("gattserverdisconnected", this.handleDisconnect);
      if (this.device.gatt.connected) this.device.gatt.disconnect();
    }
    this.device = null;
    this.deviceName = null;
    this.bpm = null;
    this.status = "idle";
  }

  setStatus(status) {
    this.status = status;
    this.onchange();
  }
}
