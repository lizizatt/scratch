#include "display.h"

#include <Arduino.h>
#include <driver/ledc.h>
#include <driver/spi_master.h>
#include "esp_lcd_gc9a01.h"
#include <esp_lcd_panel_io.h>

#include "board_pins.h"

namespace {

constexpr int kBlFreqHz = 20000;
constexpr int kBlResolution = 10;

uint16_t swap16(uint16_t c) {
  return static_cast<uint16_t>(((c >> 8) & 0xFF) | ((c << 8) & 0xFF00));
}

}  // namespace

bool display_begin(esp_lcd_panel_handle_t* out_panel) {
  spi_bus_config_t buscfg = {};
  buscfg.mosi_io_num = PIN_LCD_MOSI;
  buscfg.miso_io_num = PIN_LCD_MISO;
  buscfg.sclk_io_num = PIN_LCD_SCLK;
  buscfg.quadwp_io_num = -1;
  buscfg.quadhd_io_num = -1;
  buscfg.max_transfer_sz = LCD_W * LCD_H * sizeof(uint16_t);

  if (spi_bus_initialize(SPI2_HOST, &buscfg, SPI_DMA_CH_AUTO) != ESP_OK) {
  }

  esp_lcd_panel_io_handle_t io = nullptr;
  esp_lcd_panel_io_spi_config_t io_cfg = {};
  io_cfg.cs_gpio_num = PIN_LCD_CS;
  io_cfg.dc_gpio_num = PIN_LCD_DC;
  io_cfg.spi_mode = 0;
  io_cfg.pclk_hz = 40 * 1000 * 1000;
  io_cfg.trans_queue_depth = 10;
  io_cfg.lcd_cmd_bits = 8;
  io_cfg.lcd_param_bits = 8;

  if (esp_lcd_new_panel_io_spi(static_cast<esp_lcd_spi_bus_handle_t>(SPI2_HOST), &io_cfg, &io) != ESP_OK) {
    return false;
  }

  esp_lcd_panel_dev_config_t panel_cfg = {};
  panel_cfg.reset_gpio_num = PIN_LCD_RST;
  panel_cfg.rgb_endian = LCD_RGB_ENDIAN_BGR;
  panel_cfg.bits_per_pixel = 16;

  esp_lcd_panel_handle_t panel = nullptr;
  if (esp_lcd_new_panel_gc9a01(io, &panel_cfg, &panel) != ESP_OK) {
    return false;
  }

  esp_lcd_panel_reset(panel);
  esp_lcd_panel_init(panel);
  esp_lcd_panel_invert_color(panel, true);
  esp_lcd_panel_mirror(panel, true, false);
  esp_lcd_panel_disp_on_off(panel, true);

  ledcAttach(PIN_LCD_BL, kBlFreqHz, kBlResolution);
  display_set_backlight(80);

  *out_panel = panel;
  return true;
}

void display_set_backlight(uint8_t percent) {
  if (percent > 100) {
    percent = 100;
  }
  uint32_t duty = percent * 10;
  if (duty == 1000) {
    duty = 1024;
  }
  ledcWrite(PIN_LCD_BL, duty);
}

void display_blit_rgb565(esp_lcd_panel_handle_t panel, const uint16_t* pixels) {
  static uint16_t line[LCD_W];
  for (int y = 0; y < LCD_H; ++y) {
    const uint16_t* src = pixels + y * LCD_W;
    for (int x = 0; x < LCD_W; ++x) {
      line[x] = swap16(src[x]);
    }
    esp_lcd_panel_draw_bitmap(panel, 0, y, LCD_W, y + 1, line);
  }
}
