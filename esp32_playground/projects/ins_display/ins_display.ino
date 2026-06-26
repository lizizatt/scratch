// Dual-IMU debug + pin finder + WiFi link for Waveshare ESP32-S3-Touch-LCD-1.28
// Build/flash: ../../build.ps1 -Project ins_display

#include <esp_heap_caps.h>
#include <esp_lcd_panel_ops.h>
#include <pg_link.h>

#include "attitude.h"
#include "board_pins.h"
#include "debug_screen.h"
#include "display.h"
#include "imu.h"
#include "motor_drv8833.h"
#include "pin_finder.h"

enum class AppMode { PinFinder, ImuDebug };

void init_imu_debug();
void init_pin_finder();

static esp_lcd_panel_handle_t g_panel = nullptr;
static uint16_t* g_fb = nullptr;
static uint32_t g_last_draw_ms = 0;
static AppMode g_mode = AppMode::ImuDebug;

static ImuStatus g_onboard{};
static ImuStatus g_external{};
static bool g_imu_inited = false;
static AttitudeFilter g_attitude{};
static uint32_t g_last_imu_ms = 0;

static void on_link_lost() {
  motor_handle_line("STOP");
  pg_link_reply("OK,LINK_LOST,STOP");
}

static void handle_command_line(const String& line) {
  if (line.length() == 1) {
    const char k = line[0];
    if (k == 'd' || k == 'D') {
      if (g_mode != AppMode::ImuDebug) {
        g_mode = AppMode::ImuDebug;
        init_imu_debug();
      }
      return;
    }
    if (k == 'p' || k == 'P') {
      if (g_mode != AppMode::PinFinder) {
        g_mode = AppMode::PinFinder;
        init_pin_finder();
      }
      return;
    }
  }
  motor_handle_line(line);
}

void init_imu_debug() {
  if (g_imu_inited) {
    return;
  }
  pin_finder_end();
  g_onboard.present = qmi8658_begin();
  i2c_scan(Wire, "onboard GPIO6/7");
  g_external.present = mpu6050_begin();
  mpu6050_scan();
  g_attitude.begin();
  g_last_imu_ms = millis();
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

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("=== ESP32 playground: ins_display ===");
  Serial.println("USB serial + WiFi UDP (see docs/WIFI.md)");
  Serial.println("Motors: PING | ARM | A,30 | STOP | TEST,ON (hold until key)");

  pg_link_begin(
#if defined(PG_LINK_NO_WIFI)
      false
#else
      true
#endif
  );
  pg_link_set_link_lost_handler(on_link_lost);

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
  const uint32_t now_ms = millis();
  pg_link_poll(handle_command_line);
  pg_link_tick(now_ms);

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
    if (g_onboard.fresh) {
      const float dt = (now_ms - g_last_imu_ms) * 0.001f;
      g_last_imu_ms = now_ms;
      if (dt > 0.0f && dt < 0.5f) {
        g_attitude.update(g_onboard.sample, dt);
      }
    }
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
      Serial.println("MPU6050: not connected (see docs/WIRING.md)");
    }
  }

  static uint32_t last_tlm = 0;
  if (pg_link_wifi_active() && now_ms - last_tlm >= 50) {
    last_tlm = now_ms;
    const Attitude& att = g_attitude.attitude();
    char buf[96];
    snprintf(buf, sizeof(buf), "TLM,%.2f,%.2f,%.2f", att.pitch_deg, att.roll_deg, att.yaw_deg);
    pg_link_send_telemetry(buf);
  }
}
