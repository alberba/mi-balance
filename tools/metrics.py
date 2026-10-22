"""Estimate body composition using the pinned xiaomi_mi_scale algorithm."""
import argparse
import datetime as dt
import json
import math
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).parent / "vendor"))
from Xiaomi_Scale_Body_Metrics import bodyMetrics

ALGORITHM = "lolouk44/xiaomi_mi_scale@e9db989d21b23602a462338a285478658cbaa137"


def age_on(birthdate, date):
    if birthdate > date:
        raise ValueError("Birthdate cannot be after measurement date")
    return date.year - birthdate.year - ((date.month, date.day) < (birthdate.month, birthdate.day))


def calculate(weight, height, age, sex, impedance):
    if not all(math.isfinite(v) for v in (weight, height, age, impedance)):
        raise ValueError("Inputs must be finite")
    if not (10 <= weight <= 200 and 0 < height <= 220 and 18 <= age <= 99 and 0 < impedance < 3000):
        raise ValueError("Requires adult age 18–99, height >0–220 cm, weight 10–200 kg and impedance >0–<3000 ohm")
    if sex not in ("male", "female"):
        raise ValueError("Sex must be male or female for this algorithm")
    m = bodyMetrics(weight, height, age, sex, impedance)
    fat = m.getFatPercentage()
    return {
        "bmi": weight / (height / 100) ** 2,
        "body_fat_percent": fat,
        "fat_mass_kg": weight * fat / 100,
        "fat_free_mass_kg": weight * (1 - fat / 100),
        "muscle_mass_kg": m.getMuscleMass(),
        "water_percent": m.getWaterPercentage(),
        "water_mass_kg": weight * m.getWaterPercentage() / 100,
        "bone_mass_kg": m.getBoneMass(),
        "protein_percent": m.getProteinPercentage(),
        "visceral_fat_index": m.getVisceralFat(),
        "basal_metabolic_rate_kcal_day": m.getBMR(),
        "metabolic_age_index_years": m.getMetabolicAge(),
        "body_type_code": m.getBodyType(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("measurement", type=Path)
    parser.add_argument("--height", type=float, required=True, help="cm")
    parser.add_argument("--birthdate", type=dt.date.fromisoformat, required=True, help="YYYY-MM-DD")
    parser.add_argument("--sex", choices=("male", "female"), required=True)
    args = parser.parse_args()
    try:
        measurement = json.loads(args.measurement.read_text())
        if not measurement.get("stabilized") or measurement.get("load_removed") or not measurement.get("impedance_ohm"):
            raise ValueError("Requires a stabilized, loaded measurement with valid impedance")
        captured = dt.datetime.fromisoformat(measurement["captured_at"].replace("Z", "+00:00"))
        if captured.tzinfo is None:
            raise ValueError("captured_at must include a timezone")
        date = captured.astimezone(ZoneInfo("Europe/Madrid")).date()
        age = age_on(args.birthdate, date)
        result = {"algorithm": ALGORITHM, "estimated": True,
                  "measurement_date": date.isoformat(), "measurement_source": str(args.measurement),
                  "inputs": {"weight_kg": measurement["weight_kg"], "impedance_ohm": measurement["impedance_ohm"],
                             "height_cm": args.height, "age_years": age, "sex": args.sex},
                  "metrics": calculate(measurement["weight_kg"], args.height, age, args.sex, measurement["impedance_ohm"])}
        print(json.dumps(result, indent=2, allow_nan=False))
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
