import paho.mqtt.client as mqtt
import random
import time

# --- Configuration ---
BROKER = "localhost"
PORT = 1883
TOPIC = "home/livingroom/temperature"
QOS = 1  
# --- Callback: runs when successfully connected to broker ---
def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("[Temperature Sensor] Connected to broker successfully.")
    else:
        print(f"[Temperature Sensor] Connection failed. Code: {rc}")

# --- Set up client ---
client = mqtt.Client(client_id="temp_sensor_01")
client.on_connect = on_connect
client.connect(BROKER, PORT, keepalive=60)
client.loop_start()

print("[Temperature Sensor] Starting... Publishing every 3 seconds.")
print(f"[Temperature Sensor] Topic: {TOPIC} | QoS: {QOS}")
print("-" * 50)

# --- Main publishing loop ---
try:
    while True:
        # Simulate a temperature reading between 18.0 and 28.0 degrees Celsius
        temperature = round(random.uniform(18.0, 28.0), 1)
        message = f"{temperature}°C"

        result = client.publish(TOPIC, message, qos=QOS, retain=False)

        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            print(f"[Temperature Sensor] Published: {message} → {TOPIC}")
        else:
            print(f"[Temperature Sensor] Publish failed. Error code: {result.rc}")

        time.sleep(3)  # Waits 3 seconds before next reading

except KeyboardInterrupt:
    print("\n[Temperature Sensor] Stopped by user.")
    client.loop_stop()
    client.disconnect()