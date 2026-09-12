/* ============================================================================
 * dashboard.js — turning state into pixels.
 *
 * Two passes, on purpose:
 *   render()   rebuilds structure — the building list, the header, the tiles.
 *              Runs when buildings or areas are added, renamed or removed.
 *   refresh()  writes values, states and timestamps into structure that already
 *              exists. Runs on every reading and once a second for the clock.
 *
 * Keeping them apart means a motion tile can animate its state change instead
 * of being thrown away and rebuilt mid-transition.
 * ========================================================================== */

window.SHD = window.SHD || {};

SHD.dashboard = (function () {
  "use strict";

  var cfg = SHD.config;
  var dom = {};
  var flash = {};              // sensors that just changed, for the "Updating" state
  var handlers = {};           // wired up by app.js
  var clock = null;

  /* ---------------------------------------------------------------- helpers */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function formatAge(timestamp) {
    if (!timestamp) return "no readings yet";
    var seconds = Math.round((Date.now() - timestamp) / 1000);
    if (seconds < 2) return "just now";
    if (seconds < 60) return seconds + "s ago";
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + (minutes === 1 ? " minute ago" : " minutes ago");
    var hours = Math.round(minutes / 60);
    return hours + (hours === 1 ? " hour ago" : " hours ago");
  }

  function formatValue(value, decimals) {
    if (value === null || value === undefined) return "--";
    return Number(value).toFixed(decimals);
  }

  /**
   * Live       a reading arrived recently
   * Updating   a reading arrived in the last moment (brief)
   * Waiting    nothing for a while, but not long enough to call it dead
   * Offline    silent well past the expected interval
   */
  function statusFor(type, updatedAt, key) {
    if (!updatedAt) return { state: "waiting", text: "Waiting" };
    if (flash[key] && Date.now() - flash[key] < 700) return { state: "updating", text: "Updating" };

    var limits = cfg.freshness[type];
    var age = Date.now() - updatedAt;
    if (age <= limits.live) return { state: "live", text: "Live" };
    if (age <= limits.waiting) return { state: "waiting", text: "Waiting" };
    return { state: "offline", text: "Offline" };
  }

  function paintStatus(node, status) {
    if (!node) return;
    node.setAttribute("data-state", status.state);
    node.querySelector(".state__text").textContent = status.text;
  }

  /* ----------------------------------------------------------------- render */

  function renderRail() {
    var list = dom.railList;
    list.innerHTML = "";
    var activeId = SHD.state.getActiveBuildingId();

    SHD.state.getBuildings().forEach(function (building) {
      var item = el("li", "rail__item");
      var button = el("button", "rail__link");
      button.type = "button";
      button.setAttribute("data-building", building.id);
      if (building.id === activeId) button.setAttribute("aria-current", "true");

      button.appendChild(el("span", "rail__label", building.name));

      var meta = el("span", "rail__meta");
      meta.appendChild(el("span", null, building.areas.length + (building.areas.length === 1 ? " area" : " areas")));
      meta.appendChild(el("span", "rail__flag", "motion"));
      button.appendChild(meta);
      button.setAttribute("data-motion", "false");

      button.addEventListener("click", function () {
        if (handlers.selectBuilding) handlers.selectBuilding(building.id);
      });

      item.appendChild(button);
      list.appendChild(item);
    });
  }

  function renderAreaTile(building, area) {
    var tile = el("article", "area");
    tile.setAttribute("data-area", area.id);
    tile.setAttribute("data-active", "false");

    tile.appendChild(el("span", "area__edge"));

    var body = el("div", "area__body");

    var top = el("div", "area__top");
    top.appendChild(el("h3", "area__name", area.name));
    var status = el("span", "state");
    status.setAttribute("data-state", "waiting");
    status.appendChild(el("span", "state__dot"));
    status.appendChild(el("span", "state__text", "Waiting"));
    top.appendChild(status);
    body.appendChild(top);

    var readout = el("p", "area__state");
    readout.setAttribute("aria-live", "polite");
    readout.appendChild(el("span", "area__glyph"));
    readout.appendChild(el("span", "area__word", "No motion"));
    body.appendChild(readout);

    body.appendChild(el("p", "area__age", "no readings yet"));

    var tools = el("div", "area__tools");
    var rename = el("button", "linkish", "Rename");
    rename.type = "button";
    rename.addEventListener("click", function () {
      if (handlers.renameArea) handlers.renameArea(building.id, area.id);
    });
    var remove = el("button", "linkish linkish--danger", "Remove");
    remove.type = "button";
    remove.addEventListener("click", function () {
      if (handlers.deleteArea) handlers.deleteArea(building.id, area.id);
    });
    tools.appendChild(rename);
    tools.appendChild(remove);
    body.appendChild(tools);

    tile.appendChild(body);
    return tile;
  }

  function renderBuilding() {
    var building = SHD.state.getActiveBuilding();
    if (!building) return;

    dom.buildingName.textContent = building.name;

    dom.buildingTags.innerHTML = "";
    if (building.categories.length) {
      building.categories.forEach(function (category) {
        dom.buildingTags.appendChild(el("span", "tag", category));
      });
    } else {
      dom.buildingTags.appendChild(el("span", "tag tag--empty", "No category"));
    }

    dom.areasGrid.innerHTML = "";
    building.areas.forEach(function (area) {
      dom.areasGrid.appendChild(renderAreaTile(building, area));
    });

    dom.areasEmpty.hidden = building.areas.length > 0;
    dom.areasGrid.hidden = building.areas.length === 0;
  }

  /** Cheap update so motion in a building you are not looking at still shows. */
  function refreshRailFlags() {
    SHD.state.getBuildings().forEach(function (building) {
      var link = dom.railList.querySelector('[data-building="' + building.id + '"]');
      if (!link) return;
      var moving = building.areas.some(function (a) { return a.active; });
      link.setAttribute("data-motion", moving ? "true" : "false");
    });
  }

  function render() {
    renderRail();
    renderBuilding();
    refresh();
  }

  /* ---------------------------------------------------------------- refresh */

  function refreshReadout(card, reading, type, decimals) {
    var key = type;
    card.querySelector(".readout__number").textContent = formatValue(reading.value, decimals);
    card.querySelector(".readout__unit").textContent = reading.unit || "";
    card.querySelector(".readout__age").textContent = formatAge(reading.updatedAt);
    card.querySelector(".readout__source").textContent = reading.source || "—";
    paintStatus(card.querySelector(".state"), statusFor(type, reading.updatedAt, key));
  }

  function refresh() {
    var building = SHD.state.getActiveBuilding();
    if (!building) return;

    refreshReadout(dom.tempCard, building.environment.temperature, "temperature", cfg.display.temperatureDecimals);
    refreshReadout(dom.humidityCard, building.environment.humidity, "humidity", cfg.display.humidityDecimals);

    building.areas.forEach(function (area) {
      var tile = dom.areasGrid.querySelector('[data-area="' + area.id + '"]');
      if (!tile) return;

      tile.setAttribute("data-active", area.active ? "true" : "false");
      tile.querySelector(".area__word").textContent = area.active ? "Motion detected" : "No motion";

      var ageText;
      if (!area.updatedAt) ageText = "no readings yet";
      else if (area.active) ageText = "since " + formatAge(area.updatedAt);
      else if (area.lastMotionAt) ageText = "last motion " + formatAge(area.lastMotionAt);
      else ageText = "checked " + formatAge(area.updatedAt);
      tile.querySelector(".area__age").textContent = ageText;

      paintStatus(tile.querySelector(".state"), statusFor("motion", area.updatedAt, "motion:" + area.id));
    });

    refreshRailFlags();
  }

  function markUpdated(key) { flash[key] = Date.now(); }

  /* ------------------------------------------------------------------- link */

  function setLinkState(link) {
    if (!dom.linkState) return;
    var words = {
      idle: "Starting",
      demo: "Demo data",
      connecting: "Connecting",
      live: "Connected",
      retrying: "Reconnecting",
      error: "Not connected",
      stopped: "Stopped"
    };
    dom.linkState.setAttribute("data-state", link.state);
    dom.linkState.setAttribute("title", link.message || "");
    dom.linkText.textContent = words[link.state] || link.state;
  }

  /* -------------------------------------------------------------- visibility */

  function showSetup() {
    dom.setup.hidden = false;
    dom.shell.hidden = true;
  }

  function showDashboard() {
    dom.setup.hidden = true;
    dom.shell.hidden = false;
  }

  /* -------------------------------------------------------------------- api */

  return {
    mount: function (callbacks) {
      handlers = callbacks || {};

      dom.setup = document.getElementById("setup-screen");
      dom.shell = document.getElementById("app-shell");
      dom.railList = document.getElementById("rail-list");
      dom.buildingName = document.getElementById("building-name");
      dom.buildingTags = document.getElementById("building-tags");
      dom.areasGrid = document.getElementById("areas-grid");
      dom.areasEmpty = document.getElementById("areas-empty");
      dom.tempCard = document.querySelector('[data-sensor="temperature"]');
      dom.humidityCard = document.querySelector('[data-sensor="humidity"]');
      dom.linkState = document.getElementById("link-state");
      dom.linkText = document.getElementById("link-state-text");

      clearInterval(clock);
      clock = setInterval(refresh, cfg.display.clockTickMs);
    },

    render: render,
    refresh: refresh,
    renderRail: renderRail,
    refreshRailFlags: refreshRailFlags,
    markUpdated: markUpdated,
    setLinkState: setLinkState,
    showSetup: showSetup,
    showDashboard: showDashboard,
    formatAge: formatAge,
    el: el
  };
})();
