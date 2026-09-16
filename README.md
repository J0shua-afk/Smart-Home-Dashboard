# Smart Home Dashboard

A live dashboard for the sensors in a building: one temperature reading and one
humidity reading for the building as a whole, plus a motion sensor for each area
you care about.

The readings come from a small MQTT sensor network. Python scripts
simulating sensors, or real hardware later send values to an MQTT broker, and
this dashboard subscribes to that broker and draws what arrives. Nothing is
polled and nothing is refreshed by hand: a value on screen changes the moment a
message lands.

The dashboard also ships with a demo mode that generates its own readings, so it
runs and can be demonstrated with no broker at all.

## What it does

- **Whole-building temperature and humidity.** Both live in one panel, labelled
  as building-wide, so they are never mistaken for a room reading.
- **Area motion sensors.** Each one names the place it watches: Living Room,
  Garage, Front Entrance. It shows motion four ways at once: a thicker edge
  marker, a filled glyph, the wording, and colour.
- **Several buildings.** Add as many as you like, each with its own categories,
  readings and areas. Switch between them from the sidebar.
- **Sensor status.** Every sensor says whether its reading is current: Live,
  Updating, Waiting or Offline, based on how long ago its last message arrived.
- **Setup that survives a refresh.** Buildings, categories and area names are
  saved in the browser. Readings are not, so a reopened dashboard never shows a
  stale number as if it were live.
- **Editing from the interface.** Rename buildings, change categories, add and
  remove areas, delete buildings — all without touching the source.
- **Responsive layout.** Two columns of building-wide readings and a grid of
  area tiles on a monitor; a single column with a scrolling building selector on
  a phone.

## Project structure

```text
smart-home-dashboard/
├── index.html                        page structure
├── css/
│   └── styles.css                    visual system and responsive rules
├── js/
│   ├── config.js                     every editable setting
│   ├── storage.js                    saving the setup in the browser
│   ├── state.js                      the data model and every change to it
│   ├── sensors.js                    demo simulator + MQTT/WebSocket adapters
│   ├── dashboard.js                  rendering and DOM updates
│   └── app.js                        startup, setup flow, dialogs, events
├── integration/
│   ├── publish_building.py           Python publisher on the dashboard's topics
│   └── mosquitto-websockets.conf     broker config that adds a WebSocket port
└── README.md
```

Each JavaScript file adds itself to a shared `SHD` namespace and does one job.
Sensor data never touches the DOM directly, and the rendering code never talks
to the broker, so either half can be replaced without disturbing the other.

## Technologies

| Piece | Used for |
| --- | --- |
| HTML, CSS, JavaScript | The dashboard. No framework and no build step. |
| CSS Grid and media queries | The responsive layout. |
| MQTT.js | MQTT over WebSockets in the browser. |
| localStorage | Remembering the building setup. |
| Python and paho-mqtt | The sensor publishers. |
| Mosquitto | The MQTT broker both sides connect to. |

## How the dashboard reaches the sensors

The Python scripts publish over plain TCP on port 1883. A browser cannot open a
raw TCP socket, so it cannot connect to 1883 directly. One extra listener solves
it: Mosquitto can serve the same messages over WebSockets on a second port, and
the browser connects there.

```text
sensor scripts ──1883/tcp──▶ Mosquitto ──9001/websockets──▶ dashboard
```

Topics carry the building and, for motion, the area:

```text
home/<building>/temperature        home/joshuas-house/temperature
home/<building>/humidity           home/joshuas-house/humidity
home/<building>/motion/<area>      home/joshuas-house/motion/living-room
```

`<building>` and `<area>` are slugs: lower case, with dashes instead of spaces
and punctuation. `Joshua's House` becomes `joshuas-house`. Open **Settings**
inside the dashboard to see the exact topics the current building listens on.

Payloads are plain text. `22.4°C`, `61%`, `DETECTED` and `CLEAR` all work, and
so does a JSON object such as `{"value": 22.4, "unit": "°C"}`. Motion counts as
detected for `DETECTED`, `MOTION`, `ON`, `TRUE` or `1`; anything else is treated
as clear.

## Running it locally

**The dashboard on its own, with demo data**

Open `index.html` in a browser. That is the whole procedure — the files load
directly from disk and the simulator starts immediately.

If you would rather serve it, any static server works:

```bash
python -m http.server 5500
# then open http://localhost:5500
```

**With the real sensors**

1. Install the broker and the Python library:

   ```bash
   pip install paho-mqtt
   ```

   Mosquitto is installed separately from
   [mosquitto.org/download](https://mosquitto.org/download/).

2. Start the broker with a WebSocket listener. On Windows, Mosquitto installs
   itself as a background service that already holds port 1883, so stop it
   first:

   ```bat
   net stop mosquitto
   mosquitto -c integration\mosquitto-websockets.conf -v
   ```

3. Start the publishers. Either the original scripts:

   ```bash
   python sensor_temp.py
   python sensor_humidity.py
   python sensor_motion.py
   ```

   or the building-aware one, after setting `BUILDING_ID` and `AREAS` at the top
   of the file to match what you created in the dashboard:

   ```bash
   python integration/publish_building.py
   ```

4. In the dashboard, open **Settings**, choose *Live — MQTT over WebSockets*,
   check the address is `ws://localhost:9001`, and apply. The indicator in the
   top bar turns green once the subscription is confirmed.

## Assumptions about the Python and MQTT side

- The broker is reachable from the browser over WebSockets. Port 1883 alone is
  not enough.
- Area ids in the topics match the ids the dashboard generated from the names
  you typed. A message for an area the dashboard does not know about is ignored
  rather than guessed at — the list of areas belongs to the user.
- A message with no building in its topic is routed to the building currently on
  screen. This is what keeps the original three scripts working.
- Timestamps are taken from arrival time. The dashboard shows no history and
  invents none; if you want charts over time, the backend has to send history.
- The demo simulator and the live adapters are mutually exclusive. Selecting a
  live source stops every simulated timer.

## Setup notes

- No build step, no package installation, no environment variables for the
  frontend. Everything configurable lives in `js/config.js`.
- MQTT.js loads from a CDN in `index.html`. Demo mode works offline; the live
  MQTT source needs that file, so download it locally if the machine has no
  internet during a demonstration.
- Broker credentials, if your broker needs them, belong in `js/config.js` and
  are deliberately never written to browser storage. Do not commit real
  credentials to a public repository.
- If local storage is unavailable — private windows, some embedded frames — the
  dashboard still runs and says so in Settings; it just forgets the setup when
  the tab closes.
