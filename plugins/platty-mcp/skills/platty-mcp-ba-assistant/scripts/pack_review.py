#!/usr/bin/env python3
"""Run the packaged design-pack review renderer."""

from pathlib import Path
import runpy
import sys

engine = Path(__file__).resolve().parents[1] / 'engine'
sys.path.insert(0, str(engine))
runpy.run_path(str(engine / 'pack_review.py'), run_name='__main__')
