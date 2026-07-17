"""Backward-compatible entrypoint for Cebu flow.

Delegates to python/flows/cebu (mimic_flow runtime).

Examples:
  python3 test/cebu_flow.py --search
  python3 test/cebu_flow.py --search --proxy lumi --country gb -j 5
  python3 test/cebu_flow.py --search --proxy none
  python3 test/cebu_flow.py --search --proxy mitm
  python3 test/cebu_flow.py --search --proxy reqable
"""

from __future__ import annotations

import sys
from pathlib import Path

_PYTHON_ROOT = Path(__file__).resolve().parents[1] / "python"
if str(_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(_PYTHON_ROOT))

from flows.cebu.__main__ import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
