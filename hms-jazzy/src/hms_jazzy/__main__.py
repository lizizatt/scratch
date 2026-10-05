import argparse
from pathlib import Path

import uvicorn

from .config import load_config


def main() -> None:
    parser = argparse.ArgumentParser(description="HMS Jazzy paddleboard simulator")
    parser.add_argument("--config", type=Path, help="board parameters in TOML format")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--native", action="store_true", help="use the native MuJoCo viewer")
    args = parser.parse_args()
    config = load_config(args.config)
    if args.native:
        from .native import run

        run(config)
    else:
        from .server import create_app

        uvicorn.run(create_app(config), host="127.0.0.1", port=args.port, ws_max_size=8192)


if __name__ == "__main__":
    main()
