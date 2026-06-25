#include "pin_finder.h"

#include <Arduino.h>
#include <stdio.h>

#include "board_pins.h"

namespace {

constexpr uint16_t kBg = 0x0000;
constexpr uint16_t kTitle = 0xFFFF;
constexpr uint16_t kHot = 0xF800;
constexpr uint16_t kLabel = 0x7BEF;
constexpr uint16_t kHint = 0xFFE0;
constexpr uint32_t kStepMs = 3000;
constexpr uint32_t kToggleMs = 400;

static const uint8_t kFont5x7[][5] = {
    {0x3E, 0x51, 0x49, 0x45, 0x3E},
    {0x00, 0x42, 0x7F, 0x40, 0x00},
    {0x42, 0x61, 0x51, 0x49, 0x46},
    {0x21, 0x41, 0x45, 0x4B, 0x31},
    {0x18, 0x14, 0x12, 0x7F, 0x10},
    {0x27, 0x45, 0x45, 0x45, 0x39},
    {0x3C, 0x4A, 0x49, 0x49, 0x30},
    {0x01, 0x71, 0x09, 0x05, 0x03},
    {0x36, 0x49, 0x49, 0x49, 0x36},
    {0x06, 0x49, 0x49, 0x29, 0x1E},
    {0x00, 0x36, 0x36, 0x00, 0x00},
    {0x00, 0x00, 0x00, 0x00, 0x00},
    {0x00, 0x00, 0x00, 0x00, 0x00},
    {0x40, 0x40, 0x40, 0x40, 0x40},
    {0x7F, 0x49, 0x49, 0x49, 0x41},
    {0x7F, 0x09, 0x09, 0x09, 0x06},
    {0x3E, 0x41, 0x41, 0x41, 0x22},
    {0x46, 0x49, 0x49, 0x29, 0x1E},
    {0x7F, 0x49, 0x49, 0x49, 0x36},
    {0x7F, 0x08, 0x08, 0x08, 0x7F},
    {0x00, 0x41, 0x7F, 0x41, 0x00},
    {0x7F, 0x40, 0x40, 0x40, 0x40},
    {0x7F, 0x02, 0x04, 0x02, 0x7F},
    {0x7F, 0x04, 0x08, 0x10, 0x7F},
    {0x3E, 0x41, 0x41, 0x41, 0x3E},
    {0x7F, 0x09, 0x09, 0x09, 0x06},
    {0x3E, 0x41, 0x51, 0x21, 0x5E},
    {0x7F, 0x09, 0x19, 0x29, 0x46},
    {0x26, 0x49, 0x49, 0x49, 0x32},
    {0x01, 0x01, 0x7F, 0x01, 0x01},
    {0x3F, 0x40, 0x40, 0x40, 0x3F},
    {0x7C, 0x12, 0x11, 0x12, 0x7C},
    {0x7F, 0x49, 0x49, 0x36, 0x00},
};

int font_index(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c == '.') return 10;
  if (c == ' ') return 11;
  if (c == '-') return 12;
  if (c == '+') return 13;
  if (c == ':') return 14;
  if (c == 'E') return 15;
  if (c == 'M') return 16;
  if (c == 'O') return 17;
  if (c == 'F') return 18;
  if (c == 'N') return 19;
  if (c == 'Q') return 20;
  if (c == 'I') return 21;
  if (c == 'U') return 22;
  if (c == 'D') return 23;
  if (c == 'B') return 24;
  if (c == 'G') return 25;
  if (c == 'A') return 26;
  if (c == 'X') return 27;
  if (c == 'Y') return 28;
  if (c == 'Z') return 29;
  if (c == 'P') return 30;
  if (c == 'S') return 31;
  if (c == 'C') return 32;
  if (c == 'L') return 33;
  if (c == 'R') return 34;
  if (c == 'V') return 15;
  if (c == 'T') return 23;
  if (c == 'H') return 16;
  if (c == 'W') return 17;
  return 11;
}

void put_px(uint16_t* fb, int x, int y, uint16_t color) {
  if (x < 0 || y < 0 || x >= LCD_W || y >= LCD_H) return;
  const int cx = LCD_W / 2;
  const int cy = LCD_H / 2;
  const int dx = x - cx;
  const int dy = y - cy;
  if (dx * dx + dy * dy > (cx - 4) * (cx - 4)) return;
  fb[y * LCD_W + x] = color;
}

void draw_char(uint16_t* fb, int x, int y, char c, uint16_t color) {
  const int idx = font_index(c);
  for (int col = 0; col < 5; ++col) {
    const uint8_t bits = kFont5x7[idx][col];
    for (int row = 0; row < 7; ++row) {
      if (bits & (1 << row)) {
        put_px(fb, x + col, y + row, color);
      }
    }
  }
}

void draw_text(uint16_t* fb, int x, int y, const char* text, uint16_t color) {
  int cx = x;
  for (const char* p = text; *p; ++p) {
    draw_char(fb, cx, y, *p, color);
    cx += 6;
  }
}

int g_index = 0;
bool g_level = false;
uint32_t g_last_step = 0;
uint32_t g_last_toggle = 0;

void release_all() {
  for (int i = 0; i < kShPinCount; ++i) {
    pinMode(kShPins[i].gpio, INPUT);
  }
}

void apply_output() {
  release_all();
  pinMode(kShPins[g_index].gpio, OUTPUT);
  digitalWrite(kShPins[g_index].gpio, g_level ? HIGH : LOW);
}

}  // namespace

void pin_finder_begin() {
  g_index = 0;
  g_level = false;
  g_last_step = millis();
  g_last_toggle = g_last_step;
  release_all();
  apply_output();

  Serial.println();
  Serial.println("=== PIN FINDER (12-wire cable, 6 active GPIOs) ===");
  Serial.println("Meter each loose wire vs GND on the JST. The live wire toggles 0V / 3.3V.");
  Serial.println("Pins 1-6 on the connector are usually NC (no beep on meter).");
  Serial.println("Active signals are likely cable pins 7-12 = GPIO15,16,17,18,21,33.");
  Serial.println("Press 'd' in serial monitor for IMU debug mode.");
  Serial.println();
  pin_finder_update(millis());
}

int pin_finder_active_index() {
  return g_index;
}

void pin_finder_update(uint32_t now_ms) {
  if (now_ms - g_last_toggle >= kToggleMs) {
    g_last_toggle = now_ms;
    g_level = !g_level;
    apply_output();
  }

  if (now_ms - g_last_step >= kStepMs) {
    g_last_step = now_ms;
    g_index = (g_index + 1) % kShPinCount;
    g_level = true;
    apply_output();

    const ShConnectorPin& p = kShPins[g_index];
    Serial.printf(">>> Cable pin %u = GPIO%u toggling (0V <-> 3.3V)", p.cable_pin, p.gpio);
    if (p.label[0]) {
      Serial.printf("  [%s]", p.label);
    }
    Serial.println();
  }
}

void pin_finder_render(uint16_t* fb) {
  for (int i = 0; i < LCD_W * LCD_H; ++i) {
    fb[i] = kBg;
  }

  const ShConnectorPin& p = kShPins[g_index];
  char buf[28];

  draw_text(fb, 60, 16, "PIN FINDER", kTitle);
  draw_text(fb, 48, 30, "METER WIRES", kLabel);

  snprintf(buf, sizeof(buf), "GPIO %u", p.gpio);
  draw_text(fb, 78, 70, buf, kHot);

  snprintf(buf, sizeof(buf), "CABLE %u", p.cable_pin);
  draw_text(fb, 72, 88, buf, kLabel);

  snprintf(buf, sizeof(buf), "%s", g_level ? "3.3V NOW" : "0V NOW");
  draw_text(fb, 66, 112, buf, g_level ? kHot : kLabel);

  if (p.label[0]) {
    draw_text(fb, 60, 134, p.label, kHint);
  }

  draw_text(fb, 24, 168, "VS GND:BEEP?", kLabel);
  draw_text(fb, 30, 182, "6 OF 12 LIVE", kLabel);
  draw_text(fb, 42, 204, "SER:d=IMU", kHint);
}

void pin_finder_end() {
  release_all();
}
