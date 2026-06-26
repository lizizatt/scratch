#!/usr/bin/env python3
"""WiFi UDP motor/telemetry client for ESP32 playground (ins_display)."""

import argparse
import select
import socket
import sys
import time

DEFAULT_HOST = "192.168.4.1"
CMD_PORT = 4242
TLM_PORT = 4243


def drain(sock: socket.socket, seconds: float = 0.5) -> None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        ready, _, _ = select.select([sock], [], [], 0.05)
        if not ready:
            continue
        try:
            data, _ = sock.recvfrom(4096)
        except BlockingIOError:
            continue
        line = data.decode("utf-8", "replace").rstrip()
        if line:
            print(line)
        deadline = time.time() + 0.3


def send_cmd(sock: socket.socket, host: str, cmd: str, wait: float = 0.15) -> None:
    print(f">> {cmd}")
    sock.sendto((cmd + "\n").encode(), (host, CMD_PORT))
    time.sleep(wait)
    drain(sock, 2.0)


def send_test_hold(sock: socket.socket, host: str, cmd: str) -> None:
    print(f">> {cmd}  (hold until Enter)")
    sock.sendto((cmd + "\n").encode(), (host, CMD_PORT))
    drain(sock, 1.0)
    try:
        input("Motors ON — press Enter to stop… ")
    except KeyboardInterrupt:
        print()
    sock.sendto(b"\n", (host, CMD_PORT))
    drain(sock, 1.0)


def main() -> int:
    p = argparse.ArgumentParser(description="WiFi motor test for ESP32 playground")
    p.add_argument("--host", default=DEFAULT_HOST, help="board SoftAP IP (default 192.168.4.1)")
    p.add_argument(
        "command",
        nargs="?",
        help="PING | ARM | STOP | TEST,A | M,40 | RAMP,M,20,50,50",
    )
    p.add_argument("--listen", action="store_true", help="only print telemetry")
    p.add_argument("--keepalive", type=float, default=0.0,
                   help="if >0, send PING every N seconds while idle (link watchdog)")
    args = p.parse_args()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("", TLM_PORT))
    sock.setblocking(False)

    host = args.host
    print(f"Target {host}:{CMD_PORT}  (join WiFi AP ESP32-Playground first)")

    if args.listen:
        print("Listening for telemetry on UDP", TLM_PORT)
        try:
            while True:
                drain(sock, 1.0)
        except KeyboardInterrupt:
            return 0

    send_cmd(sock, host, "STOP", wait=0.3)

    hold_cmds = {"TEST,ON", "TEST,FULL", "TEST,A", "TEST,B", "DIAG,ON"}
    if args.command and args.command.upper() in hold_cmds:
        send_test_hold(sock, host, args.command)
        sock.close()
        return 0

    if args.command:
        send_cmd(sock, host, args.command)
        sock.close()
        return 0

    print("Interactive — type commands (STOP to disarm). Empty line quits.")
    last_ping = time.time()
    try:
        while True:
            if args.keepalive > 0 and time.time() - last_ping >= args.keepalive:
                sock.sendto(b"PING\n", (host, CMD_PORT))
                last_ping = time.time()
            drain(sock, 0.2)
            try:
                cmd = input("wifi> ").strip()
            except EOFError:
                break
            if not cmd:
                break
            send_cmd(sock, host, cmd, wait=0.1)
            last_ping = time.time()
    except KeyboardInterrupt:
        send_cmd(sock, host, "STOP", wait=0.1)
    sock.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
