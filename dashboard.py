import paho.mqtt.client as mqtt
from datetime import datetime

# --- Configuration ---
BROKER = "localhost"
PORT = 1883
SUBSCRIBE_TOPIC = "home/#"  # The # wildcard means "all topics under home/"
QOS = 1

# --- Store the latest reading for each topic ---
latest_readings = {}

# --- Helper: format and print the full dashboard ---
def print_dashboard():
    print("\033[2J\033[H", end="")  # Clear the terminal screen

    print("=" * 55)
    print("       SMART HOME MQTT DASHBOARD")
    print(f"       Last updated: {datetime.now().strftime('%H:%M:%S')}")
    print("=" * 55)

    if not latest_readings:
        print("\n  Waiting for sensor data...")
    else:
        for topic, data in sorted(latest_readings.items()):
            # Make the topic easier to read
            room = topic.split("/")[1].capitalize()
            sensor_type = topic.split("/")[2].capitalize()

            # Add visual indicator for motion
            value = data["value"]
            if "motion" in topic and value == "DETECTED":
                indicator = " *** MOTION DETECTED ***"
            elif "motion" in topic:
                indicator = " (clear)"
            else:
                indicator = ""

            print(f"\n  [{room}] {sensor_type}")
            print(f"    Value   : {value}{indicator}")
            print(f"    Topic   : {topic}")
            print(f"    QoS     : {data['qos']}")
            print(f"    Time    : {data['timestamp']}")
            print(f"    Retained: {'Yes' if data['retained'] else 'No'}")
            print("  " + "-" * 50)

    print("\n  Press Ctrl+C to stop the dashboard.")
    print("=" * 55)

# --- Callback: runs when broker confirms connection ---
def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("[Dashboard] Connected to broker.")
        client.subscribe(SUBSCRIBE_TOPIC, qos=QOS)
        print(f"[Dashboard] Subscribed to: {SUBSCRIBE_TOPIC}")
    else:
        print(f"[Dashboard] Connection failed. Code: {rc}")

# --- Callback: runs every time a new message arrives ---
def on_message(client, userdata, msg):
    topic = msg.topic
    value = msg.payload.decode("utf-8")
    timestamp = datetime.now().strftime("%H:%M:%S")

    # Save the latest reading for this topic
    latest_readings[topic] = {
        "value": value,
        "qos": msg.qos,
        "timestamp": timestamp,
        "retained": msg.retain
    }

    # Refresh the dashboard display
    print_dashboard()

# --- Callback: runs if connection is lost ---
def on_disconnect(client, userdata, rc):
    if rc != 0:
        print(f"\n[Dashboard] Unexpected disconnect. Code: {rc}")
    else:
        print("\n[Dashboard] Disconnected.")

# --- Set up client ---
client = mqtt.Client(client_id="dashboard_subscriber")
client.on_connect = on_connect
client.on_message = on_message
client.on_disconnect = on_disconnect

print("[Dashboard] Connecting to broker...")
client.connect(BROKER, PORT, keepalive=60)

# --- Start the loop (runs forever until Ctrl+C) ---
try:
    client.loop_forever()
except KeyboardInterrupt:
    print("\n[Dashboard] Stopped by user.")
    client.disconnect()