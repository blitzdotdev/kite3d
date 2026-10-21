"""Refresh the bounded, public DataSF snapshots. Building is a separate offline step."""
import argparse
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
DATASETS = {
    "buildings": ("ynuv-fyni", "shape", "sf16_bldgid", [
        "sf16_bldgid", "shape", "gnd_mediancm", "gnd_mincm", "gnd_maxcm",
        "hgt_median_m", "hgt_maxcm", "data_as_of",
    ]),
    "roads": ("3psu-pn9h", "line", "cnn", [
        "cnn", "streetname", "st_type", "classcode", "oneway", "line",
        "f_node_cnn", "t_node_cnn", "data_as_of",
    ]),
    "trees": ("tkzw-k3nq", None, "treeid", [
        "treeid", "species", "latitude", "longitude", "mapdbh", "data_as_of",
    ]),
    "sidewalks": ("4g86-grxu", "shape", "objectid", [
        "objectid", "cnn", "width_min", "sidewalk_f", "side", "shape", "data_as_of",
    ]),
}


def requests(area):
    w, s, e, n = area["bounds"]
    polygon = f"POLYGON(({w} {s},{e} {s},{e} {n},{w} {n},{w} {s}))"
    out = {}
    for name, (dataset, geometry, order, fields) in DATASETS.items():
        where = (f"intersects({geometry}, '{polygon}')" if geometry else
                 f"latitude between {s} and {n} AND longitude between {w} and {e}")
        if name == "roads":
            where = "active = true AND " + where
        params = {"$select": ",".join(fields), "$where": where, "$order": order,
                  "$limit": 5000}
        out[name] = "https://data.sf.gov/resource/" + dataset + ".json?" + urllib.parse.urlencode(params)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--import-snapshots", type=Path,
                        help="Import already fetched responses; useful for an initial capture")
    args = parser.parse_args()
    area = json.loads((ROOT / "area.json").read_text())
    directory = ROOT / "sources"
    directory.mkdir(exist_ok=True)
    urls = requests(area)

    def capture(name):
        if args.import_snapshots:
            rows = json.loads((args.import_snapshots / (name + ".json")).read_text())
        else:
            req = urllib.request.Request(urls[name], headers={"User-Agent": "Kite3D-SF-slice/1.0"})
            with urllib.request.urlopen(req, timeout=90) as response:
                rows = json.load(response)
        if not isinstance(rows, list) or not rows or len(rows) >= 5000:
            raise ValueError(f"{name}: empty, invalid or truncated response; keep the previous snapshot")
        fields = DATASETS[name][3]
        filtered = [{key: row[key] for key in fields if key in row} for row in rows]
        payload = (json.dumps(filtered, sort_keys=True, separators=(",", ":")) + "\n").encode()
        return name, payload, len(rows)

    # Validate all responses before replacing any files. Rebuild is always offline.
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        captures = list(pool.map(capture, DATASETS))
    manifest = {"capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "area": area, "publisher": "City and County of San Francisco / DataSF",
                "license": "https://opendatacommons.org/licenses/pddl/1-0/", "layers": {}}
    for name, payload, count in captures:
        (directory / (name + ".json")).write_bytes(payload)
        manifest["layers"][name] = {"dataset": DATASETS[name][0], "url": urls[name],
                                      "rows": count, "sha256": hashlib.sha256(payload).hexdigest()}
        print(f"{name}: {count} records")
    (directory / "provenance.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
