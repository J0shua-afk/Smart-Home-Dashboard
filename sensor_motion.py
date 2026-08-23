import paho.mqtt.client as mqtt
import random
import time

# --- Configuration ---
BROKER = "localhost"
PORT = 1883
TOPIC = "home/bedroom/motion"
QOS = 2      # QoS level 2: exactly once delivery
RETAIN = True  # Broker will store the last message for new subscribers

# --- Callback: runs when successfully connected to broker ---
def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("[Motion Sensor] Connected to broker successfully.")
    else:
        print(f"[Motion Sensor] Connection failed. Code: {rc}")

# --- Set up client ---
client = mqtt.Client(client_id="motion_sensor_01")
client.on_connect = on_connect
client.connect(BROKER, PORT, keepalive=60)
client.loop_start()

print("[Motion Sensor] Starting... Checking every 4 seconds.")
print(f"[Motion Sensor] Topic: {TOPIC} | QoS: {QOS} | Retain: {RETAIN}")
print("-" * 50)

# --- Main publishing loop ---
try:
    while True:
        # 30% chance of detecting motion
        motion_detected = random.random() < 0.3
        message = "DETECTED" if motion_detected else "CLEAR"

        result = client.publish(TOPIC, message, qos=QOS, retain=RETAIN)

        status_symbol = "⚠ " if motion_detected else "  "
        print(f"[Motion Sensor] {status_symbol}Published: {message} → {TOPIC}")

        time.sleep(4)  # Wait 4 seconds before next check

except KeyboardInterrupt:
    print("\n[Motion Sensor] Stopped by user.")
    client.loop_stop()
    client.disconnect()