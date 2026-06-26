#include "debug_screen.h"

#include <math.h>
#include <stdio.h>

#include "board_pins.h"

namespace {

constexpr uint16_t kBg = 0x0000;
constexpr uint16_t kTitle = 0xFFFF;
constexpr uint16_t kOk = 0x07E0;
constexpr uint16_t kMiss = 0xF800;
constexpr uint16_t kLabel = 0x7BEF;
constexpr uint16_t kValue = 0xFFE0;

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
  if (c == 'x') return 27;
  if (c == 'y') return 28;
  if (c == 'z') return 29;
  if (c == 'a') return 26;
  if (c == 'g') return 25;
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

void draw_axis_line(uint16_t* fb, int x, int y, char axis, float v, uint16_t color) {
  char buf[12];
  snprintf(buf, sizeof(buf), "%c%+5.2f", axis, v);
  draw_text(fb, x, y, buf, color);
}

void draw_block(uint16_t* fb, int x, int y, const char* title, const ImuStatus& st) {
  draw_text(fb, x, y, title, st.present ? kOk : kMiss);
  if (!st.present) {
    draw_text(fb, x, y + 10, "OFF", kMiss);
    return;
  }
  if (!st.fresh) {
    draw_text(fb, x, y + 10, "ERR", kMiss);
    return;
  }
  draw_axis_line(fb, x, y + 10, 'x', st.sample.ax_g, kValue);
  draw_axis_line(fb, x, y + 19, 'y', st.sample.ay_g, kValue);
  draw_axis_line(fb, x, y + 28, 'z', st.sample.az_g, kValue);
  draw_text(fb, x, y + 40, "G dps", kLabel);
  draw_axis_line(fb, x, y + 49, 'x', st.sample.gx_dps, kValue);
  draw_axis_line(fb, x, y + 58, 'y', st.sample.gy_dps, kValue);
  draw_axis_line(fb, x, y + 67, 'z', st.sample.gz_dps, kValue);
}

}  // namespace

void debug_screen_render(uint16_t* fb, const ImuStatus& onboard, const ImuStatus& external) {
  for (int i = 0; i < LCD_W * LCD_H; ++i) {
    fb[i] = kBg;
  }

  draw_text(fb, 78, 14, "IMU DEBUG", kTitle);
  draw_text(fb, 36, 28, "A=g  G=dps", kLabel);

  draw_block(fb, 24, 44, "Q8658", onboard);
  draw_block(fb, 128, 44, "M6050", external);

  draw_text(fb, 30, 210, "6050:17/18", kLabel);
  draw_text(fb, 30, 222, "pwr:JST", kLabel);
}
