# SuryaDash — Hardware Build Guide

Real wiring instructions for the firmware in `solar_esp32_firmware.ino`.

## Bill of Materials

| Qty | Part | Approx cost | Notes |
|---|---|---|---|
| 1 | ESP32 DevKit (WROOM-32) | $6–9 | Any clone board works |
| 4 | DS18B20 waterproof temp probe | $2–3 each | Stainless steel tip, 1m cable |
| 2 | YF-S201 flow sensor (½" hall-effect) | $5–7 each | Max 30 L/min, 0.5–1 MPa |
| 4 | 5V relay module (1-channel) | $1–2 each | Or one 4-channel board |
| 1 | 4.7kΩ resistor | <$0.10 | Pull-up per OneWire bus (x4 if using separate buses) |
| 1 | 5V 2A power supply | $5 | Powers ESP32 + relay coils |
| — | Dupont/JST wiring, breadboard or perfboard | $5 | |

**Total: ~$45–60** for a fully wired prototype.

## Wiring Diagram (text form)

```
DS18B20 (T1 Storage) ──┬── VCC → 3.3V
                        ├── GND → GND
                        └── DATA → GPIO4  (+ 4.7kΩ pull-up to 3.3V)

DS18B20 (T2 Inlet)     ──── DATA → GPIO5   (own pull-up)
DS18B20 (T3 Absorber)  ──── DATA → GPIO18  (own pull-up)
DS18B20 (T4 Outlet)    ──── DATA → GPIO19  (own pull-up)

YF-S201 (F1 Inlet)  ── Red→5V  Black→GND  Yellow(signal)→GPIO25
YF-S201 (F2 Outlet) ── Red→5V  Black→GND  Yellow(signal)→GPIO26

Relay 1 (Power)    IN → GPIO13
Relay 2 (Solenoid) IN → GPIO14
Relay 3 (Pump)     IN → GPIO27
Relay 4 (Lamp)     IN → GPIO32
(Relay VCC → 5V, GND → GND, COM/NO wired to the actual 12V/220V load —
 NEVER connect mains voltage loads directly to the ESP32.)
```

⚠ **Safety**: If controlling AC pumps/lamps (110–240V), use relays rated for
mains voltage, keep the ESP32 side fully isolated (opto-isolated relay
modules are standard), and if you're not confident with mains wiring,
have a qualified electrician do that part. The signal side (ESP32 → relay
IN pin) is always low-voltage/safe.

## Flow Sensor Calibration

The YF-S201 outputs a frequency proportional to flow rate:

```
Frequency (Hz) = 7.5 × Flow (L/min)
```

This is already programmed into `FLOW_CALIBRATION = 7.5` in the firmware.
If your sensor's datasheet gives a different constant (some clones vary
±10%), measure it directly: run water through a known volume in a timed
bucket test, compare against the sensor's reported pulse count, and adjust
`FLOW_CALIBRATION` accordingly.

## First Boot Checklist

1. Install Arduino IDE, add ESP32 board support (`https://dl.espressif.com/dl/package_esp32_index.json` in Board Manager URLs)
2. Install libraries: **OneWire**, **DallasTemperature**, **ArduinoJson** (v6.x)
3. Edit the 6 config lines at the top of the `.ino` file (WiFi + Firebase)
4. Flash to the ESP32, open Serial Monitor at 115200 baud
5. You should see `WiFi connected!` then `✔ Pushed T:[...]` every 2 seconds
6. Open the dashboard — the Firebase badge should flip to 🟢 CONNECTED within a few seconds

## Getting Your Firebase Auth Token

The firmware pushes with a `?auth=` query parameter. Two options:

- **Quick/legacy**: Firebase Console → ⚙ Project Settings → Service Accounts →
  Database Secrets → generate a legacy secret. Paste into `FIREBASE_AUTH`.
  ⚠ This bypasses all security rules — fine for prototyping, **not** for production.
- **Production**: Create a dedicated "device" user via Firebase Auth (email/password),
  sign in from the firmware using the Auth REST API to get a short-lived `idToken`,
  refresh it periodically. This respects your security rules (see
  `/firebase-config/database.rules.json` — device UIDs get write-only access
  to their own site's `/sensors` path, nothing else).
