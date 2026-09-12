/* ============================================================================
 * state.js — the shape of the data and every change that can be made to it.
 *
 * One building looks like this:
 *
 *   {
 *     id: "joshuas-house",              // slug, also used inside MQTT topics
 *     name: "Joshua's House",
 *     categories: ["Home"],
 *     createdAt: 1730000000000,
 *     environment: {                    // whole-building readings
 *       temperature: { value: 22.4, unit: "°C", updatedAt: 173..., source: "mqtt" },
 *       humidity:    { value: 61,   unit: "%",  updatedAt: 173..., source: "mqtt" }
 *     },
 *     areas: [                          // one entry per motion sensor
 *       { id: "living-room", name: "Living Room", active: false,
 *         updatedAt: 173..., lastMotionAt: 173... }
 *     ]
 *   }
 *
 * Anything that changes the data goes through this file, and every change
 * publishes an event so the UI and the simulator can react.
 * ========================================================================== */

window.SHD = window.SHD || {};

SHD.state = (function () {
  "use strict";

  var cfg = SHD.config;

  var data = { activeBuildingId: null, buildings: [] };
  var listeners = [];

  /* ---------------------------------------------------------------- helpers */

  function slugify(text) {
    var slug = String(text || "")
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug || "item";
  }

  function uniqueId(base, taken) {
    var id = base, n = 2;
    while (taken.indexOf(id) !== -1) { id = base + "-" + n; n += 1; }
    return id;
  }

  function emit(type, detail) {
    var snapshot = { type: type, detail: detail || null };
    for (var i = 0; i < listeners.length; i += 1) listeners[i](snapshot);
  }

  /** Structural changes are saved; incoming readings are not. */
  function persist() {
    SHD.storage.saveBuildings({
      activeBuildingId: data.activeBuildingId,
      buildings: data.buildings.map(function (b) {
        return {
          id: b.id,
          name: b.name,
          categories: b.categories.slice(),
          createdAt: b.createdAt,
          areas: b.areas.map(function (a) { return { id: a.id, name: a.name }; })
        };
      })
    });
  }

  function blankReading(unit) {
    return { value: null, unit: unit, updatedAt: null, source: null };
  }

  function makeArea(name, taken) {
    return {
      id: uniqueId(slugify(name), taken),
      name: String(name).trim(),
      active: false,
      updatedAt: null,
      lastMotionAt: null
    };
  }

  function hydrate(saved) {
    return {
      id: saved.id || slugify(saved.name),
      name: saved.name,
      categories: Array.isArray(saved.categories) ? saved.categories.slice() : [],
      createdAt: saved.createdAt || Date.now(),
      environment: {
        temperature: blankReading(cfg.display.temperatureUnit),
        humidity: blankReading(cfg.display.humidityUnit)
      },
      areas: (saved.areas || []).map(function (a) {
        return { id: a.id || slugify(a.name), name: a.name, active: false, updatedAt: null, lastMotionAt: null };
      })
    };
  }

  function findBuilding(id) {
    for (var i = 0; i < data.buildings.length; i += 1) {
      if (data.buildings[i].id === id) return data.buildings[i];
    }
    return null;
  }

  function findArea(building, id) {
    if (!building) return null;
    for (var i = 0; i < building.areas.length; i += 1) {
      if (building.areas[i].id === id) return building.areas[i];
    }
    return null;
  }

  /* ------------------------------------------------------------------- api */

  var api = {
    slugify: slugify,

    /** Restore whatever was saved last time. */
    init: function () {
      var saved = SHD.storage.loadBuildings();
      if (saved && Array.isArray(saved.buildings) && saved.buildings.length) {
        data.buildings = saved.buildings.map(hydrate);
        data.activeBuildingId = findBuilding(saved.activeBuildingId)
          ? saved.activeBuildingId
          : data.buildings[0].id;
      }
      emit("load");
    },

    subscribe: function (fn) {
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
      };
    },

    getBuildings: function () { return data.buildings; },
    getBuilding: findBuilding,
    getActiveBuilding: function () { return findBuilding(data.activeBuildingId); },
    getActiveBuildingId: function () { return data.activeBuildingId; },
    isEmpty: function () { return data.buildings.length === 0; },

    /** Every category ever used, so the pickers stay in sync. */
    getKnownCategories: function () {
      var all = cfg.defaultCategories.slice();
      data.buildings.forEach(function (b) {
        b.categories.forEach(function (c) { if (all.indexOf(c) === -1) all.push(c); });
      });
      return all;
    },

    setActiveBuilding: function (id) {
      if (!findBuilding(id) || id === data.activeBuildingId) return;
      data.activeBuildingId = id;
      persist();
      emit("building:select", { buildingId: id });
    },

    /**
     * @param {{name:string, categories:string[], areaName:string}} input
     * @returns {object} the building that was created
     */
    addBuilding: function (input) {
      var taken = data.buildings.map(function (b) { return b.id; });
      var building = {
        id: uniqueId(slugify(input.name), taken),
        name: String(input.name).trim(),
        categories: (input.categories || []).slice(),
        createdAt: Date.now(),
        environment: {
          temperature: blankReading(cfg.display.temperatureUnit),
          humidity: blankReading(cfg.display.humidityUnit)
        },
        areas: []
      };
      if (input.areaName) building.areas.push(makeArea(input.areaName, []));

      data.buildings.push(building);
      data.activeBuildingId = building.id;
      persist();
      emit("building:add", { buildingId: building.id });
      return building;
    },

    updateBuilding: function (id, changes) {
      var building = findBuilding(id);
      if (!building) return;
      if (typeof changes.name === "string" && changes.name.trim()) building.name = changes.name.trim();
      if (Array.isArray(changes.categories)) building.categories = changes.categories.slice();
      persist();
      emit("building:update", { buildingId: id });
    },

    deleteBuilding: function (id) {
      var index = -1;
      for (var i = 0; i < data.buildings.length; i += 1) {
        if (data.buildings[i].id === id) { index = i; break; }
      }
      if (index === -1) return;

      data.buildings.splice(index, 1);
      if (data.activeBuildingId === id) {
        data.activeBuildingId = data.buildings.length ? data.buildings[0].id : null;
      }
      persist();
      emit("building:delete", { buildingId: id });
    },

    addArea: function (buildingId, name) {
      var building = findBuilding(buildingId);
      if (!building) return null;
      var taken = building.areas.map(function (a) { return a.id; });
      var area = makeArea(name, taken);
      building.areas.push(area);
      persist();
      emit("area:add", { buildingId: buildingId, areaId: area.id });
      return area;
    },

    renameArea: function (buildingId, areaId, name) {
      var area = findArea(findBuilding(buildingId), areaId);
      if (!area || !String(name).trim()) return;
      area.name = String(name).trim();
      persist();
      emit("area:update", { buildingId: buildingId, areaId: areaId });
    },

    deleteArea: function (buildingId, areaId) {
      var building = findBuilding(buildingId);
      if (!building) return;
      for (var i = 0; i < building.areas.length; i += 1) {
        if (building.areas[i].id === areaId) {
          building.areas.splice(i, 1);
          persist();
          emit("area:delete", { buildingId: buildingId, areaId: areaId });
          return;
        }
      }
    },

    /**
     * Apply one normalised reading. Called by sensors.js for demo data, MQTT
     * messages and WebSocket messages alike — the routing rules live in one
     * place so every source behaves identically.
     *
     * reading = {
     *   buildingId, type: "temperature"|"humidity"|"motion",
     *   areaId?, areaName?, value, unit?, timestamp?, source?
     * }
     */
    applyReading: function (reading) {
      if (!reading) return false;

      // Route to a building: named building first, otherwise the active one.
      var building = reading.buildingId ? findBuilding(reading.buildingId) : null;
      if (!building) building = this.getActiveBuilding();
      if (!building) return false;

      var when = reading.timestamp || Date.now();
      var source = reading.source || "unknown";

      if (reading.type === "temperature" || reading.type === "humidity") {
        var slot = building.environment[reading.type];
        var numeric = parseFloat(reading.value);
        if (isNaN(numeric)) return false;
        slot.value = numeric;
        if (reading.unit) slot.unit = reading.unit;
        slot.updatedAt = when;
        slot.source = source;
        emit("reading", { buildingId: building.id, type: reading.type });
        return true;
      }

      if (reading.type === "motion") {
        // Match on id when we have one, otherwise on the name the publisher used.
        var area = reading.areaId ? findArea(building, reading.areaId) : null;
        if (!area && reading.areaName) area = findArea(building, slugify(reading.areaName));
        if (!area) return false;   // unknown area: ignored, the user owns the list

        var raw = String(reading.value).trim().toUpperCase();
        var active = raw === "DETECTED" || raw === "TRUE" || raw === "1" || raw === "MOTION" || raw === "ON";
        area.active = active;
        area.updatedAt = when;
        if (active) area.lastMotionAt = when;
        emit("reading", { buildingId: building.id, type: "motion", areaId: area.id });
        return true;
      }

      return false;
    },

    /** Wipes the saved setup. Used by the reset action in Settings. */
    reset: function () {
      data = { activeBuildingId: null, buildings: [] };
      SHD.storage.clearAll();
      emit("reset");
    }
  };

  return api;
})();
