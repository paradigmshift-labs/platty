"""Separate installed plugin assets from per-workspace BA data."""

import os
from pathlib import Path

PLUGIN_ROOT = Path(os.environ.get('CLAUDE_PLUGIN_ROOT') or Path(__file__).resolve().parents[1])
WORKSPACE_ROOT = Path(os.environ.get('BA_WORKSPACE') or Path.cwd()).resolve()
