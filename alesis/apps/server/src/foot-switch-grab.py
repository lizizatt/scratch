#!/usr/bin/env python3
"""Reads one evdev keyboard-style foot switch and prints "down" or "up" on each change.

The device is grabbed exclusively so its keystrokes never reach the kiosk browser.
Usage: foot-switch-grab.py /dev/input/by-id/<device>-event-kbd
"""
import fcntl
import os
import struct
import sys

EVIOCGRAB = 0x40044590
EV_KEY = 1
FORMAT = "llHHi"
SIZE = struct.calcsize(FORMAT)

fd = os.open(sys.argv[1], os.O_RDONLY)
fcntl.ioctl(fd, EVIOCGRAB, 1)
down = False
while True:
    data = os.read(fd, SIZE * 16)
    if not data:
        break
    for offset in range(0, len(data) - SIZE + 1, SIZE):
        _seconds, _micros, kind, _code, value = struct.unpack_from(FORMAT, data, offset)
        # Value 2 is autorepeat while held; only real presses and releases matter.
        if kind == EV_KEY and value in (0, 1) and (value == 1) != down:
            down = value == 1
            print("down" if down else "up", flush=True)
