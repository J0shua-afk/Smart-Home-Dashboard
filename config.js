/* ============================================================================
 * config.js — every setting a developer is likely to change lives here.
 * Nothing in this file talks to the DOM or to the broker; it is data only.
 * ========================================================================== */

window.SHD = window.SHD || {};

SHD.config = (function () {
  "use strict";

  // EDIT HERE:
  // Which data source the dashboard starts with.
  //   "demo"      built-in simulator, no backend needed
  //   "mqtt"      MQTT over WebSockets (Mosquitto with a websockets listener)
  //   "websocket" a plain WebSocket server that pushes JSON readings
  // The Settings dialog can override this at runtime; this is only the default.
  var DEFAULT_SOURCE = "demo";

  // EDIT HERE:
  // MQTT-over-WebSocket connection.
  // Port 1883 is the plain TCP port your Python scripts use — a browser cannot
  // speak to it. Point this at the broker's websockets listener instead
  // (see README.md, "Connecting the real sensors").
  var mqtt = {
    url: "ws://localhost:9001",
    baseTopic: "home",          // first level of every topic
    qos: 1,                     // subscription QoS: 0, 1 or 2
    clientIdPrefix: "shd_web_",
    reconnectPeriodMs: 4000,
    connectTimeoutMs: 8000,
    // Leave blank for an open broker. Do not commit real credentials to a public
    // repo, and note that the dashboard never writes these to local storage.
    username: "",
    password: ""
  };

  // EDIT HERE:
  // Plain WebSocket endpoint, used when the source is "websocket".
  // The server should send one JSON object per message, shaped like:
  //   { "building": "joshuas-house", "type": "temperature", "value": 22.4 }
  //   { "building": "joshuas-house", "type": "motion", "area": "living-room",
  //     "value": "DETECTED" }
  var websocket = {
    url: "ws://localhost:8080",
    reconnectDelayMs: 4000
  };

  // EDIT HERE:
  // Topic layout. Change these if your publishers use a different scheme.
  //   home/<building>/temperature
  //   home/<building>/humidity
  //   home/<building>/motion/<area>
  // <building> and <area> are slugs: lower case, dashes instead of spaces.
  var topics = {
    temperature: function (base, building) { return base + "/" + building + "/temperature"; },
    humidity:    function (base, building) { return base + "/" + building + "/humidity"; },
    motion:      function (base, building, area) { return base + "/" + building + "/motion/" + area; },
    subscribe:   function (base) { return base + "/#"; }
  };

  // EDIT HERE:
  // Older topics that do not carry a building name. Anything listed here is
  // routed to the building named in `legacyBuildingId`, or to the first
  // building when that is null. This keeps the original CNET341 publisher
  // scripts (sensor_temp.py, sensor_humidity.py, sensor_motion.py) working
  // without editing them.
  var legacyTopics = {
    "home/livingroom/temperature": { type: "temperature" },
    "home/kitchen/humidity":       { type: "humidity" },
    "home/bedroom/motion":         { type: "motion", areaName: "Bedroom" }
  };
  var legacyBuildingId = null;

  // EDIT HERE:
  // Demo simulator. Only used when the source is "demo" — none of this runs
  // once a real broker is connected.
  var demo = {
    temperature: {
      min: 18, max: 28,         // degrees
      startAt: 22,
      maxStep: 0.4,             // largest change between two readings
      intervalMs: 3000
    },
    humidity: {
      min: 30, max: 75,         // percent
      startAt: 52,
      maxStep: 3,
      intervalMs: 5000
    },
    motion: {
      // Each area runs its own timer. A new area gets its own schedule the
      // moment it is added, so areas never trigger together.
      quietMinMs: 4000,         // shortest gap between motion events
      quietMaxMs: 15000,        // longest gap between motion events
      activeMinMs: 3000,        // shortest time a sensor stays in motion
      activeMaxMs: 8000,        // longest time a sensor stays in motion
      startStaggerMaxMs: 6000   // random head start so areas fall out of step
    }
  };

  // EDIT HERE:
  // How old a reading can be before its status changes. Times are in
  // milliseconds and are measured from the last message for that sensor.
  // Motion is given a longer leash because a quiet sensor is still healthy.
  var freshness = {
    temperature: { live: 10000, waiting: 40000 },
    humidity:    { live: 16000, waiting: 60000 },
    motion:      { live: 40000, waiting: 120000 }
  };

  // EDIT HERE:
  // Display units and rounding.
  var display = {
    temperatureUnit: "°C",
    temperatureDecimals: 1,
    humidityUnit: "%",
    humidityDecimals: 0,
    clockTickMs: 1000          // how often "12s ago" and statuses refresh
  };

  // EDIT HERE:
  // Categories offered on the setup screen. Users can still type their own.
  var defaultCategories = ["Home", "Work", "School", "Other"];

  // EDIT HERE:
  // Local storage keys. Bump the suffix to invalidate saved setups after a
  // breaking change to the data shape.
  var storageKeys = {
    state: "shd.buildings.v1",
    prefs: "shd.prefs.v1"
  };

  return {
    DEFAULT_SOURCE: DEFAULT_SOURCE,
    mqtt: mqtt,
    websocket: websocket,
    topics: topics,
    legacyTopics: legacyTopics,
    legacyBuildingId: legacyBuildingId,
    demo: demo,
    freshness: freshness,
    display: display,
    defaultCategories: defaultCategories,
    storageKeys: storageKeys
  };
})();
