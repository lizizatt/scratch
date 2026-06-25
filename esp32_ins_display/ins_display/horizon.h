#pragma once

#include <Arduino.h>

#include "attitude.h"
#include "board_pins.h"

static inline uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return static_cast<uint16_t>(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}

#define COLOR_SKY rgb565(30, 120, 220)
#define COLOR_GROUND rgb565(120, 80, 40)
#define COLOR_LINE rgb565(255, 255, 255)
#define COLOR_TEXT rgb565(255, 255, 0)
#define COLOR_RING rgb565(40, 40, 40)

void horizon_render(uint16_t* fb, const Attitude& att);
