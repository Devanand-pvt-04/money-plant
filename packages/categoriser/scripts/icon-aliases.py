"""
Builds src/icon-aliases.json: other names for Material Design Icons ("gym" for
dumbbell), from the metadata in @mdi/svg, for the icons the app's font has.

  npm pack @mdi/svg && tar xzf mdi-svg-*.tgz package/meta.json
  python3 scripts/icon-aliases.py package/meta.json <glyph map json>

The glyph map is node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json.
Run it again when @expo/vector-icons updates its icon font.
"""
import json
import sys

meta = json.load(open(sys.argv[1]))
names = set(json.load(open(sys.argv[2])))
aliases = {}
for icon in meta:
    if icon["name"] not in names or icon.get("deprecated"):
        continue
    for alias in icon["aliases"]:
        if alias not in names and alias not in aliases:
            aliases[alias] = icon["name"]
json.dump(dict(sorted(aliases.items())), open("src/icon-aliases.json", "w"), separators=(",", ":"))
print(len(aliases), "aliases")
