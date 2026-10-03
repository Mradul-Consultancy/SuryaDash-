/* ═══════════════════════════════════════════════════════════════
   SOLAR COLLECTOR — ESP32 FIRMWARE
   ───────────────────────────────────────────────────────────────
   Reads:  4x DS18B20 (OneWire, temperature) → T1 T2 T3 T4
           2x YF-S201  (pulse counting, flow)  → F1 F2
   Drives: 4x relay channels → power, solenoid, pump, lamp
   Talks:  Firebase Realtime Database via REST API
           (works with the multi-site schema: /sites/{SITE_ID}/...)

   LIBRARIES REQUIRED (Arduino IDE → Library Manager):
     - OneWire            (Paul Stoffregen)
     - DallasTemperature   (Miles Burton)
     - ArduinoJson         (Benoit Blanchon)  v6.x
     - Firebase ESP Client (Mobizt) — OR plain HTTPClient (used below,
       no extra Firebase library needed — pure REST, works with
       Firebase's "legacy token" or a service-account-signed ID token)

   BOARD: ESP32 Dev Module (any ESP32-WROOM based board)
   ═══════════════════════════════════════════════════════════════ */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <ArduinoJson.h>

/* ═══════════════════════════════════════════════════════════════
   ⚠ CONFIGURATION — EDIT THESE 6 LINES BEFORE FLASHING
   ═══════════════════════════════════════════════════════════════ */
const char* WIFI_SSID      = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD  = "YOUR_WIFI_PASSWORD";
const char* FIREBASE_HOST  = "solar-thermal-e-harvesting-default-rtdb.firebaseio.com";
const char* FIREBASE_AUTH  = "YOUR_DATABASE_SECRET_OR_ID_TOKEN"; // Firebase Console → Project Settings → Service Accounts → Database Secrets (legacy) — or a signed-in user's idToken for rules-based auth
const char* SITE_ID        = "site_main";  // Copy from the dashboard: Settings → Active Site → Site ID
const unsigned long PUSH_INTERVAL_MS = 2000;  // how often to push sensor data (match dashboard poll rate)

/* ═══════════════════════════════════════════════════════════════
   PIN MAP — adjust to your wiring
   ═══════════════════════════════════════════════════════════════ */
#define ONEWIRE_BUS_T1   4    // DS18B20 #1 — Storage
#define ONEWIRE_BUS_T2   5    // DS18B20 #2 — Inlet
#define ONEWIRE_BUS_T3   18   // DS18B20 #3 — Absorber
#define ONEWIRE_BUS_T4   19   // DS18B20 #4 — Outlet

#define FLOW_PIN_F1      25   // YF-S201 inlet  (interrupt-capable pin)
#define FLOW_PIN_F2      26   // YF-S201 outlet (interrupt-capable pin)

#define RELAY_POWER      13
#define RELAY_SOLENOID   14
#define RELAY_PUMP       27
#define RELAY_LAMP       32

/* Each DS18B20 needs its own OneWire bus in this simple wiring
   (one sensor per pin). If you prefer a single shared bus with
   4 sensors and hard-coded ROM addresses, see the ALT wiring
   note at the bottom of this file. */
OneWire oneWireT1(ONEWIRE_BUS_T1);
OneWire oneWireT2(ONEWIRE_BUS_T2);
OneWire oneWireT3(ONEWIRE_BUS_T3);
OneWire oneWireT4(ONEWIRE_BUS_T4);
DallasTemperature sensT1(&oneWireT1);
DallasTemperature sensT2(&oneWireT2);
DallasTemperature sensT3(&oneWireT3);
DallasTemperature sensT4(&oneWireT4);

/* ── Flow sensor pulse counting (interrupt-driven) ────────────── */
volatile uint32_t pulseCountF1 = 0;
volatile uint32_t pulseCountF2 = 0;
void IRAM_ATTR isrF1() { pulseCountF1++; }
void IRAM_ATTR isrF2() { pulseCountF2++; }

// YF-S201 calibration: frequency(Hz) = 7.5 * flow(L/min)  → flow = pulses/interval / 7.5 * 60
const float FLOW_CALIBRATION = 7.5;

/* ── State ────────────────────────────────────────────────────── */
unsigned long lastPush = 0;
unsigned long lastFlowSample = 0;
bool ctrl_power = false, ctrl_solenoid = false, ctrl_pump = false, ctrl_lamp = false;

/* ═══════════════════════════════════════════════════════════════
   SETUP
   ═══════════════════════════════════════════════════════════════ */
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== SuryaDash ESP32 Firmware ===");

  // Relay pins
  pinMode(RELAY_POWER, OUTPUT);    digitalWrite(RELAY_POWER, LOW);
  pinMode(RELAY_SOLENOID, OUTPUT); digitalWrite(RELAY_SOLENOID, LOW);
  pinMode(RELAY_PUMP, OUTPUT);     digitalWrite(RELAY_PUMP, LOW);
  pinMode(RELAY_LAMP, OUTPUT);     digitalWrite(RELAY_LAMP, LOW);

  // Flow sensor interrupts
  pinMode(FLOW_PIN_F1, INPUT_PULLUP);
  pinMode(FLOW_PIN_F2, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_PIN_F1), isrF1, RISING);
  attachInterrupt(digitalPinToInterrupt(FLOW_PIN_F2), isrF2, RISING);

  // Temperature sensors
  sensT1.begin(); sensT2.begin(); sensT3.begin(); sensT4.begin();

  connectWiFi();
  lastFlowSample = millis();
  lastPush = millis();
}

/* ═══════════════════════════════════════════════════════════════
   WIFI
   ═══════════════════════════════════════════════════════════════ */
void connectWiFi() {
  Serial.printf("Connecting to WiFi: %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint8_t retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 40) {
    delay(500); Serial.print(".");
    retries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\nWiFi FAILED — will retry in loop()");
  }
}

/* ═══════════════════════════════════════════════════════════════
   READ SENSORS
   ═══════════════════════════════════════════════════════════════ */
struct Reading { float T1,T2,T3,T4,F1,F2; };

Reading readSensors(float flowIntervalSec) {
  Reading r;

  sensT1.requestTemperatures(); r.T1 = sensT1.getTempCByIndex(0);
  sensT2.requestTemperatures(); r.T2 = sensT2.getTempCByIndex(0);
  sensT3.requestTemperatures(); r.T3 = sensT3.getTempCByIndex(0);
  sensT4.requestTemperatures(); r.T4 = sensT4.getTempCByIndex(0);

  // Guard against disconnected sensor (-127.00 is DallasTemperature's error code)
  if (r.T1 < -100) r.T1 = 0;
  if (r.T2 < -100) r.T2 = 0;
  if (r.T3 < -100) r.T3 = 0;
  if (r.T4 < -100) r.T4 = 0;

  noInterrupts();
  uint32_t p1 = pulseCountF1; pulseCountF1 = 0;
  uint32_t p2 = pulseCountF2; pulseCountF2 = 0;
  interrupts();

  float hz1 = p1 / flowIntervalSec;
  float hz2 = p2 / flowIntervalSec;
  r.F1 = hz1 / FLOW_CALIBRATION;   // L/min
  r.F2 = hz2 / FLOW_CALIBRATION;

  return r;
}

/* ═══════════════════════════════════════════════════════════════
   PUSH TO FIREBASE  (PATCH /sites/{SITE_ID}/sensors.json)
   ═══════════════════════════════════════════════════════════════ */
bool pushSensorData(const Reading& r) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();   // for production, pin the Firebase root CA instead
  HTTPClient https;

  String url = "https://" + String(FIREBASE_HOST) + "/sites/" + String(SITE_ID) +
               "/sensors.json?auth=" + String(FIREBASE_AUTH);

  StaticJsonDocument<256> doc;
  doc["T1"] = round(r.T1 * 10) / 10.0;
  doc["T2"] = round(r.T2 * 10) / 10.0;
  doc["T3"] = round(r.T3 * 10) / 10.0;
  doc["T4"] = round(r.T4 * 10) / 10.0;
  doc["F1"] = round(r.F1 * 100) / 100.0;
  doc["F2"] = round(r.F2 * 100) / 100.0;
  doc["updated_at"] = millis();   // device uptime ms, dashboard uses its own clock too

  String payload;
  serializeJson(doc, payload);

  https.begin(client, url);
  https.addHeader("Content-Type", "application/json");
  int code = https.PATCH(payload);
  https.end();

  if (code == 200) {
    Serial.printf("✔ Pushed  T:[%.1f %.1f %.1f %.1f]  F:[%.2f %.2f]\n", r.T1,r.T2,r.T3,r.T4,r.F1,r.F2);
    return true;
  } else {
    Serial.printf("✘ Push failed, HTTP %d\n", code);
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════
   PULL CONTROL STATES  (GET /sites/{SITE_ID}/controls.json)
   ═══════════════════════════════════════════════════════════════ */
bool pullControls() {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient https;

  String url = "https://" + String(FIREBASE_HOST) + "/sites/" + String(SITE_ID) +
               "/controls.json?auth=" + String(FIREBASE_AUTH);

  https.begin(client, url);
  int code = https.GET();
  if (code != 200) { https.end(); return false; }

  String payload = https.getString();
  https.end();

  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, payload);
  if (err) { Serial.println("JSON parse error on controls"); return false; }

  ctrl_power    = doc["power"]    | false;
  ctrl_solenoid = doc["solenoid"] | false;
  ctrl_pump     = doc["pump"]     | false;
  ctrl_lamp     = doc["lamp"]     | false;

  digitalWrite(RELAY_POWER,    ctrl_power    ? HIGH : LOW);
  digitalWrite(RELAY_SOLENOID, ctrl_solenoid ? HIGH : LOW);
  digitalWrite(RELAY_PUMP,     ctrl_pump     ? HIGH : LOW);
  digitalWrite(RELAY_LAMP,     ctrl_lamp     ? HIGH : LOW);

  return true;
}

/* ═══════════════════════════════════════════════════════════════
   MAIN LOOP
   ═══════════════════════════════════════════════════════════════ */
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    delay(1000);
    return;
  }

  unsigned long now = millis();

  if (now - lastPush >= PUSH_INTERVAL_MS) {
    float intervalSec = (now - lastPush) / 1000.0;
    Reading r = readSensors(intervalSec);

    pushSensorData(r);
    pullControls();

    lastPush = now;
  }

  delay(50);  // small yield
}

/* ═══════════════════════════════════════════════════════════════
   ALT WIRING NOTE — shared OneWire bus with 4 sensors
   ─────────────────────────────────────────────────────────────
   If you wire all 4 DS18B20s on ONE data pin (with one 4.7kΩ
   pull-up resistor), use this instead of 4 separate OneWire buses:

     OneWire oneWire(4);
     DallasTemperature sensors(&oneWire);
     DeviceAddress addrT1, addrT2, addrT3, addrT4;
     // In setup(): sensors.begin(); then use sensors.getAddress(addrT1, 0) etc.
     // to discover each sensor's unique ROM address (print addresses once,
     // then hard-code them here for reliable indexing).
   ═══════════════════════════════════════════════════════════════ */
