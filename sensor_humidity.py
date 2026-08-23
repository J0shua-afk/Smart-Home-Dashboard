import paho.mqtt.client as mqtt
import random
import time

# --- Configuration ---
BROKER = "localhost"
PORT = 1883
TOPIC = "home/kitchen/humidity"
QOS = 0  # QoS level 0: fire and forget (no acknowledgement)

# --- Callback: runs when successfully connected to broker ---
def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("[Humidity Sensor] Connected to broker successfully.")
    else:
        print(f"[Humidity Sensor] Connection failed. Code: {rc}")

# --- Set up client ---
client = mqtt.Client(client_id="humidity_sensor_01")
client.on_connect = on_connect
client.connect(BROKER, PORT, keepalive=60)
client.loop_start()

print("[Humidity Sensor] Starting... Publishing every 5 seconds.")
print(f"[Humidity Sensor] Topic: {TOPIC} | QoS: {QOS}")
print("-" * 50)

# --- Main publishing loop ---
try:
    while True:
        # Simulate a humidity reading between 30% and 75%
        humidity = random.randint(30, 75)
        message = f"{humidity}%"

        result = client.publish(TOPIC, message, qos=QOS, retain=False)

        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            print(f"[Humidity Sensor] Published: {message} → {TOPIC}")
        else:
            print(f"[Humidity Sensor] Publish failed. Error code: {result.rc}")

        time.sleep(5)  # Wait 5 seconds before next reading

except KeyboardInterrupt:
    print("\n[Humidity Sensor] Stopped by user.")
    client.loop_stop()
    client.disconnect()