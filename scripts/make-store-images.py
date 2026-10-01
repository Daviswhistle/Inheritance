#!/usr/bin/env python3
"""Compatibility launcher for the native HTML/CSS store composition renderer.
Run scripts/verify/store-shots.mjs first to capture the actual local example UI.
"""
import pathlib
import subprocess
import sys

renderer = pathlib.Path(__file__).with_suffix('.mjs')
raise SystemExit(subprocess.call(['node', str(renderer), *sys.argv[1:]]))
