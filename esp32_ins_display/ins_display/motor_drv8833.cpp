#include "motor_drv8833.h"

#include "board_pins.h"

namespace {

constexpr uint8_t kMinRunPct = 40;
constexpr uint8_t kFullDigitalPct = 90;
constexpr uint32_t kPwmFreqHz = 20000;
constexpr uint8_t kPwmBits = 8;
constexpr uint16_t kPwmMax = (1u << kPwmBits) - 1;

bool g_armed = false;
bool g_test_on = false;
uint8_t g_test_channel = 0;  // 0=both, 1=A only, 2=B only
bool g_motor_b_invert = false;
bool g_test_reverse = false;
uint8_t g_pct_a = 0;
uint8_t g_pct_b = 0;

const uint8_t kMotorPins[] = {PIN_MOTOR_A1, PIN_MOTOR_A2, PIN_MOTOR_B1, PIN_MOTOR_B2};

void reply(const char* msg) {
  Serial.println(msg);
}

void drv8833_wake() {
#if defined(PIN_DRV_SLEEP)
  pinMode(PIN_DRV_SLEEP, OUTPUT);
  digitalWrite(PIN_DRV_SLEEP, LOW);
  delay(20);
  digitalWrite(PIN_DRV_SLEEP, HIGH);
  delay(5);
#endif
}

void drv8833_sleep() {
#if defined(PIN_DRV_SLEEP)
  pinMode(PIN_DRV_SLEEP, OUTPUT);
  digitalWrite(PIN_DRV_SLEEP, LOW);
#endif
}

void pin_coast(uint8_t pin) {
  ledcDetach(pin);
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
}

void pin_full_on(uint8_t pin) {
  ledcDetach(pin);
  pinMode(pin, OUTPUT);
  digitalWrite(pin, HIGH);
}

// DRV8833: IN1=1 IN2=0 -> forward, IN1=0 IN2=1 -> reverse, both 0 -> coast, both 1 -> brake
void drive_bridge(uint8_t in1, uint8_t in2, uint8_t pct, bool forward) {
  pct = constrain(pct, 0, 100);
  if (pct == 0) {
    pin_coast(in1);
    pin_coast(in2);
    return;
  }

  const uint8_t run = pct < kMinRunPct ? kMinRunPct : pct;
  const uint8_t pin_on = forward ? in1 : in2;
  const uint8_t pin_off = forward ? in2 : in1;

  pin_coast(pin_off);

  if (run >= kFullDigitalPct) {
    pin_full_on(pin_on);
    return;
  }

  const uint16_t duty = static_cast<uint16_t>((static_cast<uint32_t>(run) * kPwmMax) / 100);
  ledcAttach(pin_on, kPwmFreqHz, kPwmBits);
  ledcWrite(pin_on, duty);
}

void all_pins_coast() {
  for (uint8_t pin : kMotorPins) {
    pin_coast(pin);
  }
}

void apply_motor_a(uint8_t pct, bool forward = true) {
  drive_bridge(PIN_MOTOR_A1, PIN_MOTOR_A2, pct, forward);
}

void apply_motor_b(uint8_t pct, bool forward = true) {
  drive_bridge(PIN_MOTOR_B1, PIN_MOTOR_B2, pct, forward);
}

void apply_motors() {
  if (g_test_on) {
  const uint8_t pct = 100;
    if (g_test_channel == 1) {
      apply_motor_a(pct, !g_test_reverse);
      pin_coast(PIN_MOTOR_B1);
      pin_coast(PIN_MOTOR_B2);
      return;
    }
    if (g_test_channel == 2) {
      pin_coast(PIN_MOTOR_A1);
      pin_coast(PIN_MOTOR_A2);
      apply_motor_b(pct, !g_test_reverse);
      return;
    }
    apply_motor_a(pct, true);
    apply_motor_b(pct, !g_motor_b_invert);
    return;
  }

  if (!g_armed && (g_pct_a > 0 || g_pct_b > 0)) {
    g_pct_a = 0;
    g_pct_b = 0;
  }

  apply_motor_a(g_pct_a, true);
  apply_motor_b(g_pct_b, !g_motor_b_invert);
}

void motor_stop() {
  g_armed = false;
  g_test_on = false;
  g_test_channel = 0;
  g_test_reverse = false;
  g_pct_a = 0;
  g_pct_b = 0;
  all_pins_coast();
  drv8833_sleep();
}

void set_both(uint8_t pct) {
  g_pct_a = g_pct_b = constrain(pct, 0, 100);
  apply_motors();
}

bool begin_test_hold(const String& line) {
  g_test_on = true;
  g_test_channel = 0;
  g_test_reverse = false;

  if (line.startsWith("TEST,")) {
    const String arg = line.substring(5);
    if (arg.equalsIgnoreCase("A") || arg.equalsIgnoreCase("A,REV")) {
      g_test_channel = 1;
      g_test_reverse = arg.endsWith(",REV");
    } else if (arg.equalsIgnoreCase("B") || arg.equalsIgnoreCase("B,REV")) {
      g_test_channel = 2;
      g_test_reverse = arg.endsWith(",REV");
    }
  }

  const uint8_t pct = 100;
  const bool fwd = !g_test_reverse;
  drv8833_wake();
  if (g_test_channel == 1) {
    apply_motor_a(pct, fwd);
    pin_coast(PIN_MOTOR_B1);
    pin_coast(PIN_MOTOR_B2);
  } else if (g_test_channel == 2) {
    pin_coast(PIN_MOTOR_A1);
    pin_coast(PIN_MOTOR_A2);
    apply_motor_b(pct, fwd);
  } else {
    apply_motor_a(pct, fwd);
    apply_motor_b(pct, !g_motor_b_invert);
  }

  reply(g_test_reverse ? "OK,TEST,HOLD,REV" : "OK,TEST,HOLD");
  reply("HOLD,press_any_key_to_stop");
  reply("DIAG,motor across OUT1-OUT2 not OUT-GND; meter OUT1 vs OUT2 ~7V");
  reply("DIAG,J2 OPEN; EEP -> GPIO4; ULT high=fault if low");
  while (g_test_on) {
    if (Serial.available()) {
      while (Serial.available()) {
        Serial.read();
      }
      motor_stop();
      reply("OK,TEST,OFF");
      return true;
    }
    delay(10);
  }
  return true;
}

void handle_ramp(const String& line) {
  if (!g_armed) {
    reply("ERR,DISARMED");
    return;
  }

  int c1 = line.indexOf(',', 5);
  int c2 = line.indexOf(',', c1 + 1);
  int c3 = line.indexOf(',', c2 + 1);
  if (c3 < 0) {
    reply("ERR,RAMP_FMT");
    return;
  }

  int start = line.substring(c2 + 1, c3).toInt();
  int end;
  int step_ms = 40;
  int c4 = line.indexOf(',', c3 + 1);
  if (c4 < 0) {
    end = line.substring(c3 + 1).toInt();
  } else {
    end = line.substring(c3 + 1, c4).toInt();
    step_ms = line.substring(c4 + 1).toInt();
  }

  start = constrain(start, 0, 100);
  end = constrain(end, 0, 100);
  step_ms = constrain(step_ms, 10, 500);

  const int step = (start <= end) ? 1 : -1;
  for (int p = start; (step > 0) ? (p <= end) : (p >= end); p += step) {
    set_both(static_cast<uint8_t>(p));
    delay(static_cast<unsigned>(step_ms));
  }

  String ack = "OK,A," + String(g_pct_a) + ",B," + String(g_pct_b);
  reply(ack.c_str());
}

bool require_arm(uint8_t pct) {
  return !g_armed && pct > 0;
}

void handle_line(String line) {
  line.trim();
  if (line.length() == 0) {
    return;
  }

  if (line.equalsIgnoreCase("PING")) {
    reply("PONG,DRV8833");
    return;
  }
  if (line.equalsIgnoreCase("STATUS")) {
    String s = "OK,ARM," + String(g_armed ? 1 : 0);
    s += ",TEST," + String(g_test_on ? 1 : 0);
    s += ",INV_B," + String(g_motor_b_invert ? 1 : 0);
    s += ",A," + String(g_pct_a) + ",B," + String(g_pct_b);
    reply(s.c_str());
    return;
  }
  if (line.equalsIgnoreCase("TEST,ON") || line.equalsIgnoreCase("TEST,FULL") ||
      line.startsWith("TEST,") || line.equalsIgnoreCase("DIAG,ON")) {
    begin_test_hold(line);
    return;
  }
  if (line.equalsIgnoreCase("WAKE")) {
    drv8833_wake();
    reply("OK,WAKE");
    return;
  }
  if (line.equalsIgnoreCase("TEST,OFF") || line.equalsIgnoreCase("DIAG,OFF")) {
    motor_stop();
    reply("OK,TEST,OFF");
    return;
  }
  if (line.equalsIgnoreCase("ARM")) {
    g_armed = true;
    reply("OK,ARMED");
    return;
  }
  if (line.equalsIgnoreCase("DISARM") || line.equalsIgnoreCase("STOP")) {
    motor_stop();
    reply("OK,DISARMED");
    return;
  }
  if (line.startsWith("INV,B,")) {
    g_motor_b_invert = line.substring(6).toInt() != 0;
    reply(g_motor_b_invert ? "OK,INV,B,1" : "OK,INV,B,0");
    return;
  }
  if (line.startsWith("A,")) {
    const int pct = constrain(line.substring(2).toInt(), 0, 100);
    if (require_arm(static_cast<uint8_t>(pct))) {
      reply("ERR,DISARMED");
      return;
    }
    g_pct_a = static_cast<uint8_t>(pct);
    g_pct_b = 0;
    apply_motors();
    String ack = "OK,A," + String(g_pct_a) + ",B," + String(g_pct_b);
    reply(ack.c_str());
    return;
  }
  if (line.startsWith("B,")) {
    const int pct = constrain(line.substring(2).toInt(), 0, 100);
    if (require_arm(static_cast<uint8_t>(pct))) {
      reply("ERR,DISARMED");
      return;
    }
    g_pct_b = static_cast<uint8_t>(pct);
    g_pct_a = 0;
    apply_motors();
    String ack = "OK,A," + String(g_pct_a) + ",B," + String(g_pct_b);
    reply(ack.c_str());
    return;
  }
  if (line.startsWith("M,")) {
    const int pct = constrain(line.substring(2).toInt(), 0, 100);
    if (require_arm(static_cast<uint8_t>(pct))) {
      reply("ERR,DISARMED");
      return;
    }
    set_both(static_cast<uint8_t>(pct));
    String ack = "OK,A," + String(g_pct_a) + ",B," + String(g_pct_b);
    reply(ack.c_str());
    return;
  }
  if (line.startsWith("RAMP,")) {
    handle_ramp(line);
    return;
  }

  reply("ERR,UNKNOWN_CMD");
}

}  // namespace

void motor_handle_line(const String& line) {
  handle_line(line);
}

void motor_begin() {
  all_pins_coast();
  drv8833_wake();
  reply("READY,DISARMED,DRV8833");
  reply("HINT,J2 open; EEP wire to GPIO4 pad if OUT diff=0");
}
