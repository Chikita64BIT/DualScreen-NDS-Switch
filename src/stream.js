// Thin client for the Switch browser: the PC runs melonDS and sends JPEG frames
// over a WebSocket; this page draws them and sends buttons and touches back.
// Kept to older JavaScript syntax because the console's WebKit is old.
(function () {
  "use strict";

  var SCREEN_W = 256;
  var SCREEN_H = 192;
  var QUALITY_LEVELS = [
    { label: "baixa", value: 55 },
    { label: "média", value: 80 },
    { label: "alta", value: 92 },
  ];
  var KEY_BITS = {
    KeyX: 0, KeyZ: 1, ShiftRight: 2, ShiftLeft: 2, Enter: 3,
    ArrowRight: 4, ArrowLeft: 5, ArrowUp: 6, ArrowDown: 7,
    KeyW: 8, KeyQ: 9, KeyS: 10, KeyA: 11,
  };
  // Gamepad API "standard" indices. On the Switch, 0 is the bottom face button (B),
  // 1 the right one (A), 3 the top (X), 2 the left (Y), 6/7 are ZL/ZR.
  var PAD_TARGETS = [
    { id: 0, label: "A" }, { id: 1, label: "B" }, { id: 10, label: "X" }, { id: 11, label: "Y" },
    { id: 9, label: "L" }, { id: 8, label: "R" }, { id: 3, label: "START" }, { id: 2, label: "SELECT" },
    { id: 6, label: "Cima" }, { id: 7, label: "Baixo" }, { id: 5, label: "Esquerda" }, { id: 4, label: "Direita" },
    { id: "turbo", label: "Turbo (segurar)" }, { id: "menu", label: "Abrir o menu" },
  ];
  var DEFAULT_PAD_MAP = { 0: 1, 1: 0, 10: 3, 11: 2, 9: 4, 8: 5, 3: 9, 2: 8, 6: 12, 7: 13, 5: 14, 4: 15, turbo: 6, menu: 7 };

  var params = new URLSearchParams(location.search);
  var romPath = params.get("rom") || "";

  var app = document.getElementById("app");
  var screens = document.getElementById("screens");
  var topCanvas = document.getElementById("topScreen");
  var bottomCanvas = document.getElementById("bottomScreen");
  var topCtx = topCanvas.getContext("2d");
  var bottomCtx = bottomCanvas.getContext("2d");
  var gameTitle = document.getElementById("gameTitle");
  var fpsValue = document.getElementById("fpsValue");
  var overlay = document.getElementById("overlay");
  var overlayText = document.getElementById("overlayText");
  var spinner = document.getElementById("spinner");
  var menu = document.getElementById("menu");
  var pauseButton = document.getElementById("pauseButton");
  var layoutButton = document.getElementById("layoutButton");
  var qualityButton = document.getElementById("qualityButton");
  var toast = document.getElementById("toast");
  var turboBadge = document.getElementById("turboBadge");
  var padStatus = document.getElementById("padStatus");
  var padMapText = document.getElementById("padMapText");
  var captureBox = document.getElementById("captureBox");
  var captureText = document.getElementById("captureText");

  var socket = null;
  var reconnectTimer = null;
  var gotFrame = false;
  var frameImage = new Image();
  var frameUrl = "";
  var drawing = false;
  var pendingBlob = null;
  var toastTimer = null;

  // Each input source keeps its own active-low mask; the core sees their AND.
  var touchMask = 0xFFF;
  var keyMask = 0xFFF;
  var padMask = 0xFFF;
  var sentMask = -1;
  var activeTouches = {};
  var screenTouchId = null;
  var mouseDown = false;

  var padMap = loadPadMap();
  var padTurbo = false;
  var keyTurbo = false;
  var sentTurbo = null;
  var lastPadButtons = [];
  var lastPadActivity = 0;
  var capture = null;

  var layout = readSetting("layout", "stack");
  var qualityIndex = Number(readSetting("quality", "1"));
  if (!(qualityIndex >= 0 && qualityIndex < QUALITY_LEVELS.length)) qualityIndex = 1;

  function readSetting(key, fallback) {
    try {
      var value = localStorage.getItem("dualscreen-stream-" + key);
      return value === null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function writeSetting(key, value) {
    try {
      localStorage.setItem("dualscreen-stream-" + key, String(value));
    } catch (error) {
      // Settings are a convenience only.
    }
  }

  function send(payload) {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(payload));
  }

  function showOverlay(text, busy) {
    overlayText.textContent = text;
    spinner.className = busy ? "spinner" : "spinner hidden";
    overlay.hidden = false;
  }

  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 2200);
  }

  // ---- Connection ----

  function connect() {
    clearTimeout(reconnectTimer);
    var protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(protocol + "//" + location.host + "/ws");
    socket.binaryType = "blob";
    socket.onopen = function () {
      showOverlay("Iniciando o jogo no PC…", true);
      send({ t: "quality", value: QUALITY_LEVELS[qualityIndex].value });
      send({ t: "start", rom: romPath });
      sentMask = -1;
      sentTurbo = null;
      flushMask();
      flushTurbo();
    };
    socket.onmessage = function (event) {
      if (typeof event.data === "string") handleText(event.data);
      else handleFrame(event.data);
    };
    socket.onclose = function () {
      socket = null;
      showOverlay("Conexão com o PC perdida. Tentando reconectar…", true);
      reconnectTimer = setTimeout(connect, 2000);
    };
  }

  function handleText(text) {
    var message;
    try {
      message = JSON.parse(text);
    } catch (error) {
      return;
    }
    if (message.t === "turbo") {
      turboBadge.hidden = !message.on;
    } else if (message.t === "stats") {
      fpsValue.textContent = String(message.fps);
    } else if (message.t === "status") {
      if (message.rom) gameTitle.textContent = message.rom.replace(/\.[^.]+$/, "");
      if (message.error) {
        showOverlay(message.message, false);
        return;
      }
      pauseButton.textContent = message.paused ? "Continuar" : "Pausar";
      if (message.paused) showOverlay("Pausado", false);
      else if (gotFrame) overlay.hidden = true;
      if (message.message && message.message !== "Jogando") showToast(message.message);
    }
  }

  function handleFrame(blob) {
    if (drawing) {
      // Only the newest frame matters; acknowledge the dropped one right away.
      if (pendingBlob) send({ t: "ack" });
      pendingBlob = blob;
      return;
    }
    drawFrame(blob);
  }

  function drawFrame(blob) {
    drawing = true;
    frameUrl = URL.createObjectURL(blob);
    frameImage.src = frameUrl;
  }

  frameImage.onload = function () {
    topCtx.drawImage(frameImage, 0, 0, SCREEN_W, SCREEN_H, 0, 0, SCREEN_W, SCREEN_H);
    bottomCtx.drawImage(frameImage, 0, SCREEN_H, SCREEN_W, SCREEN_H, 0, 0, SCREEN_W, SCREEN_H);
    finishFrame();
    if (!gotFrame) {
      gotFrame = true;
      overlay.hidden = true;
    }
  };
  frameImage.onerror = finishFrame;

  function finishFrame() {
    URL.revokeObjectURL(frameUrl);
    drawing = false;
    send({ t: "ack" });
    if (pendingBlob) {
      var next = pendingBlob;
      pendingBlob = null;
      drawFrame(next);
    }
  }

  // ---- Layout ----

  function applyLayout() {
    app.setAttribute("data-layout", layout);
    layoutButton.textContent = layout === "stack" ? "Telas lado a lado" : "Telas empilhadas";
    qualityButton.textContent = "Qualidade: " + QUALITY_LEVELS[qualityIndex].label;
    resizeScreens();
  }

  function resizeScreens() {
    var area = screens.parentNode;
    var availH = area.clientHeight;
    // Only Start and Select stay on screen, so the screens get everything but two narrow columns.
    var availW = window.innerWidth - 2 * 120;
    var scale;
    if (layout === "stack") scale = Math.min((availH - 4) / (SCREEN_H * 2), availW / SCREEN_W);
    else scale = Math.min(availH / SCREEN_H, (availW - 4) / (SCREEN_W * 2));
    scale = Math.max(scale, 0.5);
    var w = Math.floor(SCREEN_W * scale);
    var h = Math.floor(SCREEN_H * scale);
    topCanvas.style.width = bottomCanvas.style.width = w + "px";
    topCanvas.style.height = bottomCanvas.style.height = h + "px";
    topCanvas.style.margin = layout === "stack" ? "0 0 4px 0" : "0 4px 0 0";
    screens.style.width = (layout === "stack" ? w : w * 2 + 4) + "px";
  }

  window.addEventListener("resize", resizeScreens);
  window.addEventListener("load", resizeScreens);

  // ---- Input ----

  function flushMask() {
    var mask = touchMask & keyMask & padMask;
    if (mask === sentMask) return;
    sentMask = mask;
    send({ t: "keys", mask: mask });
  }

  function flushTurbo() {
    var on = (padTurbo || keyTurbo) && menu.hidden && !capture;
    if (on === sentTurbo) return;
    sentTurbo = on;
    send({ t: "turbo", on: on });
  }

  function screenPoint(clientX, clientY) {
    var rect = bottomCanvas.getBoundingClientRect();
    var x = (clientX - rect.left) * SCREEN_W / rect.width;
    var y = (clientY - rect.top) * SCREEN_H / rect.height;
    if (x < 0 || y < 0 || x >= SCREEN_W || y >= SCREEN_H) return null;
    return { x: x, y: y };
  }

  function buttonAt(clientX, clientY) {
    var el = document.elementFromPoint(clientX, clientY);
    while (el && el !== document.body) {
      if (el.getAttribute && el.getAttribute("data-bit") !== null) return el;
      el = el.parentNode;
    }
    return null;
  }

  function refreshTouchButtons() {
    var mask = 0xFFF;
    var pressed = {};
    for (var id in activeTouches) {
      var el = activeTouches[id];
      if (!el) continue;
      var bit = Number(el.getAttribute("data-bit"));
      mask &= ~(1 << bit);
      pressed[bit] = true;
    }
    var buttons = document.querySelectorAll("[data-bit]");
    for (var i = 0; i < buttons.length; i++) {
      var on = pressed[Number(buttons[i].getAttribute("data-bit"))] || ((keyMask & padMask) & (1 << Number(buttons[i].getAttribute("data-bit")))) === 0;
      buttons[i].className = buttons[i].className.replace(/\s*pressed/g, "") + (on ? " pressed" : "");
    }
    touchMask = mask;
    flushMask();
  }

  function sendScreenTouch(point) {
    if (point) send({ t: "touch", x: point.x, y: point.y, down: true });
    else send({ t: "touch", x: 0, y: 0, down: false });
  }

  function onTouchStart(event) {
    if (!menu.hidden) return;
    event.preventDefault();
    for (var i = 0; i < event.changedTouches.length; i++) {
      var t = event.changedTouches[i];
      var point = screenPoint(t.clientX, t.clientY);
      if (point && screenTouchId === null) {
        screenTouchId = t.identifier;
        sendScreenTouch(point);
      } else {
        activeTouches[t.identifier] = buttonAt(t.clientX, t.clientY);
      }
    }
    refreshTouchButtons();
  }

  function onTouchMove(event) {
    if (!menu.hidden) return;
    event.preventDefault();
    for (var i = 0; i < event.changedTouches.length; i++) {
      var t = event.changedTouches[i];
      if (t.identifier === screenTouchId) {
        var point = screenPoint(t.clientX, t.clientY);
        if (point) sendScreenTouch(point);
      } else if (t.identifier in activeTouches) {
        // Sliding a thumb between buttons (e.g. across the D-pad) follows the thumb.
        activeTouches[t.identifier] = buttonAt(t.clientX, t.clientY);
      }
    }
    refreshTouchButtons();
  }

  function onTouchEnd(event) {
    for (var i = 0; i < event.changedTouches.length; i++) {
      var t = event.changedTouches[i];
      if (t.identifier === screenTouchId) {
        screenTouchId = null;
        sendScreenTouch(null);
      }
      delete activeTouches[t.identifier];
    }
    refreshTouchButtons();
  }

  var playArea = document.querySelector(".play-area");
  playArea.addEventListener("touchstart", onTouchStart, { passive: false });
  playArea.addEventListener("touchmove", onTouchMove, { passive: false });
  playArea.addEventListener("touchend", onTouchEnd);
  playArea.addEventListener("touchcancel", onTouchEnd);

  // Mouse support, for testing from a PC browser.
  playArea.addEventListener("mousedown", function (event) {
    var point = screenPoint(event.clientX, event.clientY);
    mouseDown = true;
    if (point) {
      screenTouchId = "mouse";
      sendScreenTouch(point);
    } else {
      activeTouches.mouse = buttonAt(event.clientX, event.clientY);
      refreshTouchButtons();
    }
  });
  window.addEventListener("mousemove", function (event) {
    if (!mouseDown || screenTouchId !== "mouse") return;
    var point = screenPoint(event.clientX, event.clientY);
    if (point) sendScreenTouch(point);
  });
  window.addEventListener("mouseup", function () {
    if (!mouseDown) return;
    mouseDown = false;
    if (screenTouchId === "mouse") {
      screenTouchId = null;
      sendScreenTouch(null);
    }
    delete activeTouches.mouse;
    refreshTouchButtons();
  });

  window.addEventListener("keydown", function (event) {
    if (event.code === "Space") {
      event.preventDefault();
      keyTurbo = true;
      flushTurbo();
      return;
    }
    if (event.code === "Escape" || event.key === "Escape" || event.keyCode === 27) {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      toggleMenu();
      return;
    }
    if (!(event.code in KEY_BITS) || !menu.hidden) return;
    event.preventDefault();
    keyMask &= ~(1 << KEY_BITS[event.code]);
    refreshTouchButtons();
  });
  window.addEventListener("keyup", function (event) {
    if (event.code === "Space") {
      keyTurbo = false;
      flushTurbo();
    }
    if (!(event.code in KEY_BITS)) return;
    keyMask |= 1 << KEY_BITS[event.code];
    refreshTouchButtons();
  });

  function loadPadMap() {
    var map = {};
    for (var key in DEFAULT_PAD_MAP) map[key] = DEFAULT_PAD_MAP[key];
    try {
      var saved = JSON.parse(readSetting("padmap", "{}"));
      for (var id in saved) if (id in map && typeof saved[id] === "number") map[id] = saved[id];
    } catch (error) {
      // Fall back to the default layout.
    }
    return map;
  }

  function firstGamepad() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var i = 0; i < pads.length; i++) if (pads[i]) return pads[i];
    return null;
  }

  function isDown(pad, index) {
    var button = pad.buttons[index];
    return Boolean(button && (button.pressed || button.value > 0.5));
  }

  function pollGamepad() {
    var pad = firstGamepad();
    var mask = 0xFFF;
    var now = Date.now();
    if (pad) {
      var pressedNow = [];
      for (var i = 0; i < pad.buttons.length; i++) {
        pressedNow[i] = isDown(pad, i);
        if (pressedNow[i]) lastPadActivity = now;
        if (pressedNow[i] && !lastPadButtons[i]) onPadButtonDown(i);
      }
      lastPadButtons = pressedNow;

      if (menu.hidden && !capture) {
        for (var bit = 0; bit < 12; bit++) {
          if (isDown(pad, padMap[bit])) mask &= ~(1 << bit);
        }
        // The left stick always works as the D-pad too.
        if (pad.axes[0] > 0.5) mask &= ~(1 << 4);
        if (pad.axes[0] < -0.5) mask &= ~(1 << 5);
        if (pad.axes[1] < -0.5) mask &= ~(1 << 6);
        if (pad.axes[1] > 0.5) mask &= ~(1 << 7);
        if (mask !== 0xFFF) lastPadActivity = now;
      }
      padTurbo = isDown(pad, padMap.turbo);
      padStatus.textContent = "Controle detectado: " + (pad.id || "sem nome");
    }
    if (mask !== padMask) {
      padMask = mask;
      refreshTouchButtons();
    }
    flushTurbo();
  }
  if (navigator.getGamepads) setInterval(pollGamepad, 16);

  function onPadButtonDown(index) {
    if (capture) {
      padMap[PAD_TARGETS[capture.step].id] = index;
      capture.step++;
      showCaptureStep();
      return;
    }
    if (index === padMap.menu) toggleMenu();
  }

  // ---- Button setup ----

  function showCaptureStep() {
    if (capture.step >= PAD_TARGETS.length) {
      writeSetting("padmap", JSON.stringify(padMap));
      capture = null;
      captureBox.hidden = true;
      showToast("Botões configurados");
      renderPadMap();
      return;
    }
    captureText.textContent = "Aperte no controle o botão para: " + PAD_TARGETS[capture.step].label +
      " (" + (capture.step + 1) + " de " + PAD_TARGETS.length + ")";
  }

  function renderPadMap() {
    var parts = [];
    for (var i = 0; i < PAD_TARGETS.length; i++) {
      parts.push(PAD_TARGETS[i].label + " = botão " + padMap[PAD_TARGETS[i].id]);
    }
    padMapText.textContent = parts.join(" · ");
  }

  // ---- Menu ----

  function toggleMenu(open) {
    var show = typeof open === "boolean" ? open : menu.hidden;
    menu.hidden = !show;
    flushTurbo();
    if (show) {
      activeTouches = {};
      keyMask = 0xFFF;
      if (screenTouchId !== null) sendScreenTouch(null);
      screenTouchId = null;
      refreshTouchButtons();
    }
  }

  document.getElementById("menuButton").addEventListener("click", function () { toggleMenu(true); });
  menu.addEventListener("click", function (event) {
    var target = event.target;
    if (target === menu) {
      toggleMenu(false);
      return;
    }
    var action = target.getAttribute && target.getAttribute("data-action");
    if (!action) return;
    if (action === "close") {
      toggleMenu(false);
    } else if (action === "layout") {
      layout = layout === "stack" ? "side" : "stack";
      writeSetting("layout", layout);
      applyLayout();
    } else if (action === "quality") {
      qualityIndex = (qualityIndex + 1) % QUALITY_LEVELS.length;
      writeSetting("quality", qualityIndex);
      send({ t: "quality", value: QUALITY_LEVELS[qualityIndex].value });
      applyLayout();
    } else if (action === "pad-setup") {
      capture = { step: 0 };
      captureBox.hidden = false;
      showCaptureStep();
    } else if (action === "pad-cancel") {
      capture = null;
      captureBox.hidden = true;
      padMap = loadPadMap();
      renderPadMap();
    } else if (action === "pad-reset") {
      writeSetting("padmap", "{}");
      padMap = loadPadMap();
      renderPadMap();
      showToast("Botões padrão restaurados");
    } else if (action === "save-state" || action === "load-state") {
      send({ t: action, slot: Number(target.getAttribute("data-slot")) });
      toggleMenu(false);
    } else {
      send({ t: action });
      if (action === "reset") toggleMenu(false);
    }
  });

  // The Switch's B button also means "back" in its browser. Stay on the page; when
  // the controller is in use, B is a game button, otherwise "back" opens the menu.
  if (window.history && history.pushState) {
    history.pushState({ dualscreen: true }, "", location.href);
    window.addEventListener("popstate", function () {
      history.pushState({ dualscreen: true }, "", location.href);
      if (Date.now() - lastPadActivity > 1000) toggleMenu();
    });
  }

  if (!romPath) {
    showOverlay("Nenhum jogo escolhido. Volte à biblioteca.", false);
    gameTitle.textContent = "DualScreen";
  } else {
    gameTitle.textContent = decodeURIComponent(romPath.split("/").pop()).replace(/\.[^.]+$/, "");
    connect();
  }
  applyLayout();
  renderPadMap();
}());
