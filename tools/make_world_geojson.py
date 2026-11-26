"""TopoJSON (world-atlas 110m) -> GeoJSON для глобуса на карте филиалов.

Скрипт одноразовый, но лежит в репозитории: если понадобится обновить
границы или сменить точность, результат воспроизводим одной командой.
Запуск: python tools/make_world_geojson.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORLD = ROOT / "frontend" / "public" / "world"
DECIMALS = 3  # ~110 м на экваторе: на глобусе неотличимо от исходника


def decode_arcs(topo):
    tr = topo.get("transform")
    sx, sy = (tr["scale"] if tr else (1, 1))
    tx, ty = (tr["translate"] if tr else (0, 0))
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        points = []
        for dx, dy in arc:
            x += dx
            y += dy
            points.append([round(x * sx + tx, DECIMALS), round(y * sy + ty, DECIMALS)])
        arcs.append(points)
    return arcs


def ring_from(arc_indexes, arcs):
    ring = []
    for idx in arc_indexes:
        if idx >= 0:
            seg = arcs[idx]
        else:
            seg = list(reversed(arcs[-idx - 1]))
        if ring:
            seg = seg[1:]  # общий конец соседних дуг не дублируем
        ring.extend(seg)
    if ring and ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def geometry_to_geojson(geom, arcs):
    gtype = geom["type"]
    if gtype == "Polygon":
        return {"type": "Polygon", "coordinates": [ring_from(r, arcs) for r in geom["arcs"]]}
    if gtype == "MultiPolygon":
        return {
            "type": "MultiPolygon",
            "coordinates": [[ring_from(r, arcs) for r in poly] for poly in geom["arcs"]],
        }
    raise ValueError(f"неожиданный тип геометрии: {gtype}")


def convert(src: Path, dst: Path, object_name: str):
    topo = json.loads(src.read_text(encoding="utf-8"))
    arcs = decode_arcs(topo)
    obj = topo["objects"][object_name]
    geoms = obj["geometries"] if obj["type"] == "GeometryCollection" else [obj]
    features = [
        {"type": "Feature", "properties": {}, "geometry": geometry_to_geojson(g, arcs)}
        for g in geoms
    ]
    payload = {"type": "FeatureCollection", "features": features}
    dst.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"{dst.name}: {len(features)} features, {dst.stat().st_size // 1024} KB")


if __name__ == "__main__":
    convert(WORLD / "_land.topo.json", WORLD / "land-110m.geojson", "land")
    convert(WORLD / "_countries.topo.json", WORLD / "countries-110m.geojson", "countries")
