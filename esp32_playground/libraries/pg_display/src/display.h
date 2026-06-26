#pragma once

#include <esp_lcd_panel_ops.h>

bool display_begin(esp_lcd_panel_handle_t* out_panel);
void display_set_backlight(uint8_t percent);
void display_blit_rgb565(esp_lcd_panel_handle_t panel, const uint16_t* pixels);
