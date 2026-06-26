#!/usr/bin/env python3
"""Run all boat_nav_rl tests (Python unittest + optional Node viz tests)."""

import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))


def run_js_tests() -> int:
    node = shutil.which("node")
    if not node:
        print("SKIP js tests (node not on PATH)")
        return 0
    js_dir = ROOT / "tests" / "js"
    if not js_dir.exists():
        return 0
    print("Running Node viz unit tests...")
    result = subprocess.run(
        [node, "--test", str(js_dir / "test_util.test.mjs"), str(js_dir / "test_train_form.test.mjs"), str(js_dir / "test_api_queue.test.mjs"), str(js_dir / "test_scoring.test.mjs")],
        cwd=str(ROOT),
    )
    return result.returncode


def main() -> int:
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    suite.addTests(loader.discover(str(ROOT / "tests"), pattern="test_*.py"))
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if not result.wasSuccessful():
        return 1
    return run_js_tests()


if __name__ == "__main__":
    sys.exit(main())
