#pragma once

#include <Arduino.h>
#include <IPAddress.h>

using PgLineHandler = void (*)(const String& line);
using PgLinkLostFn = void (*)();

// SoftAP + UDP command/telemetry bridge (see docs/WIFI.md).
void pg_link_begin(bool wifi_enable = true);
void pg_link_poll(PgLineHandler on_line);
void pg_link_reply(const char* msg);
void pg_link_send_telemetry(const char* msg);

bool pg_link_input_pending();
void pg_link_consume_input();

void pg_link_tick(uint32_t now_ms);
void pg_link_set_link_lost_handler(PgLinkLostFn fn);
void pg_link_set_watchdog_enabled(bool enabled);

bool pg_link_wifi_active();
IPAddress pg_link_ip();
const char* pg_link_ssid();
