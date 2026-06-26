#include "pg_link.h"

#include <WiFi.h>
#include <WiFiUdp.h>

namespace {

constexpr char kApSsid[] = "ESP32-Playground";
constexpr char kApPass[] = "heli9053";
constexpr uint16_t kCmdPort = 4242;
constexpr uint16_t kTlmPort = 4243;
constexpr uint32_t kLinkTimeoutMs = 500;
constexpr size_t kMaxLine = 56;

bool g_wifi_on = false;
bool g_watchdog_on = true;
WiFiUDP g_cmd_udp;
WiFiUDP g_tlm_udp;
IPAddress g_last_client;
bool g_have_client = false;
uint32_t g_last_rx_ms = 0;
PgLinkLostFn g_link_lost = nullptr;

String g_serial_line;
String g_udp_line;

void note_rx(uint32_t now_ms) {
  g_last_rx_ms = now_ms;
}

void dispatch_line(const String& line, PgLineHandler on_line) {
  if (line.length() == 0 || !on_line) {
    return;
  }
  note_rx(millis());
  on_line(line);
}

void handle_complete_line(String& buf, PgLineHandler on_line) {
  if (buf.length() == 0) {
    return;
  }
  dispatch_line(buf, on_line);
  buf = "";
}

void poll_serial(PgLineHandler on_line) {
  while (Serial.available()) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\n' || c == '\r') {
      handle_complete_line(g_serial_line, on_line);
    } else {
      g_serial_line += c;
      if (g_serial_line.length() > kMaxLine) {
        g_serial_line = "";
        pg_link_reply("ERR,LINE_TOO_LONG");
      }
    }
  }
}

void poll_udp(PgLineHandler on_line) {
  int packet_size = g_cmd_udp.parsePacket();
  if (packet_size <= 0) {
    return;
  }

  g_last_client = g_cmd_udp.remoteIP();
  g_have_client = true;

  char buf[64];
  while (packet_size > 0) {
    const int n = g_cmd_udp.read(buf, sizeof(buf) - 1);
    if (n <= 0) {
      break;
    }
    buf[n] = '\0';
    packet_size -= n;

    for (int i = 0; i < n; ++i) {
      const char c = buf[i];
      if (c == '\n' || c == '\r') {
        handle_complete_line(g_udp_line, on_line);
      } else {
        g_udp_line += c;
        if (g_udp_line.length() > kMaxLine) {
          g_udp_line = "";
          pg_link_reply("ERR,LINE_TOO_LONG");
        }
      }
    }
  }

  if (g_udp_line.length() > 0) {
    handle_complete_line(g_udp_line, on_line);
  }
}

void send_udp_line(const char* msg) {
  if (!g_wifi_on || !g_have_client) {
    return;
  }
  g_tlm_udp.beginPacket(g_last_client, kTlmPort);
  g_tlm_udp.write(reinterpret_cast<const uint8_t*>(msg), strlen(msg));
  g_tlm_udp.write('\n');
  g_tlm_udp.endPacket();
}

}  // namespace

void pg_link_begin(bool wifi_enable) {
  g_wifi_on = wifi_enable;
  g_serial_line = "";
  g_udp_line = "";
  g_have_client = false;
  g_last_rx_ms = millis();

  if (!g_wifi_on) {
    Serial.println("LINK: serial only");
    return;
  }

  WiFi.mode(WIFI_AP);
  WiFi.softAP(kApSsid, kApPass);
  WiFi.setTxPower(WIFI_POWER_8_5dBm);

  g_cmd_udp.begin(kCmdPort);
  g_tlm_udp.begin(kTlmPort);

  Serial.printf("LINK: WiFi AP %s  IP %s  cmd UDP %u  tlm UDP %u\n",
                kApSsid, WiFi.softAPIP().toString().c_str(), kCmdPort, kTlmPort);
  Serial.println("LINK: join AP from laptop, then tools/motor_app_wifi.py");
}

void pg_link_poll(PgLineHandler on_line) {
  poll_serial(on_line);
  if (g_wifi_on) {
    poll_udp(on_line);
  }
}

void pg_link_reply(const char* msg) {
  Serial.println(msg);
  send_udp_line(msg);
}

void pg_link_send_telemetry(const char* msg) {
  Serial.println(msg);
  send_udp_line(msg);
}

bool pg_link_input_pending() {
  if (Serial.available()) {
    return true;
  }
  if (!g_wifi_on) {
    return false;
  }
  return g_cmd_udp.parsePacket() > 0;
}

void pg_link_consume_input() {
  while (Serial.available()) {
    Serial.read();
  }
  if (!g_wifi_on) {
    return;
  }
  char drop[64];
  while (g_cmd_udp.available()) {
    g_cmd_udp.read(drop, sizeof(drop));
  }
  g_udp_line = "";
}

void pg_link_tick(uint32_t now_ms) {
  if (!g_wifi_on || !g_watchdog_on || !g_link_lost) {
    return;
  }
  if (!g_have_client) {
    return;
  }
  if (now_ms - g_last_rx_ms > kLinkTimeoutMs) {
    g_link_lost();
    g_have_client = false;
    g_last_rx_ms = now_ms;
  }
}

void pg_link_set_link_lost_handler(PgLinkLostFn fn) {
  g_link_lost = fn;
}

void pg_link_set_watchdog_enabled(bool enabled) {
  g_watchdog_on = enabled;
}

bool pg_link_wifi_active() {
  return g_wifi_on;
}

IPAddress pg_link_ip() {
  return g_wifi_on ? WiFi.softAPIP() : IPAddress();
}

const char* pg_link_ssid() {
  return kApSsid;
}
