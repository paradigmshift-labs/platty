#!/usr/bin/env python3
"""Compatibility entrypoint for historical interview2 artifacts."""
from legacy import interview2 as _engine

globals().update({key: value for key, value in vars(_engine).items() if not key.startswith('__')})

if __name__ == '__main__':
    raise SystemExit(_engine.main())
