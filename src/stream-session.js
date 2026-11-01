"use strict";

// Runs the melonDS WebAssembly core inside Node so browsers without
// WebAssembly (such as the Nintendo Switch) only need to show JPEG frames.

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const sharp = require("sharp");

const SCREEN_WIDTH = 256;
const SCREEN_HEIGHT = 192 * 2;
const FRAME_BYTES = SCREEN_WIDTH * SCREEN_HEIGHT * 4;
const NDS_FRAME_RATE = 59.8261;
const FRAME_INTERVAL_MS = 1000 / NDS_FRAME_RATE;
const MAX_FRAMES_PER_TICK = 4;
// Held turbo runs the game up to this many times faster (the PC may top out lower).
const TURBO_SPEED = 3;
const MAX_FRAMES_IN_FLIGHT = 2;
const SAVE_POLL_MS = 2000;
const AUDIO_FRAMES = 4096;
const STATE_SLOTS = 3;
// A quick tap can press and release between two emulated frames; keep presses
// visible to the game for a few frames so taps are never lost.
const MIN_HOLD_FRAMES = 3;

class StreamSession {
  constructor(root) {
    this.coreUrl = pathToFileURL(path.join(root, "pilas-melonds-core.js")).href;
    this.saveDir = path.join(root, "saves");
    this.clients = new Set();
    this.Module = null;
    this.instance = 0;
    this.audioPtr = 0;
    this.romPath = "";
    this.romName = "";
    this.saveFile = "";
    this.paused = false;
    this.keyMask = 0xFFF;
    this.wantedMask = 0xFFF;
    this.pressFrame = new Array(12).fill(0);
    this.touch = null;
    this.touchFrame = 0;
    this.touchReleasePending = false;
    this.frameCount = 0;
    this.frameReady = false;
    this.encoding = false;
    this.jpegQuality = 80;
    this.timer = null;
    this.lastTick = 0;
    this.accumulator = 0;
    this.speed = 1;
    this.lastSavePoll = 0;
    this.lastRtc = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 0;
    this.corePromise = null;
  }

  async ensureCore() {
    if (!this.corePromise) {
      this.corePromise = (async () => {
        const factory = (await import(this.coreUrl)).default;
        this.Module = await factory({ print: () => {}, printErr: () => {} });
        this.instance = this.Module._pilas_create(48000);
        this.audioPtr = this.Module._malloc(AUDIO_FRAMES * 4);
        fs.mkdirSync(this.saveDir, { recursive: true });
      })();
    }
    return this.corePromise;
  }

  alloc(bytes) {
    if (!bytes || bytes.length === 0) return 0;
    const ptr = this.Module._malloc(bytes.length);
    this.Module.HEAPU8.set(bytes, ptr);
    return ptr;
  }

  free(ptr) {
    if (ptr) this.Module._free(ptr);
  }

  lastError() {
    const ptr = this.Module._pilas_last_error(this.instance);
    if (!ptr) return "";
    const heap = this.Module.HEAPU8;
    let end = ptr;
    while (heap[end] !== 0) end++;
    return Buffer.from(heap.subarray(ptr, end)).toString("utf8");
  }

  stem() {
    return this.romName.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 64) || "game";
  }

  async loadRom(romPath, romName) {
    await this.ensureCore();
    if (this.romPath === romPath) {
      this.paused = false;
      this.broadcastStatus("Jogando");
      return true;
    }

    this.flushSave(true);
    const romBytes = await fs.promises.readFile(romPath);
    this.romName = romName;
    this.saveFile = path.join(this.saveDir, `${this.stem()}.sav`);
    let saveBytes = new Uint8Array();
    try {
      saveBytes = await fs.promises.readFile(this.saveFile);
    } catch {
      // First time playing this game.
    }

    const M = this.Module;
    const romPtr = this.alloc(romBytes);
    const savePtr = this.alloc(saveBytes);
    const namePtr = this.alloc(Buffer.from(`${romName}\0`));
    const ok = M._pilas_load_rom(this.instance, romPtr, romBytes.length, savePtr, saveBytes.length, namePtr);
    this.free(romPtr);
    this.free(savePtr);
    this.free(namePtr);
    if (!ok) {
      this.romPath = "";
      this.broadcastStatus(this.lastError() || "Falha ao carregar a ROM");
      return false;
    }

    this.romPath = romPath;
    this.paused = false;
    this.keyMask = 0xFFF;
    this.wantedMask = 0xFFF;
    this.touchReleasePending = false;
    M._pilas_set_key_mask(this.instance, this.keyMask);
    M._pilas_set_touch(this.instance, 0, 0, 0);
    this.setRtc();
    this.start();
    this.broadcastStatus("Jogando");
    return true;
  }

  setRtc() {
    const now = new Date();
    this.Module._pilas_set_rtc(this.instance, now.getFullYear(), now.getMonth() + 1, now.getDate(),
      now.getHours(), now.getMinutes(), now.getSeconds());
  }

  start() {
    if (this.timer) return;
    this.lastTick = performance.now();
    this.fpsTime = this.lastTick;
    this.accumulator = 0;
    this.timer = setInterval(() => this.tick(), 4);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  running() {
    return Boolean(this.romPath) && !this.paused && this.clients.size > 0;
  }

  tick() {
    const now = performance.now();
    const M = this.Module;
    if (!this.running()) {
      this.lastTick = now;
      this.accumulator = 0;
      return;
    }

    this.accumulator += Math.min(now - this.lastTick, 250) * this.speed;
    this.lastTick = now;
    const maxFrames = MAX_FRAMES_PER_TICK * this.speed;
    let frames = 0;
    while (this.accumulator >= FRAME_INTERVAL_MS && frames < maxFrames) {
      this.applyDeferredReleases();
      M._pilas_run_frame(this.instance);
      this.frameCount++;
      // Nothing plays the audio, but draining it keeps the core's ring buffer from filling.
      M._pilas_pull_audio(this.instance, this.audioPtr, AUDIO_FRAMES);
      this.accumulator -= FRAME_INTERVAL_MS;
      frames++;
    }
    if (this.accumulator > FRAME_INTERVAL_MS * maxFrames) this.accumulator = 0;

    if (frames > 0) {
      this.fpsFrames += frames;
      this.frameReady = true;
      this.sendFrame();
    }

    if (now - this.fpsTime >= 1000) {
      this.fps = (this.fpsFrames * 1000) / (now - this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = now;
      this.broadcast({ t: "stats", fps: Math.round(this.fps) });
    }
    if (now - this.lastSavePoll >= SAVE_POLL_MS) {
      this.flushSave(false);
      this.lastSavePoll = now;
    }
    if (now - this.lastRtc >= 1000) {
      this.setRtc();
      this.lastRtc = now;
    }
  }

  setKeys(mask) {
    this.wantedMask = mask;
    for (let bit = 0; bit < 12; bit++) {
      const pressedNow = (mask & (1 << bit)) === 0;
      const pressedBefore = (this.keyMask & (1 << bit)) === 0;
      if (pressedNow && !pressedBefore) {
        this.keyMask &= ~(1 << bit);
        this.pressFrame[bit] = this.frameCount;
      }
    }
    this.applyDeferredReleases();
  }

  setTouch(x, y, down) {
    const M = this.Module;
    if (down) {
      if (!this.touch) this.touchFrame = this.frameCount;
      this.touch = { x, y };
      this.touchReleasePending = false;
      M._pilas_set_touch(this.instance, x, y, 1);
    } else if (this.touch) {
      this.touchReleasePending = true;
      this.applyDeferredReleases();
    }
  }

  applyDeferredReleases() {
    const M = this.Module;
    for (let bit = 0; bit < 12; bit++) {
      const wantsRelease = (this.wantedMask & (1 << bit)) !== 0;
      const held = (this.keyMask & (1 << bit)) === 0;
      if (wantsRelease && held && this.frameCount - this.pressFrame[bit] >= MIN_HOLD_FRAMES) {
        this.keyMask |= 1 << bit;
      }
    }
    M._pilas_set_key_mask(this.instance, this.keyMask);
    if (this.touchReleasePending && this.frameCount - this.touchFrame >= MIN_HOLD_FRAMES) {
      this.touch = null;
      this.touchReleasePending = false;
      M._pilas_set_touch(this.instance, 0, 0, 0);
    }
  }

  sendFrame() {
    if (!this.frameReady || this.encoding) return;
    const targets = [...this.clients].filter((client) => client.inFlight < MAX_FRAMES_IN_FLIGHT);
    if (targets.length === 0) return;

    const M = this.Module;
    const ptr = M._pilas_get_framebuffer_ptr(this.instance);
    if (!ptr || M._pilas_get_framebuffer_size(this.instance) < FRAME_BYTES) return;
    const raw = Buffer.from(M.HEAPU8.subarray(ptr, ptr + FRAME_BYTES));
    this.frameReady = false;
    this.encoding = true;

    sharp(raw, { raw: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, channels: 4 } })
      .removeAlpha()
      .jpeg({ quality: this.jpegQuality, chromaSubsampling: "4:4:4" })
      .toBuffer()
      .then((jpeg) => {
        for (const client of targets) {
          if (client.socket.readyState !== 1) continue;
          client.inFlight++;
          client.socket.send(jpeg, { binary: true });
        }
      })
      .catch((error) => console.error("Falha ao codificar quadro:", error.message))
      .finally(() => {
        this.encoding = false;
      });
  }

  flushSave(force) {
    if (!this.romPath || !this.Module) return;
    const M = this.Module;
    if (!M._pilas_take_nds_save_dirty(this.instance) && !force) return;
    const ptr = M._pilas_get_nds_save_ptr(this.instance);
    const len = M._pilas_get_nds_save_length(this.instance);
    if (!ptr || len <= 0) return;
    try {
      fs.writeFileSync(this.saveFile, M.HEAPU8.subarray(ptr, ptr + len));
    } catch (error) {
      console.error("Falha ao gravar o save:", error.message);
    }
  }

  statePath(slot) {
    return path.join(this.saveDir, `${this.stem()}.slot${slot}.state`);
  }

  saveState(slot) {
    const M = this.Module;
    if (!M._pilas_save_state(this.instance)) return this.broadcastStatus("Falha ao salvar o estado");
    const ptr = M._pilas_get_state_ptr(this.instance);
    const len = M._pilas_get_state_length(this.instance);
    fs.writeFileSync(this.statePath(slot), M.HEAPU8.subarray(ptr, ptr + len));
    this.broadcastStatus(`Estado salvo no slot ${slot}`);
  }

  loadState(slot) {
    let bytes;
    try {
      bytes = fs.readFileSync(this.statePath(slot));
    } catch {
      return this.broadcastStatus(`Slot ${slot} vazio`);
    }
    const ptr = this.alloc(bytes);
    const ok = this.Module._pilas_load_state(this.instance, ptr, bytes.length);
    this.free(ptr);
    this.broadcastStatus(ok ? `Estado do slot ${slot} carregado` : "Falha ao carregar o estado");
  }

  handleMessage(client, message) {
    if (!this.romPath) return;
    const M = this.Module;
    switch (message.t) {
      case "ack":
        client.inFlight = Math.max(0, client.inFlight - 1);
        this.sendFrame();
        break;
      case "keys":
        this.setKeys(Number(message.mask) & 0xFFF);
        break;
      case "touch": {
        const x = Math.max(0, Math.min(255, Math.floor(Number(message.x) || 0)));
        const y = Math.max(0, Math.min(191, Math.floor(Number(message.y) || 0)));
        this.setTouch(x, y, Boolean(message.down));
        break;
      }
      case "pause":
        this.paused = !this.paused;
        if (this.paused) this.flushSave(false);
        this.broadcastStatus(this.paused ? "Pausado" : "Jogando");
        break;
      case "turbo":
        this.speed = message.on ? TURBO_SPEED : 1;
        this.broadcast({ t: "turbo", on: this.speed > 1 });
        break;
      case "reset":
        M._pilas_reset(this.instance);
        this.paused = false;
        this.broadcastStatus("Reiniciado");
        break;
      case "quality": {
        const quality = Number(message.value);
        if (quality >= 30 && quality <= 95) this.jpegQuality = quality;
        break;
      }
      case "save-state":
      case "load-state": {
        const slot = Number(message.slot);
        if (!Number.isInteger(slot) || slot < 1 || slot > STATE_SLOTS) return;
        if (message.t === "save-state") this.saveState(slot);
        else this.loadState(slot);
        break;
      }
      default:
        break;
    }
  }

  addClient(socket) {
    const client = { socket, inFlight: 0 };
    this.clients.add(client);
    return client;
  }

  removeClient(client) {
    this.clients.delete(client);
    if (this.clients.size === 0) {
      this.speed = 1;
      this.flushSave(false);
      if (this.romPath) {
        this.setKeys(0xFFF);
        this.setTouch(0, 0, false);
      }
    }
  }

  broadcast(payload) {
    const text = JSON.stringify(payload);
    for (const client of this.clients) {
      if (client.socket.readyState === 1) client.socket.send(text);
    }
  }

  broadcastStatus(message) {
    this.broadcast({ t: "status", message, paused: this.paused, rom: this.romName });
  }

  shutdown() {
    this.flushSave(false);
    this.stop();
  }
}

module.exports = { StreamSession };
