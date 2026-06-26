#!/usr/bin/env python3
"""Serial motor test for ESP32 playground ins_display — USB @ 115200."""

import argparse
import sys
import time

import serial


def drain(ser: serial.Serial, seconds: float = 0.5) -> None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if ser.in_waiting:
            line = ser.readline().decode("utf-8", "replace").rstrip()
            if line:
                print(line)
            deadline = time.time() + 0.3
        else:
            time.sleep(0.05)


def send(ser: serial.Serial, cmd: str, wait: float = 0.15) -> None:
    print(f">> {cmd}")
    ser.write((cmd + "\n").encode())
    ser.flush()
    time.sleep(wait)
    drain(ser, 2.0)


def send_test_on(ser: serial.Serial) -> None:
    """TEST,ON blocks on the board until any serial key; we send one after Enter."""
    print(">> TEST,ON  (hold until you press Enter)")
    ser.write(b"TEST,ON\n")
    ser.flush()
    drain(ser, 1.0)
    try:
        input("Motors ON — press Enter to stop… ")
    except KeyboardInterrupt:
        print()
    ser.write(b"\n")
    ser.flush()
    drain(ser, 1.0)


def main() -> int:
    p = argparse.ArgumentParser(description="DRV8833 motor test on ESP32")
    p.add_argument("-p", "--port", default="COM16")
    p.add_argument(
        "command",
        nargs="?",
        help="PING | ARM | STOP | TEST,ON | A,30 | B,30 | M,40 | RAMP,M,20,50,50",
    )
    p.add_argument("--script", action="store_true", help="run phased bench script")
    args = p.parse_args()

    ser = serial.Serial(args.port, 115200, timeout=0.5)
    time.sleep(1.5)
    ser.reset_input_buffer()
    send(ser, "STOP", wait=0.3)

    if args.script:
        steps = [
            "PING",
            "STATUS",
            ("test_on",),
            "ARM",
            "A,70",
            ("sleep", 2.0),
            "STOP",
            "ARM",
            "B,70",
            ("sleep", 2.0),
            "STOP",
            "ARM",
            "RAMP,M,30,70,80",
            ("sleep", 0.5),
            "STOP",
        ]
        for step in steps:
            if isinstance(step, tuple) and step[0] == "sleep":
                time.sleep(step[1])
            elif isinstance(step, tuple) and step[0] == "test_on":
                send_test_on(ser)
            else:
                wait = 4.0 if step.startswith("RAMP,") else 0.4
                send(ser, step, wait=wait)
        send(ser, "STOP", wait=0.3)
        ser.close()
        return 0

    if args.command and args.command.upper() in (
        "TEST,ON", "TEST,FULL", "TEST,A", "TEST,B", "DIAG,ON"
    ):
        send_test_on(ser)
        ser.close()
        return 0

    if args.command:
        send(ser, args.command)
    else:
        print("Interactive — type commands (STOP to disarm). Empty line quits.")
        try:
            while True:
                cmd = input("motor> ").strip()
                if not cmd:
                    break
                send(ser, cmd, wait=0.1)
        except KeyboardInterrupt:
            send(ser, "STOP")
    ser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
