"""Decode 13-byte Mi Body Composition advertisements; no Bluetooth dependency."""
import argparse
import datetime as dt
import json
import sys


def decode(payload):
    data = bytes.fromhex(payload)
    if len(data) != 13:
        raise ValueError(f"Expected 13 service-data bytes, got {len(data)}")
    raw_weight = int.from_bytes(data[11:13], "little")
    raw_impedance = int.from_bytes(data[9:11], "little")
    flags = data[1]
    # Only unit encodings corroborated by ESPHome's v2 parser are converted.
    unit = {2: "kg", 3: "lb"}.get(data[0])
    weight = raw_weight / (200 if unit == "kg" else 100) if unit else None
    try:
        timestamp = dt.datetime(int.from_bytes(data[2:4], "little"), *data[4:9]).isoformat()
    except ValueError:
        timestamp = None
    impedance_present = bool(flags & 0x02)
    impedance_valid = impedance_present and 0 < raw_impedance < 3000
    return {
        "raw_hex": data.hex(), "control": data[0], "flags": flags,
        "weight_raw": raw_weight, "weight": weight, "unit": unit,
        "weight_kg": weight if unit == "kg" else weight * 0.45359237 if unit == "lb" else None,
        "stabilized": bool(flags & 0x20), "load_removed": bool(flags & 0x80),
        "impedance_present": impedance_present, "impedance_raw": raw_impedance,
        "impedance_ohm": raw_impedance if impedance_valid else None,
        "scale_timestamp": timestamp, "timestamp_bytes": data[2:9].hex(),
        "timestamp_trusted": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", nargs="?", help="Scanner JSONL file; stdin when omitted")
    parser.add_argument("--hex", help="Decode one service-data payload")
    args = parser.parse_args()
    if args.hex:
        try:
            print(json.dumps(decode(args.hex)))
        except ValueError as error:
            parser.error(str(error))
        return
    source = open(args.file) if args.file else sys.stdin
    try:
        for number, line in enumerate(source, 1):
            try:
                event = json.loads(line)
                for uuid, payload in event.get("service_data", {}).items():
                    if uuid.upper() in ("181B", "0000181B-0000-1000-8000-00805F9B34FB"):
                        print(json.dumps({"captured_at": event.get("captured_at"),
                                          "device_id": event.get("device_id"), **decode(payload)}))
                if event.get("uuid", "").upper() == "2A9C" and "hex" in event:
                    print(json.dumps({"captured_at": event.get("captured_at"),
                                      "source": "gatt_2a9c", **decode(event["hex"])}))
            except (ValueError, TypeError, AttributeError) as error:
                print(f"Line {number}: {error}", file=sys.stderr)
                sys.exit(1)
    finally:
        if args.file:
            source.close()


if __name__ == "__main__":
    main()
