"""
publish_building.py — publishes one building's sensors on the topic scheme the
dashboard listens to.

    home/<building>/temperature      e.g. home/joshuas-house/temperature
    home/<building>/humidity         e.g. home/joshuas-house/humidity
    home/<building>/motion/<area>    e.g. home/joshuas-house/motion/living-room

The original CNET341 scripts (sensor_temp.py, sensor_humidity.py,
sensor_motion.py) still work — the dashboard maps their older topics onto the
first building. Use this script when you want several areas, or more than one
building, without editing three files each time.

Run it once per building:

    python publish_building.py

Requires: pip install paho-mqtt
"""

import random
import threading
import time

import paho.mqtt.client as mqtt

# --- EDIT HERE: which broker to publish to -----------------------------------
BROKER = "localhost"
PORT = 1883                      # plain TCP, the same port the dashboard's
                                 # broker exposes on 9001 for websockets

# --- EDIT HERE: which building this process represents ------------------------
# BUILDING_ID must match the id the dashboard generated from the building name:
# lower case, spaces and punctuation replaced with dashes.
#   "Joshua's House"  ->  "joshuas-house"
#   "Campus Lab 2"    ->  "campus-lab-2"
BASE_TOPIC = "home"
BUILDING_ID = "joshuas-house"

# --- EDIT HERE: the areas this building watches -------------------------------
# Each entry is the area id shown in the dashboard's Settings dialog, again
# lower case with dashes. Every area publishes on its own random schedule.
AREAS = ["living-room", "kitchen", "garage"]

# --- EDIT HERE: sensor behaviour ---------------------------------------------
TEMPERATURE = {"min": 18.0, "max": 28.0, "interval": 3, "qos": 1}
HUMIDITY = {"min": 30, "max": 75, "interval": 5, "qos": 0}
MOTION = {
    "quiet_min": 5,      # shortest gap between motion events, seconds
    "quiet_max": 18,     # longest gap between motion events
    "active_min": 3,     # shortest time a sensor stays in motion
    "active_max": 8,
    "qos": 2,
    "retain": True,      # new subscribers immediately see the last state
}

stop = threading.Event()


def make_client(client_id):
    """Works with both paho-mqtt 1.x and 2.x."""
    try:
        return mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id=client_id)
    except AttributeError:
        return mqtt.Client(client_id=client_id)


def temperature_loop(client):
    topic = f"{BASE_TOPIC}/{BUILDING_ID}/temperature"
    value = (TEMPERATURE["min"] + TEMPERATURE["max"]) / 2
    while not stop.is_set():
        value = min(TEMPERATURE["max"], max(TEMPERATURE["min"], value + random.uniform(-0.4, 0.4)))
        client.publish(topic, f"{value:.1f}°C", qos=TEMPERATURE["qos"], retain=False)
        print(f"[temperature] {value:.1f}°C -> {topic}")
        stop.wait(TEMPERATURE["interval"])


def humidity_loop(client):
    topic = f"{BASE_TOPIC}/{BUILDING_ID}/humidity"
    value = (HUMIDITY["min"] + HUMIDITY["max"]) / 2
    while not stop.is_set():
        value = min(HUMIDITY["max"], max(HUMIDITY["min"], value + random.uniform(-3, 3)))
        client.publish(topic, f"{value:.0f}%", qos=HUMIDITY["qos"], retain=False)
        print(f"[humidity] {value:.0f}% -> {topic}")
        stop.wait(HUMIDITY["interval"])


def motion_loop(client, area):
    """One thread per area, so no two areas ever fire together."""
    topic = f"{BASE_TOPIC}/{BUILDING_ID}/motion/{area}"
    stop.wait(random.uniform(0, 6))          # independent head start

    while not stop.is_set():
        client.publish(topic, "CLEAR", qos=MOTION["qos"], retain=MOTION["retain"])
        print(f"[motion:{area}] CLEAR -> {topic}")
        stop.wait(random.uniform(MOTION["quiet_min"], MOTION["quiet_max"]))
        if stop.is_set():
            break

        client.publish(topic, "DETECTED", qos=MOTION["qos"], retain=MOTION["retain"])
        print(f"[motion:{area}] DETECTED -> {topic}")
        stop.wait(random.uniform(MOTION["active_min"], MOTION["active_max"]))


def main():
    client = make_client(f"publisher_{BUILDING_ID}")
    client.connect(BROKER, PORT, keepalive=60)
    client.loop_start()

    print(f"Publishing {BUILDING_ID} to {BROKER}:{PORT}")
    print(f"Areas: {', '.join(AREAS)}")
    print("Press Ctrl+C to stop.\n")

    threads = [
        threading.Thread(target=temperature_loop, args=(client,), daemon=True),
        threading.Thread(target=humidity_loop, args=(client,), daemon=True),
    ]
    threads += [threading.Thread(target=motion_loop, args=(client, area), daemon=True) for area in AREAS]

    for thread in threads:
        thread.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping.")
        stop.set()
        time.sleep(0.3)
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
