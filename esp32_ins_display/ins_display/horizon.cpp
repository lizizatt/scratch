#include "horizon.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

namespace {

constexpr float kPi = 3.14159265f;

static const uint8_t kFont5x7[][5] = {
    {0x3E, 0x51, 0x49, 0x45, 0x3E},  // 0
    {0x00, 0x42, 0x7F, 0x40, 0x00},  // 1
    {0x42, 0x61, 0x51, 0x49, 0x46},  // 2
    {0x21, 0x41, 0x45, 0x4B, 0x31},  // 3
    {0x18, 0x14, 0x12, 0x7F, 0x10},  // 4
    {0x27, 0x45, 0x45, 0x45, 0x39},  // 5
    {0x3C, 0x4A, 0x49, 0x49, 0x30},  // 6
    {0x01, 0x71, 0x09, 0x05, 0x03},  // 7
    {0x36, 0x49, 0x49, 0x49, 0x36},  // 8
    {0x06, 0x49, 0x49, 0x29, 0x1E},  // 9
    {0x00, 0x36, 0x36, 0x00, 0x00},  // :
    {0x08, 0x08, 0x2A, 0x1C, 0x08},  // <
    {0x08, 0x1C, 0x2A, 0x08, 0x08},  // >
    {0x00, 0x00, 0x00, 0x00, 0x00},  // space
    {0x00, 0x00, 0x00, 0x00, 0x00},  // -
    {0x7F, 0x09, 0x09, 0x09, 0x06},  // P
    {0x7F, 0x49, 0x49, 0x49, 0x36},  // R
    {0x7F, 0x49, 0x49, 0x49, 0x41},  // E
    {0x3E, 0x41, 0x41, 0x41, 0x22},  // C
    {0x46, 0x49, 0x49, 0x49, 0x31},  // S
    {0x7C, 0x12, 0x11, 0x12, 0x7C},  // H
    {0x7F, 0x40, 0x40, 0x40, 0x40},  // L
    {0x7F, 0x09, 0x19, 0x29, 0x46},  // Y
    {0x3E, 0x41, 0x41, 0x41, 0x7F},  // A
};

int font_index(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c == ':') return 10;
  if (c == '<') return 11;
  if (c == '>') return 12;
  if (c == ' ') return 13;
  if (c == '-') return 14;
  if (c == 'P') return 15;
  if (c == 'R') return 16;
  if (c == 'E') return 17;
  if (c == 'C') return 18;
  if (c == 'S') return 19;
  if (c == 'H') return 20;
  if (c == 'L') return 21;
  if (c == 'Y') return 22;
  if (c == 'A') return 23;
  return 13;
}

void put_px(uint16_t* fb, int x, int y, uint16_t color) {
  if (x < 0 || y < 0 || x >= LCD_W || y >= LCD_H) return;
  const int cx = LCD_W / 2;
  const int cy = LCD_H / 2;
  const int dx = x - cx;
  const int dy = y - cy;
  if (dx * dx + dy * dy > (cx - 2) * (cx - 2)) return;
  fb[y * LCD_W + x] = color;
}

void draw_char(uint16_t* fb, int x, int y, char c, uint16_t color) {
  const int idx = font_index(c);
  for (int col = 0; col < 5; ++col) {
    uint8_t bits = kFont5x7[idx][col];
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

void fill(uint16_t* fb, uint16_t color) {
  for (int i = 0; i < LCD_W * LCD_H; ++i) {
    fb[i] = color;
  }
}

void draw_ring(uint16_t* fb) {
  const int cx = LCD_W / 2;
  const int cy = LCD_H / 2;
  const int r = cx - 2;
  for (int y = 0; y < LCD_H; ++y) {
    for (int x = 0; x < LCD_W; ++x) {
      const int dx = x - cx;
      const int dy = y - cy;
      const int d2 = dx * dx + dy * dy;
      if (d2 > r * r) {
        fb[y * LCD_W + x] = 0;
      } else if (d2 > (r - 2) * (r - 2)) {
        fb[y * LCD_W + x] = COLOR_RING;
      }
    }
  }
}

}  // namespace

void horizon_render(uint16_t* fb, const Attitude& att) {
  const float pitch = att.pitch_deg * kPi / 180.0f;
  const float roll = att.roll_deg * kPi / 180.0f;
  const float cp = cosf(pitch);
  const float sp = sinf(pitch);
  const float cr = cosf(roll);
  const float sr = sinf(roll);

  const int cx = LCD_W / 2;
  const int cy = LCD_H / 2;

  for (int y = 0; y < LCD_H; ++y) {
    for (int x = 0; x < LCD_W; ++x) {
      float px = static_cast<float>(x - cx);
      float py = static_cast<float>(y - cy);

      // Inverse rotation: roll then pitch to classify sky vs ground.
      float xr = px * cr + py * sr;
      float yr = -px * sr + py * cr;
      float yp = yr * cp - xr * sp;

      fb[y * LCD_W + x] = (yp < 0.0f) ? COLOR_SKY : COLOR_GROUND;
    }
  }

  // Horizon line: pixels where transformed "up" component is zero.
  for (int x = 0; x < LCD_W; ++x) {
    const float px = static_cast<float>(x - cx);
    const float denom = cr * cp - sr * sp;
    float py_h = 0.0f;
    if (fabsf(denom) > 0.05f) {
      py_h = px * (cr * sp + sr * cp) / denom;
    }
    const int yline = cy + static_cast<int>(py_h);
    for (int dy = -1; dy <= 1; ++dy) {
      put_px(fb, x, yline + dy, COLOR_LINE);
    }
  }

  // Aircraft reference mark.
  put_px(fb, cx - 20, cy, COLOR_LINE);
  put_px(fb, cx - 19, cy, COLOR_LINE);
  put_px(fb, cx + 19, cy, COLOR_LINE);
  put_px(fb, cx + 20, cy, COLOR_LINE);
  put_px(fb, cx, cy, COLOR_LINE);
  put_px(fb, cx, cy - 1, COLOR_LINE);

  draw_ring(fb);

  char buf[32];
  snprintf(buf, sizeof(buf), "P:%+5.0f", att.pitch_deg);
  draw_text(fb, 70, 18, buf, COLOR_TEXT);
  snprintf(buf, sizeof(buf), "R:%+5.0f", att.roll_deg);
  draw_text(fb, 70, 30, buf, COLOR_TEXT);
  snprintf(buf, sizeof(buf), "H:%+5.0f", att.yaw_deg);
  draw_text(fb, 70, 210, buf, COLOR_TEXT);
  draw_text(fb, 52, 210, "REL", COLOR_TEXT);
}
