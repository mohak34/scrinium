# /// script
# dependencies = ["fonttools", "brotli"]
# ///
# Rebuilds src/lib/design/material-symbols.woff2: the Material Symbols
# Outlined font cut down to the icon names that appear anywhere in src/
# (any lowercase word matching an icon, so dynamic names in code count).
# Run `uv run scripts/subset-icons.py` after using a new icon.
import pathlib
import re

from fontTools import subset
from fontTools.ttLib import TTFont

root = pathlib.Path(__file__).resolve().parent.parent
full = root / 'node_modules/@material-symbols/font-400/material-symbols-outlined.woff2'
out = root / 'src/lib/design/material-symbols.woff2'

names = set(TTFont(full).getGlyphOrder())
words: set[str] = set()
for p in (root / 'src').rglob('*'):
    if p.suffix in ('.svelte', '.ts'):
        words |= set(re.findall(r'[a-z][a-z0-9_]+', p.read_text()))
icons = sorted(w for w in words if w in names)
glyphs = icons + [f'{i}.fill' for i in icons if f'{i}.fill' in names]

opts = subset.Options()
opts.flavor = 'woff2'
opts.layout_features = ['*']
opts.layout_closure = False
font = TTFont(full)
s = subset.Subsetter(opts)
s.populate(glyphs=glyphs, text='abcdefghijklmnopqrstuvwxyz0123456789_')
s.subset(font)
font.flavor = 'woff2'
font.save(out)
print(f'{len(icons)} icons, {out.stat().st_size // 1024} KB -> {out.relative_to(root)}')
