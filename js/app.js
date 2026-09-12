/* ============================================================================
 * app.js — startup, the setup flow, dialogs, and everything the user clicks.
 *
 * This file owns interaction. It reads and writes state through SHD.state,
 * draws through SHD.dashboard, and starts and stops data through SHD.sensors.
 * ========================================================================== */

window.SHD = window.SHD || {};

SHD.app = (function () {
  "use strict";

  var cfg = SHD.config;
  var state = SHD.state;
  var view = SHD.dashboard;
  var sensors = SHD.sensors;

  var prefs = {};

  /* ============================================================ preferences */

  function loadPrefs() {
    var saved = SHD.storage.loadPrefs();
    prefs = {
      source: saved.source || cfg.DEFAULT_SOURCE,
      mqttUrl: saved.mqttUrl || cfg.mqtt.url,
      wsUrl: saved.wsUrl || cfg.websocket.url,
      baseTopic: saved.baseTopic || cfg.mqtt.baseTopic
    };
  }

  function savePrefs() {
    // Credentials are never written here — see storage.js.
    SHD.storage.savePrefs(prefs);
  }

  /* ================================================================= dialogs */

  var modal = {};

  function closeModal() {
    modal.root.hidden = true;
    modal.form.innerHTML = "";
    modal.error.hidden = true;
    modal.onSubmit = null;
    if (modal.lastFocus && modal.lastFocus.focus) modal.lastFocus.focus();
  }

  function showModalError(message) {
    modal.error.textContent = message;
    modal.error.hidden = false;
  }

  function buildCategoryPicker(selected, onChange) {
    var wrap = view.el("div", "field");
    wrap.appendChild(view.el("span", "field__label", "Categories"));

    var chips = view.el("div", "chips");
    var known = state.getKnownCategories();

    function paint() {
      chips.innerHTML = "";
      known.forEach(function (category) {
        var chip = view.el("button", "chip", category);
        chip.type = "button";
        chip.setAttribute("aria-pressed", selected.indexOf(category) !== -1 ? "true" : "false");
        chip.addEventListener("click", function () {
          var i = selected.indexOf(category);
          if (i === -1) selected.push(category); else selected.splice(i, 1);
          paint();
          if (onChange) onChange(selected);
        });
        chips.appendChild(chip);
      });
    }
    paint();
    wrap.appendChild(chips);

    var row = view.el("div", "inline-add");
    var input = view.el("input", "input input--sm");
    input.type = "text";
    input.placeholder = "Add your own, e.g. Cottage";
    input.maxLength = 24;
    var add = view.el("button", "btn btn--quiet", "Add category");
    add.type = "button";

    function addCategory() {
      var value = input.value.trim();
      if (!value) return;
      if (known.indexOf(value) === -1) known.push(value);
      if (selected.indexOf(value) === -1) selected.push(value);
      input.value = "";
      paint();
      if (onChange) onChange(selected);
    }

    add.addEventListener("click", addCategory);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") { event.preventDefault(); addCategory(); }
    });

    row.appendChild(input);
    row.appendChild(add);
    wrap.appendChild(row);
    return wrap;
  }

  /**
   * options = {
   *   title, lede, submitLabel, danger,
   *   fields: [ {type:"text"|"select"|"categories"|"note"|"action", ...} ],
   *   onSubmit(values) -> string|undefined   (return a message to block closing)
   * }
   */
  function openModal(options) {
    modal.lastFocus = document.activeElement;
    modal.title.textContent = options.title;
    modal.lede.textContent = options.lede || "";
    modal.lede.hidden = !options.lede;
    modal.form.innerHTML = "";
    modal.error.hidden = true;
    modal.submit.textContent = options.submitLabel || "Save changes";
    modal.submit.className = options.danger ? "btn btn--danger" : "btn btn--primary";
    modal.submit.hidden = options.submitLabel === null;

    var inputs = {};
    var lists = {};
    var first = null;

    (options.fields || []).forEach(function (field) {
      if (field.type === "note") {
        var note = view.el("div", "note");
        if (field.label) note.appendChild(view.el("strong", null, field.label));
        if (field.text) note.appendChild(view.el("p", null, field.text));
        if (field.lines) {
          var list = view.el("ul", "note__list");
          field.lines.forEach(function (line) { list.appendChild(view.el("li", "mono", line)); });
          note.appendChild(list);
        }
        modal.form.appendChild(note);
        return;
      }

      if (field.type === "action") {
        var button = view.el("button", field.danger ? "btn btn--danger-quiet" : "btn btn--quiet", field.label);
        button.type = "button";
        button.addEventListener("click", field.onClick);
        var holder = view.el("div", "field");
        if (field.help) holder.appendChild(view.el("span", "field__help", field.help));
        holder.appendChild(button);
        modal.form.appendChild(holder);
        return;
      }

      if (field.type === "categories") {
        lists[field.name] = (field.value || []).slice();
        modal.form.appendChild(buildCategoryPicker(lists[field.name]));
        return;
      }

      var wrap = view.el("label", "field");
      wrap.appendChild(view.el("span", "field__label", field.label));

      var control;
      if (field.type === "select") {
        control = view.el("select", "input");
        field.options.forEach(function (option) {
          var node = view.el("option", null, option.label);
          node.value = option.value;
          if (option.value === field.value) node.selected = true;
          control.appendChild(node);
        });
        if (field.onChange) control.addEventListener("change", function () { field.onChange(control.value); });
      } else {
        control = view.el("input", "input");
        control.type = "text";
        control.value = field.value || "";
        control.placeholder = field.placeholder || "";
        control.autocomplete = "off";
        if (field.maxLength) control.maxLength = field.maxLength;
      }

      wrap.appendChild(control);
      if (field.help) wrap.appendChild(view.el("span", "field__help", field.help));
      modal.form.appendChild(wrap);

      inputs[field.name] = control;
      if (!first) first = control;
    });

    modal.onSubmit = function () {
      var values = {};
      Object.keys(inputs).forEach(function (name) { values[name] = inputs[name].value.trim(); });
      Object.keys(lists).forEach(function (name) { values[name] = lists[name]; });
      var problem = options.onSubmit ? options.onSubmit(values) : undefined;
      if (problem) showModalError(problem);
      else closeModal();
    };

    modal.root.hidden = false;
    if (first) first.focus();
    else modal.submit.focus();
  }

  /* ============================================================ setup screen */

  var setup = { step: 1, categories: [] };

  function paintSetupCategories() {
    var host = document.getElementById("setup-categories");
    host.innerHTML = "";

    // Known categories come from existing buildings, so on a first run the list
    // is just the defaults. Anything typed on this screen has to be added too.
    var offered = state.getKnownCategories();
    setup.categories.forEach(function (c) { if (offered.indexOf(c) === -1) offered.push(c); });

    offered.forEach(function (category) {
      var chip = view.el("button", "chip", category);
      chip.type = "button";
      chip.setAttribute("aria-pressed", setup.categories.indexOf(category) !== -1 ? "true" : "false");
      chip.addEventListener("click", function () {
        var i = setup.categories.indexOf(category);
        if (i === -1) setup.categories.push(category); else setup.categories.splice(i, 1);
        paintSetupCategories();
      });
      host.appendChild(chip);
    });
  }

  function setupError(message) {
    var node = document.getElementById("setup-error");
    node.textContent = message || "";
    node.hidden = !message;
  }

  function goToStep(step) {
    setup.step = step;
    var panels = document.querySelectorAll(".setup__step");
    for (var i = 0; i < panels.length; i += 1) {
      panels[i].classList.toggle("is-active", Number(panels[i].getAttribute("data-step")) === step);
    }
    var markers = document.querySelectorAll(".steps__item");
    for (var j = 0; j < markers.length; j += 1) {
      var value = Number(markers[j].getAttribute("data-step"));
      markers[j].classList.toggle("is-current", value === step);
      markers[j].classList.toggle("is-done", value < step);
    }
    document.getElementById("setup-back").hidden = step === 1;
    document.getElementById("setup-skip").hidden = step !== 3;
    document.getElementById("setup-next").textContent = step === 3 ? "Open dashboard" : "Continue";
    setupError("");

    var focusable = document.querySelector('.setup__step.is-active input');
    if (focusable) focusable.focus();
  }

  function advanceSetup() {
    if (setup.step === 1) {
      if (!document.getElementById("setup-name").value.trim()) {
        return setupError("Give the building a name to continue.");
      }
      return goToStep(2);
    }
    if (setup.step === 2) {
      if (!setup.categories.length) return setupError("Pick at least one category, or add your own.");
      return goToStep(3);
    }
    finishSetup(false);
  }

  /**
   * Creates the building. The motion sensor is optional: skipping it, or
   * leaving the field blank, opens a dashboard with temperature and humidity
   * running and no areas yet.
   */
  function finishSetup(skipArea) {
    var name = document.getElementById("setup-name").value.trim();
    if (!name) { goToStep(1); return setupError("Give the building a name to continue."); }

    var area = skipArea ? "" : document.getElementById("setup-area").value.trim();
    state.addBuilding({ name: name, categories: setup.categories.slice(), areaName: area });

    document.getElementById("setup-name").value = "";
    document.getElementById("setup-area").value = "";
    setup.categories = [];
    goToStep(1);
  }

  function wireSetup() {
    paintSetupCategories();
    goToStep(1);

    document.getElementById("setup-next").addEventListener("click", advanceSetup);
    document.getElementById("setup-back").addEventListener("click", function () {
      goToStep(Math.max(1, setup.step - 1));
    });
    document.getElementById("setup-skip").addEventListener("click", function () { finishSetup(true); });
    document.getElementById("setup-category-add").addEventListener("click", addSetupCategory);
    document.getElementById("setup-category-new").addEventListener("keydown", function (event) {
      if (event.key === "Enter") { event.preventDefault(); addSetupCategory(); }
    });
    document.getElementById("setup-form").addEventListener("submit", function (event) {
      event.preventDefault();
      advanceSetup();
    });
  }

  function addSetupCategory() {
    var input = document.getElementById("setup-category-new");
    var value = input.value.trim();
    if (!value) return;
    if (setup.categories.indexOf(value) === -1) setup.categories.push(value);
    input.value = "";
    paintSetupCategories();
  }

  /* ================================================================ actions */

  function addBuilding() {
    openModal({
      title: "Add a building",
      lede: "Each building keeps its own temperature, humidity and list of areas.",
      submitLabel: "Add building",
      fields: [
        { type: "text", name: "name", label: "Building name", placeholder: "Campus Lab", maxLength: 60 },
        { type: "categories", name: "categories", value: [] },
        {
          type: "text", name: "area", label: "First area to watch", placeholder: "Front Entrance", maxLength: 40,
          help: "Optional. Leave it blank and add areas once the building opens."
        }
      ],
      onSubmit: function (values) {
        if (!values.name) return "Give the building a name.";
        if (!values.categories.length) return "Pick at least one category.";
        state.addBuilding({ name: values.name, categories: values.categories, areaName: values.area });
      }
    });
  }

  function editBuilding() {
    var building = state.getActiveBuilding();
    if (!building) return;

    openModal({
      title: "Edit building",
      submitLabel: "Save changes",
      fields: [
        { type: "text", name: "name", label: "Building name", value: building.name, maxLength: 60 },
        { type: "categories", name: "categories", value: building.categories }
      ],
      onSubmit: function (values) {
        if (!values.name) return "The building needs a name.";
        state.updateBuilding(building.id, { name: values.name, categories: values.categories });
      }
    });
  }

  function deleteBuilding() {
    var building = state.getActiveBuilding();
    if (!building) return;

    openModal({
      title: "Delete " + building.name + "?",
      lede: building.areas.length
        ? "This removes the building and the " + building.areas.length +
          (building.areas.length === 1 ? " area" : " areas") + " set up inside it. It cannot be undone."
        : "This removes the building and its settings. It cannot be undone.",
      submitLabel: "Delete building",
      danger: true,
      fields: building.areas.length
        ? [{ type: "note", label: "Areas that will be removed", lines: building.areas.map(function (a) { return a.name; }) }]
        : [],
      onSubmit: function () { state.deleteBuilding(building.id); }
    });
  }

  function addArea() {
    var building = state.getActiveBuilding();
    if (!building) return;

    openModal({
      title: "Add a motion sensor",
      lede: "Name the area it watches, not the device.",
      submitLabel: "Add sensor",
      fields: [{
        type: "text", name: "name", label: "Area name", placeholder: "Kitchen", maxLength: 40,
        help: "Kitchen, Garage, Hallway, Front Entrance — whatever it actually covers."
      }],
      onSubmit: function (values) {
        if (!values.name) return "Name the area this sensor watches.";
        state.addArea(building.id, values.name);
      }
    });
  }

  function renameArea(buildingId, areaId) {
    var building = state.getBuilding(buildingId);
    if (!building) return;
    var area = null;
    building.areas.forEach(function (a) { if (a.id === areaId) area = a; });
    if (!area) return;

    openModal({
      title: "Rename area",
      submitLabel: "Save changes",
      fields: [{ type: "text", name: "name", label: "Area name", value: area.name, maxLength: 40 }],
      onSubmit: function (values) {
        if (!values.name) return "The area needs a name.";
        state.renameArea(buildingId, areaId, values.name);
      }
    });
  }

  function deleteArea(buildingId, areaId) {
    var building = state.getBuilding(buildingId);
    if (!building) return;
    var area = null;
    building.areas.forEach(function (a) { if (a.id === areaId) area = a; });
    if (!area) return;

    openModal({
      title: "Stop watching " + area.name + "?",
      lede: "The tile disappears and the dashboard stops listening for this area.",
      submitLabel: "Remove area",
      danger: true,
      onSubmit: function () { state.deleteArea(buildingId, areaId); }
    });
  }

  function openSettings() {
    var building = state.getActiveBuilding();
    var chosen = prefs.source;

    var fields = [
      {
        type: "select", name: "source", label: "Where readings come from", value: prefs.source,
        options: [
          { value: "demo", label: "Demo data — simulated in the browser" },
          { value: "mqtt", label: "Live — MQTT over WebSockets" },
          { value: "websocket", label: "Live — WebSocket server sending JSON" }
        ],
        onChange: function (value) { chosen = value; },
        help: "Demo data needs no backend. The live options need a broker or bridge that speaks WebSockets."
      },
      {
        type: "text", name: "mqttUrl", label: "MQTT WebSocket address", value: prefs.mqttUrl,
        help: "Mosquitto's websockets listener, not port 1883. Port 1883 is plain TCP and browsers cannot open it."
      },
      { type: "text", name: "baseTopic", label: "Base topic", value: prefs.baseTopic },
      { type: "text", name: "wsUrl", label: "WebSocket address", value: prefs.wsUrl }
    ];

    if (building) {
      fields.push({
        type: "note",
        label: "Topics for " + building.name,
        text: "Publish to these and the tiles above light up.",
        lines: sensors.topicsFor(building)
      });
    }

    if (!SHD.storage.isPersistent()) {
      fields.push({
        type: "note",
        label: "This browser is not saving your setup",
        text: "Local storage is blocked here, so buildings disappear when the tab closes."
      });
    }

    fields.push({
      type: "action", danger: true, label: "Erase saved setup",
      help: "Removes every building from this browser and returns to the setup screen.",
      onClick: function () {
        closeModal();
        openModal({
          title: "Erase everything?",
          lede: "All buildings, categories and areas saved in this browser will be removed.",
          submitLabel: "Erase setup",
          danger: true,
          onSubmit: function () { state.reset(); }
        });
      }
    });

    openModal({
      title: "Settings",
      submitLabel: "Apply",
      fields: fields,
      onSubmit: function (values) {
        prefs.source = values.source || chosen;
        prefs.mqttUrl = values.mqttUrl || cfg.mqtt.url;
        prefs.wsUrl = values.wsUrl || cfg.websocket.url;
        prefs.baseTopic = values.baseTopic || cfg.mqtt.baseTopic;
        savePrefs();
        sensors.start(prefs.source, prefs);
      }
    });
  }

  /* ============================================================ state events */

  var STRUCTURAL = [
    "load", "reset", "building:add", "building:update", "building:delete",
    "building:select", "area:add", "area:update", "area:delete"
  ];

  function onStateEvent(event) {
    if (event.type === "reading") {
      var detail = event.detail;
      view.markUpdated(detail.type === "motion" ? "motion:" + detail.areaId : detail.type);
      if (detail.buildingId === state.getActiveBuildingId()) view.refresh();
      else view.refreshRailFlags();
      return;
    }

    if (STRUCTURAL.indexOf(event.type) === -1) return;

    if (state.isEmpty()) {
      view.showSetup();
    } else {
      view.showDashboard();
      view.render();
    }
    sensors.syncDemoTimers();
  }

  /* =================================================================== boot */

  function wireControls() {
    modal.root = document.getElementById("modal-root");
    modal.title = document.getElementById("modal-title");
    modal.lede = document.getElementById("modal-lede");
    modal.form = document.getElementById("modal-form");
    modal.error = document.getElementById("modal-error");
    modal.submit = document.getElementById("modal-submit");

    modal.submit.addEventListener("click", function () { if (modal.onSubmit) modal.onSubmit(); });
    modal.form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (modal.onSubmit) modal.onSubmit();
    });
    modal.root.addEventListener("click", function (event) {
      if (event.target.getAttribute("data-close") === "true") closeModal();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !modal.root.hidden) closeModal();
    });

    document.getElementById("add-building").addEventListener("click", addBuilding);
    document.getElementById("edit-building").addEventListener("click", editBuilding);
    document.getElementById("delete-building").addEventListener("click", deleteBuilding);
    document.getElementById("add-area").addEventListener("click", addArea);
    document.getElementById("open-settings").addEventListener("click", openSettings);
  }

  function boot() {
    loadPrefs();

    view.mount({
      selectBuilding: function (id) { state.setActiveBuilding(id); },
      renameArea: renameArea,
      deleteArea: deleteArea
    });

    state.subscribe(onStateEvent);
    sensors.onLinkChange(view.setLinkState);

    wireControls();
    wireSetup();

    state.init();
    sensors.start(prefs.source, prefs);
  }

  return { boot: boot };
})();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", SHD.app.boot);
} else {
  SHD.app.boot();
}
