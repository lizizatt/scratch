// Dual-IMU debug + pin finder for Waveshare ESP32-S3-Touch-LCD-1.28
// Build/flash: see ../build.ps1 and WIRING.md

#include <esp_heap_caps.h>
#include <esp_lcd_panel_ops.h>

#include "board_pins.h"
#include "debug_screen.h"
#include "display.h"
#include "imu.h"
#include "motor_drv8833.h"
#include "pin_finder.h"

enum class AppMode { PinFinder, ImuDebug };

static esp_lcd_panel_handle_t g_panel = nullptr;
static uint16_t* g_fb = nullptr;
static uint32_t g_last_draw_ms = 0;
static AppMode g_mode = AppMode::ImuDebug;

static ImuStatus g_onboard{};
static ImuStatus g_external{};
static bool g_imu_inited = false;

void init_imu_debug() {
  if (g_imu_inited) {
    return;
  }
  pin_finder_end();
  g_onboard.present = qmi8658_begin();
  i2c_scan(Wire, "onboard GPIO6/7");
  g_external.present = mpu6050_begin();
  mpu6050_scan();
  g_imu_inited = true;
  Serial.println("IMU debug mode. Press 'p' for pin finder.");
}

void init_pin_finder() {
  if (g_imu_inited) {
    g_imu_inited = false;
    g_onboard = {};
    g_external = {};
  }
  pin_finder_begin();
  Serial.println("Pin finder mode. Press 'd' for IMU debug.");
}

void handle_serial_commands() {
  static String line;
  while (Serial.available()) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\n' || c == '\r') {
      if (line.length() == 1) {
        const char k = line[0];
        if (k == 'd' || k == 'D') {
          if (g_mode != AppMode::ImuDebug) {
            g_mode = AppMode::ImuDebug;
            init_imu_debug();
          }
          line = "";
          continue;
        }
        if (k == 'p' || k == 'P') {
          if (g_mode != AppMode::PinFinder) {
            g_mode = AppMode::PinFinder;
            init_pin_finder();
          }
          line = "";
          continue;
        }
      }
      if (line.length() > 0) {
        motor_handle_line(line);
        line = "";
      }
    } else {
      line += c;
      if (line.length() > 56) {
        line = "";
        Serial.println("ERR,LINE_TOO_LONG");
      }
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("=== ESP32 INS / wiring tools ===");
  Serial.println("Boot: IMU debug + motor serial. Press 'p' for pin finder.");
  Serial.println("Motors: PING | ARM | A,30 | B,30 | STOP | TEST,ON (hold until key)");

  g_fb = static_cast<uint16_t*>(heap_caps_malloc(LCD_W * LCD_H * sizeof(uint16_t), MALLOC_CAP_SPIRAM));
  if (!g_fb) {
    g_fb = static_cast<uint16_t*>(malloc(LCD_W * LCD_H * sizeof(uint16_t)));
  }
  if (!g_fb) {
    Serial.println("FATAL: no framebuffer");
    while (true) delay(1000);
  }

  if (!display_begin(&g_panel)) {
    Serial.println("FATAL: display init failed");
    while (true) delay(1000);
  }

  init_imu_debug();
  motor_begin();
  debug_screen_render(g_fb, g_onboard, g_external);
  display_blit_rgb565(g_panel, g_fb);
}

void loop() {
  handle_serial_commands();

  const uint32_t now_ms = millis();

  if (g_mode == AppMode::PinFinder) {
    pin_finder_update(now_ms);
    if (now_ms - g_last_draw_ms >= 150) {
      g_last_draw_ms = now_ms;
      pin_finder_render(g_fb);
      display_blit_rgb565(g_panel, g_fb);
    }
    return;
  }

  if (g_onboard.present) {
    g_onboard.fresh = qmi8658_read(&g_onboard.sample);
  }
  if (g_external.present) {
    g_external.fresh = mpu6050_read(&g_external.sample);
  }

  if (now_ms - g_last_draw_ms >= 100) {
    g_last_draw_ms = now_ms;
    debug_screen_render(g_fb, g_onboard, g_external);
    display_blit_rgb565(g_panel, g_fb);
  }

  static uint32_t last_log = 0;
  if (now_ms - last_log >= 500) {
    last_log = now_ms;
    if (g_onboard.fresh) {
      const ImuSample& q = g_onboard.sample;
      Serial.printf("Q8658 A %+.3f %+.3f %+.3f  G %+.1f %+.1f %+.1f\n",
                    q.ax_g, q.ay_g, q.az_g, q.gx_dps, q.gy_dps, q.gz_dps);
    }
    if (g_external.fresh) {
      const ImuSample& m = g_external.sample;
      Serial.printf("M6050 A %+.3f %+.3f %+.3f  G %+.1f %+.1f %+.1f\n",
                    m.ax_g, m.ay_g, m.az_g, m.gx_dps, m.gy_dps, m.gz_dps);
    }
    if (!g_external.present) {
      Serial.println("MPU6050: not connected (see WIRING.md)");
    }
  }
}
