/* ============================================================================
 * sensors.js — where sensor data comes from.
 *
 * Three sources, one exit. Whatever the source, a message is turned into the
 * same normalised reading and handed to SHD.state.applyReading():
 *
 *   { buildingId, type, areaId|areaName, value, unit, timestamp, source }
 *
 *   1. DEMO DATA          a simulator that runs entirely in the browser
 *   2. LIVE DATA (MQTT)   MQTT over WebSockets, using MQTT.js
 *   3. LIVE DATA (SOCKET) a plain WebSocket server sending JSON
 *
 * The demo simulator and the live adapters never touch the UI directly, and
 * the UI never talks to the broker. Swapping one for the other changes nothing
 * anywhere else in the project.
 * ========================================================================== */

window.SHD = window.SHD || {};

SHD.sensors = (function () {
  "use strict";

  var cfg = SHD.config;

  var mode = null;              // "demo" | "mqtt" | "websocket"
  var settings = {};            // runtime overrides from the Settings dialog
  var link = { state: "idle", message: "Starting" };
  var linkListeners = [];

  var timers = {};              // demo timers, keyed so each area owns its own
  var lastValues = {};          // demo random walk memory
  var client = null;            // MQTT.js client
  var socket = null;            // WebSocket
  var socketRetry = null;

  /* ---------------------------------------------------------------- helpers */

  function rand(min, max) { return min + Math.random() * (max - min); }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function baseTopic() { return settings.baseTopic || cfg.mqtt.baseTopic; }

  function setLink(state, message) {
    link = { state: state, message: message };
    for (var i = 0; i < linkListeners.length; i += 1) linkListeners[i](link);
  }

  /** Single exit point for every source. */
  function ingest(reading) {
    reading.source = reading.source || mode;
    SHD.state.applyReading(reading);
  }

  /* ============================================================ 1. DEMO DATA
   * Everything below is simulation. It stops the moment a live source is
   * selected, and can be deleted once the real sensors are connected.
   * ------------------------------------------------------------------------ */

  function envKey(buildingId, type) { return "env:" + buildingId + ":" + type; }
  function motionKey(buildingId, areaId) { return "motion:" + buildingId + ":" + areaId; }

  function startEnvTimer(key, building, type) {
    var spec = cfg.demo[type];
    var unit = type === "temperature" ? cfg.display.temperatureUnit : cfg.display.humidityUnit;
    lastValues[key] = spec.startAt;

    function tick() {
      var next = clamp(lastValues[key] + rand(-spec.maxStep, spec.maxStep), spec.min, spec.max);
      lastValues[key] = next;
      ingest({
        buildingId: building.id,
        type: type,
        value: next,
        unit: unit,
        timestamp: Date.now(),
        source: "demo"
      });
    }

    tick();                                   // one reading straight away
    timers[key] = setInterval(tick, spec.intervalMs);
  }

  function startMotionTimer(key, buildingId, areaId) {
    var m = cfg.demo.motion;

    function goClear() {
      ingest({ buildingId: buildingId, type: "motion", areaId: areaId, value: "CLEAR", timestamp: Date.now(), source: "demo" });
      timers[key] = setTimeout(goActive, rand(m.quietMinMs, m.quietMaxMs));
    }

    function goActive() {
      ingest({ buildingId: buildingId, type: "motion", areaId: areaId, value: "DETECTED", timestamp: Date.now(), source: "demo" });
      timers[key] = setTimeout(goClear, rand(m.activeMinMs, m.activeMaxMs));
    }

    // First reading is immediate so the card leaves "Waiting", then this area
    // gets a head start of its own. Two areas added in the same second still
    // drift apart, because both the stagger and the quiet gap are drawn
    // separately for each one.
    ingest({ buildingId: buildingId, type: "motion", areaId: areaId, value: "CLEAR", timestamp: Date.now(), source: "demo" });
    timers[key] = setTimeout(goActive, rand(0, m.startStaggerMaxMs) + rand(m.quietMinMs, m.quietMaxMs));
  }

  /**
   * Creates timers for anything new and clears timers for anything deleted.
   * Existing schedules are left alone, so adding a fifth area does not reset
   * the other four.
   */
  function syncDemoTimers() {
    if (mode !== "demo") return;

    var wanted = {};
    SHD.state.getBuildings().forEach(function (building) {
      wanted[envKey(building.id, "temperature")] = { kind: "temperature", building: building };
      wanted[envKey(building.id, "humidity")] = { kind: "humidity", building: building };
      building.areas.forEach(function (area) {
        wanted[motionKey(building.id, area.id)] = { kind: "motion", building: building, area: area };
      });
    });

    Object.keys(timers).forEach(function (key) {
      if (!wanted[key]) {
        clearTimeout(timers[key]);
        clearInterval(timers[key]);
        delete timers[key];
        delete lastValues[key];
      }
    });

    Object.keys(wanted).forEach(function (key) {
      if (timers[key]) return;
      var item = wanted[key];
      if (item.kind === "motion") startMotionTimer(key, item.building.id, item.area.id);
      else startEnvTimer(key, item.building, item.kind);
    });
  }

  function stopDemo() {
    Object.keys(timers).forEach(function (key) {
      clearTimeout(timers[key]);
      clearInterval(timers[key]);
    });
    timers = {};
    lastValues = {};
  }

  /* ==================================================== 2. LIVE DATA — MQTT
   * A browser cannot open the plain TCP port 1883 that the Python scripts
   * publish to. The broker needs a websockets listener as well; see README.md.
   * ------------------------------------------------------------------------ */

  /** Turns an MQTT topic into the parts of a reading, or null if unrecognised. */
  function parseTopic(topic) {
    var legacy = cfg.legacyTopics[topic];
    if (legacy) {
      return {
        buildingId: cfg.legacyBuildingId,     // null routes to the active building
        type: legacy.type,
        areaName: legacy.areaName || null
      };
    }

    var parts = topic.split("/");
    if (parts[0] !== baseTopic()) return null;

    if (parts.length === 3 && (parts[2] === "temperature" || parts[2] === "humidity")) {
      return { buildingId: parts[1], type: parts[2] };
    }
    if (parts.length === 4 && parts[2] === "motion") {
      return { buildingId: parts[1], type: "motion", areaId: parts[3] };
    }
    return null;
  }

  /** Payloads such as "22.4°C", "61%", "DETECTED" or plain JSON all work. */
  function parsePayload(type, payload) {
    var text = String(payload).trim();

    if (text.charAt(0) === "{") {
      try {
        var body = JSON.parse(text);
        if (body && typeof body === "object" && "value" in body) {
          return { value: body.value, unit: body.unit || null };
        }
      } catch (err) { /* not JSON after all — fall through */ }
    }

    if (type === "motion") return { value: text, unit: null };
    if (type === "temperature") return { value: text, unit: /f\b|°\s*f/i.test(text) ? "°F" : cfg.display.temperatureUnit };
    return { value: text, unit: cfg.display.humidityUnit };
  }

  function handleMqttMessage(topic, payload, packet) {
    var parsed = parseTopic(topic);
    if (!parsed) return;                       // topic outside our scheme

    var body = parsePayload(parsed.type, payload);
    ingest({
      buildingId: parsed.buildingId,
      type: parsed.type,
      areaId: parsed.areaId || null,
      areaName: parsed.areaName || null,
      value: body.value,
      unit: body.unit,
      timestamp: Date.now(),
      source: (packet && packet.retain) ? "mqtt (retained)" : "mqtt"
    });
  }

  function startMqtt() {
    if (typeof window.mqtt === "undefined") {
      setLink("error", "MQTT library not loaded");
      return;
    }

    var url = settings.mqttUrl || cfg.mqtt.url;
    setLink("connecting", "Connecting to " + url);

    var options = {
      clientId: cfg.mqtt.clientIdPrefix + Math.random().toString(16).slice(2, 8),
      clean: true,
      reconnectPeriod: cfg.mqtt.reconnectPeriodMs,
      connectTimeout: cfg.mqtt.connectTimeoutMs
    };
    if (cfg.mqtt.username) { options.username = cfg.mqtt.username; options.password = cfg.mqtt.password; }

    try {
      client = window.mqtt.connect(url, options);
    } catch (err) {
      setLink("error", "Could not open " + url);
      return;
    }

    client.on("connect", function () {
      var filter = cfg.topics.subscribe(baseTopic());
      client.subscribe(filter, { qos: cfg.mqtt.qos }, function (err) {
        if (err) setLink("error", "Subscribe to " + filter + " failed");
        else setLink("live", "Subscribed to " + filter);
      });
    });

    client.on("message", handleMqttMessage);
    client.on("reconnect", function () { setLink("connecting", "Reconnecting"); });
    client.on("offline", function () { setLink("retrying", "Broker unreachable"); });
    client.on("close", function () { if (link.state === "live") setLink("retrying", "Connection closed"); });
    client.on("error", function (err) { setLink("error", (err && err.message) || "Broker error"); });
  }

  function stopMqtt() {
    if (!client) return;
    try { client.end(true); } catch (err) { /* already gone */ }
    client = null;
  }

  /* ================================================ 3. LIVE DATA — WEBSOCKET
   * For a Python bridge that reads MQTT and forwards JSON to the browser.
   * ------------------------------------------------------------------------ */

  function startSocket() {
    var url = settings.wsUrl || cfg.websocket.url;
    setLink("connecting", "Connecting to " + url);

    try {
      socket = new WebSocket(url);
    } catch (err) {
      setLink("error", "Could not open " + url);
      return;
    }

    socket.onopen = function () { setLink("live", "Receiving from " + url); };

    socket.onmessage = function (event) {
      var body;
      try { body = JSON.parse(event.data); } catch (err) { return; }
      if (!body || !body.type) return;

      ingest({
        buildingId: body.building || body.buildingId || null,
        type: body.type,
        areaId: body.area || body.areaId || null,
        areaName: body.areaName || null,
        value: body.value,
        unit: body.unit || null,
        timestamp: body.timestamp || Date.now(),
        source: "websocket"
      });
    };

    socket.onerror = function () { setLink("error", "WebSocket error"); };

    socket.onclose = function () {
      setLink("retrying", "Reconnecting in " + Math.round(cfg.websocket.reconnectDelayMs / 1000) + "s");
      socketRetry = setTimeout(function () { if (mode === "websocket") startSocket(); }, cfg.websocket.reconnectDelayMs);
    };
  }

  function stopSocket() {
    clearTimeout(socketRetry);
    socketRetry = null;
    if (!socket) return;
    socket.onclose = null;                     // stop the retry loop
    try { socket.close(); } catch (err) { /* already closed */ }
    socket = null;
  }

  /* ------------------------------------------------------------------- api */

  function stop() {
    stopDemo();
    stopMqtt();
    stopSocket();
    mode = null;
  }

  var api = {
    /** @param {"demo"|"mqtt"|"websocket"} next */
    start: function (next, overrides) {
      stop();
      settings = overrides || settings || {};
      mode = next || cfg.DEFAULT_SOURCE;

      if (mode === "demo") {
        setLink("demo", "Demo data — no broker connected");
        syncDemoTimers();
      } else if (mode === "mqtt") {
        startMqtt();
      } else if (mode === "websocket") {
        startSocket();
      }
    },

    stop: function () { stop(); setLink("idle", "Stopped"); },
    getMode: function () { return mode; },
    getLink: function () { return link; },

    onLinkChange: function (fn) {
      linkListeners.push(fn);
      fn(link);
    },

    /** Keeps demo timers in step with buildings and areas the user adds. */
    syncDemoTimers: syncDemoTimers,

    /** The topics a building listens on — shown in Settings. */
    topicsFor: function (building) {
      var base = baseTopic();
      var list = [
        cfg.topics.temperature(base, building.id),
        cfg.topics.humidity(base, building.id)
      ];
      building.areas.forEach(function (area) {
        list.push(cfg.topics.motion(base, building.id, area.id));
      });
      return list;
    }
  };

  return api;
})();
