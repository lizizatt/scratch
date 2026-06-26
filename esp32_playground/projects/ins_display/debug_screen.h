#pragma once

#include "imu.h"

void debug_screen_render(uint16_t* fb, const ImuStatus& onboard, const ImuStatus& external);
