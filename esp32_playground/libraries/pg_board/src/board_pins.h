#pragma once

// Waveshare ESP32-S3-Touch-LCD-1.28 (single round display + QMI8658)

#define LCD_W 240
#define LCD_H 240

#define PIN_LCD_MOSI 11
#define PIN_LCD_MISO 12
#define PIN_LCD_SCLK 10
#define PIN_LCD_CS   9
#define PIN_LCD_DC   8
#define PIN_LCD_RST  14
#define PIN_LCD_BL   2

// Onboard touch + QMI8658
#define PIN_I2C_SDA 6
#define PIN_I2C_SCL 7
#define QMI8658_ADDR 0x6B

// External MPU-6050 on SH1.0 connector (second I2C bus)
#define PIN_MPU_SDA 17
#define PIN_MPU_SCL 18
#define MPU6050_ADDR 0x68

// DRV8833 dual motor (SH1.0 ribbon) — see MOTORS_WIRING.md
#define PIN_MOTOR_A1 16  // IN1
#define PIN_MOTOR_A2 21  // IN2
#define PIN_MOTOR_B1 33  // IN3
#define PIN_MOTOR_B2 15  // IN4
// Optional: wire module EEP/STBY here, keep J2 OPEN (board pad GPIO4 near battery)
#define PIN_DRV_SLEEP 4
