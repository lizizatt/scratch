#pragma once

#include <Wire.h>

#include "board_pins.h"

struct ImuSample {
  float ax_g;
  float ay_g;
  float az_g;
  float gx_dps;
  float gy_dps;
  float gz_dps;
};

struct ImuStatus {
  ImuSample sample{};
  bool present = false;
  bool fresh = false;
};

bool qmi8658_begin();
bool qmi8658_read(ImuSample* out);

bool mpu6050_begin();
bool mpu6050_read(ImuSample* out);
void mpu6050_scan();

void i2c_scan(TwoWire& bus, const char* name);
