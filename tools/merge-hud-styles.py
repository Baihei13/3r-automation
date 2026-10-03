"""Merge maintained HUD styles into the stable stylesheet. Does not run the HUD."""
from pathlib import Path

hud_root = Path(__file__).resolve().parents[1] / 'three-r-combat-hud'
stylesheet = hud_root / 'styles/hud.css'
marker = '/* trh-appearance-generated:begin */'
base = stylesheet.read_text(encoding='utf-8-sig').split(marker)[0].rstrip()
parts = ['layout.css', 'themes.css']
generated = '\n\n'.join((hud_root / 'styles' / part).read_text(encoding='utf-8-sig').rstrip() for part in parts)
stylesheet.write_text(base + '\n\n' + marker + '\n' + generated + '\n/* trh-appearance-generated:end */\n', encoding='utf-8')
print('HUD stylesheet saved; no runtime or test executed.')
