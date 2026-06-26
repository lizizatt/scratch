#include "attitude.h"

#include <Arduino.h>
#include <math.h>

#include "attitude_config.h"

namespace {

float clampf(float v, float lo, float hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

}  // namespace

void AttitudeFilter::begin() {
  att_ = {};
  have_gyro_bias_ = false;
  cal_samples_ = 0;
  gx_bias_ = gy_bias_ = gz_bias_ = 0;
}

void AttitudeFilter::zero_yaw() {
  att_.yaw_deg = 0;
}

void AttitudeFilter::update(const ImuSample& s, float dt_s) {
  if (!have_gyro_bias_) {
    gx_bias_ += s.gx_dps;
    gy_bias_ += s.gy_dps;
    gz_bias_ += s.gz_dps;
    ++cal_samples_;
    if (cal_samples_ >= kAttitudeCalTarget) {
      gx_bias_ /= kAttitudeCalTarget;
      gy_bias_ /= kAttitudeCalTarget;
      gz_bias_ /= kAttitudeCalTarget;
      have_gyro_bias_ = true;
      Serial.printf("Gyro bias: %.2f %.2f %.2f dps\n", gx_bias_, gy_bias_, gz_bias_);
    }
    return;
  }

  const float gx = s.gx_dps - gx_bias_;
  const float gy = s.gy_dps - gy_bias_;
  const float gz = s.gz_dps - gz_bias_;

  const float accel_pitch =
      atan2f(s.ay_g, sqrtf(s.ax_g * s.ax_g + s.az_g * s.az_g)) * kRadToDeg;
  const float accel_roll = atan2f(-s.ax_g, s.az_g) * kRadToDeg;

  att_.pitch_deg =
      kAttitudeAlpha * (att_.pitch_deg + gx * dt_s) + (1.0f - kAttitudeAlpha) * accel_pitch;
  att_.roll_deg =
      kAttitudeAlpha * (att_.roll_deg + gy * dt_s) + (1.0f - kAttitudeAlpha) * accel_roll;
  att_.yaw_deg += gz * dt_s;

  att_.pitch_deg = clampf(att_.pitch_deg, -kAttitudeClampDeg, kAttitudeClampDeg);
  att_.roll_deg = clampf(att_.roll_deg, -kAttitudeClampDeg, kAttitudeClampDeg);
}
