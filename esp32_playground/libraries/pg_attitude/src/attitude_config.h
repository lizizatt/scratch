#pragma once

// Keep in sync with tools/pg_attitude.py (verified by tests/test_attitude.py).

constexpr float kAttitudeAlpha = 0.98f;
constexpr int kAttitudeCalTarget = 80;
constexpr float kAttitudeClampDeg = 89.0f;
constexpr float kRadToDeg = 57.2957795f;
