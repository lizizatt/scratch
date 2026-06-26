#pragma once

#include <stdint.h>

struct ShConnectorPin {
  uint8_t gpio;
  uint8_t cable_pin;  // position on 12-pin SH1.0 (NuttX P2.x mapping)
  const char* label;
};

constexpr ShConnectorPin kShPins[] = {
    {15, 7, "MTR B2"},
    {16, 8, "MTR A1"},
    {17, 9, "MPU SCL"},
    {18, 10, "MPU SDA"},
    {21, 11, "MTR A2"},
    {33, 12, "MTR B1"},
};
constexpr int kShPinCount = 6;

void pin_finder_begin();
void pin_finder_update(uint32_t now_ms);
void pin_finder_render(uint16_t* fb);
int pin_finder_active_index();
void pin_finder_end();
