#pragma once

#include "imu.h"

struct Attitude {
  float pitch_deg;
  float roll_deg;
  float yaw_deg;
};

class AttitudeFilter {
 public:
  void begin();
  void update(const ImuSample& s, float dt_s);
  void zero_yaw();

  const Attitude& attitude() const { return att_; }

 private:
  Attitude att_{};
  bool have_gyro_bias_ = false;
  float gx_bias_ = 0;
  float gy_bias_ = 0;
  float gz_bias_ = 0;
  int cal_samples_ = 0;
};
