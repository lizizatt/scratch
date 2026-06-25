#include "imu.h"

#include <Arduino.h>
#include <Wire.h>

#include "board_pins.h"

namespace {

int16_t be16(const uint8_t* p) {
  return static_cast<int16_t>((p[0] << 8) | p[1]);
}

int16_t le16(const uint8_t* p) {
  return static_cast<int16_t>((p[1] << 8) | p[0]);
}

bool bus_write(TwoWire& bus, uint8_t addr, uint8_t reg, uint8_t val) {
  bus.beginTransmission(addr);
  bus.write(reg);
  bus.write(val);
  return bus.endTransmission() == 0;
}

bool bus_read(TwoWire& bus, uint8_t addr, uint8_t reg, uint8_t* buf, size_t len) {
  bus.beginTransmission(addr);
  bus.write(reg);
  if (bus.endTransmission(false) != 0) {
    return false;
  }
  if (bus.requestFrom(static_cast<int>(addr), static_cast<int>(len)) < static_cast<int>(len)) {
    return false;
  }
  for (size_t i = 0; i < len; ++i) {
    buf[i] = bus.read();
  }
  return true;
}

}  // namespace

void i2c_scan(TwoWire& bus, const char* name) {
  Serial.printf("I2C scan (%s):\n", name);
  int found = 0;
  for (uint8_t addr = 1; addr < 127; ++addr) {
    bus.beginTransmission(addr);
    if (bus.endTransmission() == 0) {
      Serial.printf("  0x%02X\n", addr);
      ++found;
    }
  }
  if (found == 0) {
    Serial.println("  (none)");
  }
}

// --- QMI8658 onboard (Wire / GPIO6+7) ---

namespace qmi {

constexpr uint8_t REG_WHO_AM_I = 0x00;
constexpr uint8_t REG_CTRL1 = 0x02;
constexpr uint8_t REG_CTRL2 = 0x03;
constexpr uint8_t REG_CTRL3 = 0x04;
constexpr uint8_t REG_CTRL7 = 0x08;
constexpr uint8_t REG_RESET = 0x60;
constexpr uint8_t REG_RST_RESULT = 0x4D;
constexpr uint8_t REG_AX_L = 0x35;
constexpr uint8_t EXPECTED_ID = 0x05;

bool reset() {
  if (!bus_write(Wire, QMI8658_ADDR, REG_RESET, 0xB0)) {
    return false;
  }
  for (int i = 0; i < 20; ++i) {
    delay(10);
    uint8_t status = 0;
    if (bus_read(Wire, QMI8658_ADDR, REG_RST_RESULT, &status, 1) && status == 0xFF) {
      return true;
    }
  }
  return false;
}

}  // namespace qmi

bool qmi8658_begin() {
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(400000);
  delay(20);

  uint8_t id = 0;
  if (!bus_read(Wire, QMI8658_ADDR, qmi::REG_WHO_AM_I, &id, 1) || id != qmi::EXPECTED_ID) {
    Serial.printf("QMI8658: bad id 0x%02X\n", id);
    return false;
  }

  if (!qmi::reset()) {
    Serial.println("QMI8658: reset timeout (continuing)");
  }

  bus_write(Wire, QMI8658_ADDR, qmi::REG_CTRL1, 0x40);
  bus_write(Wire, QMI8658_ADDR, qmi::REG_CTRL2, 0x16);
  bus_write(Wire, QMI8658_ADDR, qmi::REG_CTRL3, 0x45);
  bus_write(Wire, QMI8658_ADDR, qmi::REG_CTRL7, 0x03);
  delay(50);

  Serial.println("QMI8658: OK");
  return true;
}

bool qmi8658_read(ImuSample* out) {
  uint8_t raw[12];
  if (!bus_read(Wire, QMI8658_ADDR, qmi::REG_AX_L, raw, sizeof(raw))) {
    return false;
  }

  constexpr float ACC_LSB_PER_G = 8192.0f;
  constexpr float GYR_LSB_PER_DPS = 64.0f;

  out->ax_g = le16(raw + 0) / ACC_LSB_PER_G;
  out->ay_g = le16(raw + 2) / ACC_LSB_PER_G;
  out->az_g = le16(raw + 4) / ACC_LSB_PER_G;
  out->gx_dps = le16(raw + 6) / GYR_LSB_PER_DPS;
  out->gy_dps = le16(raw + 8) / GYR_LSB_PER_DPS;
  out->gz_dps = le16(raw + 10) / GYR_LSB_PER_DPS;
  return true;
}

// --- MPU-6050 external (Wire1 / SH1.0 GPIO17+18) ---

namespace mpu {

constexpr uint8_t REG_WHO_AM_I = 0x75;
constexpr uint8_t REG_PWR_MGMT_1 = 0x6B;
constexpr uint8_t REG_ACCEL = 0x3B;
constexpr uint8_t EXPECTED_ID = 0x68;

TwoWire bus(1);
uint8_t active_addr = MPU6050_ADDR;
int active_sda = PIN_MPU_SDA;
int active_scl = PIN_MPU_SCL;

bool probe(int sda, int scl, uint32_t hz, uint8_t* out_addr) {
  bus.end();
  delay(10);
  pinMode(sda, INPUT_PULLUP);
  pinMode(scl, INPUT_PULLUP);
  bus.begin(sda, scl);
  bus.setClock(hz);
  delay(20);

  for (uint8_t addr : {0x68u, 0x69u}) {
    uint8_t id = 0;
    if (bus_read(bus, addr, REG_WHO_AM_I, &id, 1) && id == EXPECTED_ID) {
      *out_addr = addr;
      active_sda = sda;
      active_scl = scl;
      return true;
    }
  }
  return false;
}

bool brute_force_probe(uint8_t* out_addr) {
  const uint8_t gpios[] = {15, 16, 17, 18, 21, 33};
  Serial.println("MPU6050: scanning all SH1.0 GPIO pairs...");
  for (size_t i = 0; i < sizeof(gpios); ++i) {
    for (size_t j = i + 1; j < sizeof(gpios); ++j) {
      if (probe(gpios[i], gpios[j], 100000, out_addr)) {
        return true;
      }
      if (probe(gpios[j], gpios[i], 100000, out_addr)) {
        return true;
      }
    }
  }
  return false;
}

}  // namespace mpu

bool mpu6050_begin() {
  const int sda_pins[] = {PIN_MPU_SDA, PIN_MPU_SCL};
  const int scl_pins[] = {PIN_MPU_SCL, PIN_MPU_SDA};
  const uint32_t speeds[] = {100000, 400000};

  uint8_t addr = 0;
  int found_sda = PIN_MPU_SDA;
  int found_scl = PIN_MPU_SCL;
  uint32_t found_hz = 400000;

  for (uint32_t hz : speeds) {
    for (int i = 0; i < 2; ++i) {
      if (mpu::probe(sda_pins[i], scl_pins[i], hz, &addr)) {
        found_sda = sda_pins[i];
        found_scl = scl_pins[i];
        found_hz = hz;
        goto configured;
      }
    }
  }

  if (mpu::brute_force_probe(&addr)) {
    found_sda = mpu::active_sda;
    found_scl = mpu::active_scl;
    found_hz = 100000;
    goto configured;
  }

  mpu::bus.begin(PIN_MPU_SDA, PIN_MPU_SCL);
  mpu::bus.setClock(100000);
  delay(20);
  Serial.println("MPU6050: not found — I2C scan on GPIO17/18:");
  mpu6050_scan();
  Serial.println("  No device on any SH1.0 GPIO pair. Check:");
  Serial.println("  1) GY-521 VCC on JST BAT+ (3.7 V cell)");
  Serial.println("  2) GY-521 GND: JST GND (same as USB shell)");
  Serial.println("  3) AD0 on GY-521 tied to GND");
  Serial.println("  Press 'p' for pin finder to identify wires vs GND");
  return false;

configured:
  mpu::active_addr = addr;
  Serial.printf("MPU6050: OK @ 0x%02X, SDA=GPIO%d SCL=GPIO%d, %lukHz\n",
                addr, found_sda, found_scl, found_hz / 1000);

  bus_write(mpu::bus, addr, mpu::REG_PWR_MGMT_1, 0x00);
  bus_write(mpu::bus, addr, 0x1C, 0x08);  // accel +/-4g
  bus_write(mpu::bus, addr, 0x1B, 0x08);  // gyro +/-500 dps
  delay(50);
  return true;
}

bool mpu6050_read(ImuSample* out) {
  uint8_t raw[14];
  if (!bus_read(mpu::bus, mpu::active_addr, mpu::REG_ACCEL, raw, sizeof(raw))) {
    return false;
  }

  constexpr float ACC_LSB_PER_G = 8192.0f;
  constexpr float GYR_LSB_PER_DPS = 65.5f;

  out->ax_g = be16(raw + 0) / ACC_LSB_PER_G;
  out->ay_g = be16(raw + 2) / ACC_LSB_PER_G;
  out->az_g = be16(raw + 4) / ACC_LSB_PER_G;
  out->gx_dps = be16(raw + 8) / GYR_LSB_PER_DPS;
  out->gy_dps = be16(raw + 10) / GYR_LSB_PER_DPS;
  out->gz_dps = be16(raw + 12) / GYR_LSB_PER_DPS;
  return true;
}

void mpu6050_scan() {
  i2c_scan(mpu::bus, "MPU GPIO17/18");
}
