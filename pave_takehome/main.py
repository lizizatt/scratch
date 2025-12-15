#              .
#              |
#         .   ]#[   .
#          \_______/
#       .    ]LIZ[    .
#        \___________/
#     .     ]CLAUDE[     .
#      \_______________/
#   .      ]#######[      .
#    \___________________/
# .       ]#########[       .
#  \_____]##.-----.##[_____/
#   |__|__|_|     |_|__|__|
#   |__|__|_|_____|_|__|__|
#   ########/_____\########
#          |_______|
#         /_________\

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

from trajectory import (
    detect_cracks,
    plan_trajectory_from_mask,
    visualize_rgbd_and_trajectory,
    compute_runtime,
)


RGB_PATTERN = re.compile(
    r"^(?P<scene_id>[0-9A-Z]+)_rgb_(?P<timestamp>[0-9\-]+)\.jpg$"
)
DEPTH_PATTERN = re.compile(
    r"^(?P<scene_id>[0-9A-Z]+)_depth_vis_(?P<timestamp>[0-9\-]+)\.png$"
)


@dataclass
class ImagePair:
    scene_id: str
    timestamp: str
    rgb_path: Path
    depth_path: Path


def discover_image_pairs(data_root: Path) -> List[ImagePair]:
    """Discover matching RGB / DEPTH image pairs based on the filename scheme.

    Naming scheme (from the provided dataset):
      - RGB:   <scene_id>_rgb_<timestamp>.jpg
      - DEPTH: <scene_id>_depth_vis_<timestamp>.png

    Example:
      - 14442C10D185D9D600_rgb_2025-09-30-15-51-47.jpg
      - 14442C10D185D9D600_depth_vis_2025-09-30-15-51-47.png
    """
    rgb_dir = data_root / "RGB"
    depth_dir = data_root / "DEPTH"

    rgb_index: Dict[Tuple[str, str], Path] = {}
    for p in rgb_dir.glob("*.jpg"):
        m = RGB_PATTERN.match(p.name)
        if not m:
            continue
        key = (m.group("scene_id"), m.group("timestamp"))
        rgb_index[key] = p

    depth_index: Dict[Tuple[str, str], Path] = {}
    for p in depth_dir.glob("*.png"):
        m = DEPTH_PATTERN.match(p.name)
        if not m:
            continue
        key = (m.group("scene_id"), m.group("timestamp"))
        depth_index[key] = p

    pairs: List[ImagePair] = []
    for key, rgb_path in rgb_index.items():
        if key not in depth_index:
            continue
        scene_id, timestamp = key
        pairs.append(
            ImagePair(
                scene_id=scene_id,
                timestamp=timestamp,
                rgb_path=rgb_path,
                depth_path=depth_index[key],
            )
        )

    return sorted(pairs, key=lambda p: (p.scene_id, p.timestamp))


def load_pair_images(pair: ImagePair) -> Tuple["object", "object"]:
    """Load RGB and depth images as numpy arrays."""
    import cv2
    import numpy as np

    rgb = cv2.imread(str(pair.rgb_path), cv2.IMREAD_COLOR)
    depth_vis = cv2.imread(str(pair.depth_path), cv2.IMREAD_GRAYSCALE)
    if rgb is None:
        raise RuntimeError(f"Failed to read RGB image: {pair.rgb_path}")
    if depth_vis is None:
        raise RuntimeError(f"Failed to read depth image: {pair.depth_path}")
    return rgb, depth_vis


def save_trajectory(
    out_dir: Path,
    pair: ImagePair,
    trajectory: List[Tuple[float, float, float]],
    trajectory_length: float,
    runtime_seconds: float,
    printhead_speed: float,
) -> None:
    """Save a simple JSON representation of the planned XYZ gantry trajectory."""
    out_dir.mkdir(parents=True, exist_ok=True)
    # Descriptive prefix, no duplicate suffix.
    out_path = out_dir / f"metadata_{pair.scene_id}_{pair.timestamp}.json"

    # Ensure trajectory is JSON-serializable (plain Python floats, not numpy types).
    trajectory_clean = [(float(x), float(y), float(z)) for (x, y, z) in trajectory]
    payload = {
        "scene_id": pair.scene_id,
        "timestamp": pair.timestamp,
        "rgb": str(pair.rgb_path),
        "depth": str(pair.depth_path),
        # XYZ gantry positions in robot gantry frame 
        "trajectory_xyz": trajectory_clean,
        "trajectory_length_units": float(trajectory_length),
        "printhead_speed_units_per_sec": float(printhead_speed),
        "estimated_runtime_seconds": float(runtime_seconds),
    }
    out_path.write_text(json.dumps(payload, indent=2))


def process_pair(
    pair: ImagePair,
    output_dir: Path,
    save_json: bool,
    do_viz: bool,
    viz_dir: Path | None,
    show_viz: bool,
    verbose: bool = False,
) -> None:
    """Run detection, planning, and optional viz for a single image pair."""
    if verbose:
        print(
            f"scene_id={pair.scene_id} ts={pair.timestamp} "
            f"rgb={pair.rgb_path.name} depth={pair.depth_path.name}"
        )

    rgb, depth_vis = load_pair_images(pair)

    mask = detect_cracks(rgb, depth_vis)
    trajectory = plan_trajectory_from_mask(mask, rgb, depth_vis)
    trajectory_length, runtime_seconds = compute_runtime(trajectory)

    # Per-pair output directory that will contain JSON + all viz for this pair.
    pair_dir = output_dir / f"{pair.scene_id}_{pair.timestamp}"
    pair_dir.mkdir(parents=True, exist_ok=True)

    if save_json:
        save_trajectory(
            pair_dir,
            pair,
            trajectory,
            trajectory_length=trajectory_length,
            runtime_seconds=runtime_seconds,
            printhead_speed=compute_runtime.__defaults__[0]
            if compute_runtime.__defaults__
            else 50.0,
        )

    if do_viz:
        if show_viz:
            viz_path: Path | None = None
        else:
            # Save viz images into the same per-pair folder as the JSON.
            viz_path = pair_dir / f"trajectory_and_mask_{pair.scene_id}_{pair.timestamp}.png"

        visualize_rgbd_and_trajectory(
            rgb,
            depth_vis,
            trajectory_xyz=trajectory,
            mask=mask,
            runtime_seconds=runtime_seconds,
            printhead_speed=compute_runtime.__defaults__[0]
            if compute_runtime.__defaults__
            else 50.0,
            out_path=viz_path,
            show=show_viz,
        )


def run_pipeline(
    data_root: Path,
    output_dir: Path,
    limit: int | None = None,
    verbose: bool = True,
    do_viz: bool = False,
    viz_dir: Path | None = None,
) -> None:
    pairs = discover_image_pairs(data_root)
    if verbose:
        print(f"Discovered {len(pairs)} RGB/DEPTH pairs under {data_root}")

    if limit is not None:
        pairs = pairs[:limit]

    for i, pair in enumerate(pairs, start=1):
        if verbose:
            print(f"[{i}/{len(pairs)}] ", end="")
        process_pair(
            pair=pair,
            output_dir=output_dir,
            save_json=True,
            do_viz=do_viz,
            viz_dir=viz_dir,
            show_viz=False,
            verbose=verbose,
        )


def interactive_view_pair(data_root: Path, index: int) -> None:
    """Open an interactive 3D viewer for a single image pair (1-based index)."""
    pairs = discover_image_pairs(data_root)
    if not pairs:
        print(f"No RGB/DEPTH pairs found under {data_root}")
        return

    if index < 1 or index > len(pairs):
        raise IndexError(
            f"interactive index {index} is out of range; "
            f"dataset has {len(pairs)} pairs (valid range: 1..{len(pairs)})"
        )

    pair = pairs[index - 1]
    print(
        f"Interactive view for index {index}/{len(pairs)}: "
        f"scene_id={pair.scene_id} ts={pair.timestamp} "
        f"rgb={pair.rgb_path.name} depth={pair.depth_path.name}"
    )

    # No JSON or PNG output here; just pop up an interactive viewer.
    process_pair(
        pair=pair,
        output_dir=Path("."),  # unused when save_json=False
        save_json=False,
        do_viz=True,
        viz_dir=None,
        show_viz=True,
        verbose=False,
    )


def install_requirements(requirements_path: Path) -> None:
    """Install Python dependencies from a requirements.txt file.

    This uses the current Python interpreter: `python -m pip install -r ...`.
    """
    if not requirements_path.is_file():
        raise FileNotFoundError(f"requirements.txt not found at {requirements_path}")

    print(f"Installing requirements from {requirements_path} ...")
    cmd = [sys.executable, "-m", "pip", "install", "-r", str(requirements_path)]
    try:
        subprocess.check_call(cmd)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"pip install failed with exit code {exc.returncode}") from exc


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Pave Robotics take-home starter script.\n\n"
            "Loads paired RGB / DEPTH images, runs a crack-detection + "
            "trajectory-planning pipeline, and writes per-image trajectories "
            "to disk. Use this as a starting point and fill in the core "
            "perception and planning pieces."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--data-root",
        type=Path,
        default=Path("data"),
        help="Root of the data directory containing RGB/ and DEPTH/ (default: ./data)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("trajectories"),
        help="Directory to write per-image trajectory JSON files (default: ./trajectories)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional maximum number of image pairs to process.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress per-image logging.",
    )
    parser.add_argument(
        "--viz",
        action="store_true",
        help="Generate a matplotlib visualization of the RGBD point cloud and XYZ trajectory.",
    )
    parser.add_argument(
        "--viz-dir",
        type=Path,
        default=None,
        help="Directory to write visualization PNGs (default: <output-dir>/viz).",
    )
    parser.add_argument(
        "--interactive-index",
        type=int,
        default=None,
        help=(
            "Open an interactive 3D viewer for the Nth RGB/DEPTH pair (1-based index) "
            "and exit. Does not write any PNGs."
        ),
    )
    parser.add_argument(
        "--install-reqs",
        action="store_true",
        help="Install Python dependencies from requirements.txt and exit.",
    )
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()

    if args.install_reqs:
        # Assume requirements.txt lives next to this script
        requirements_path = Path(__file__).with_name("requirements.txt")
        install_requirements(requirements_path)
        return

    if args.interactive_index is not None:
        interactive_view_pair(args.data_root, args.interactive_index)
        return

    run_pipeline(
        data_root=args.data_root,
        output_dir=args.output_dir,
        limit=args.limit,
        verbose=not args.quiet,
        do_viz=args.viz,
        viz_dir=args.viz_dir,
    )


if __name__ == "__main__":
    main()


