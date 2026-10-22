import datetime as dt
import math
import unittest
from metrics import age_on, calculate


class MetricsTests(unittest.TestCase):
    def test_age_uses_measurement_date(self):
        birthday = dt.date(2003, 9, 23)
        self.assertEqual(age_on(birthday, dt.date(2026, 9, 22)), 22)
        self.assertEqual(age_on(birthday, dt.date(2026, 9, 23)), 23)
        self.assertEqual(age_on(birthday, dt.date(2026, 10, 22)), 23)
        with self.assertRaises(ValueError):
            age_on(birthday, dt.date(2000, 1, 1))

    def test_captured_measurement_reference(self):
        m = calculate(77.85, 184, 23, "male", 487)
        self.assertAlmostEqual(m["body_fat_percent"], 19.78604393063582)
        self.assertAlmostEqual(m["muscle_mass_kg"], 59.264475927616004)
        self.assertAlmostEqual(m["water_percent"], 55.02677386358382)
        self.assertAlmostEqual(m["bmi"], 77.85 / 1.84 ** 2)
        self.assertAlmostEqual(m["fat_mass_kg"] + m["fat_free_mass_kg"], 77.85)
        self.assertAlmostEqual(m["muscle_mass_kg"] + m["bone_mass_kg"], m["fat_free_mass_kg"])

    def test_reject_invalid_inputs_before_vendor(self):
        for weight, height, age, sex, impedance in [
            (77.85, 0, 23, "male", 487), (77.85, 184, 23, "male", 0),
            (77.85, 184, 23, "unknown", 487), (math.nan, 184, 23, "male", 487),
            (77.85, 184, 17, "male", 487), (77.85, 184, 23, "male", 65534),
        ]:
            with self.assertRaises(ValueError):
                calculate(weight, height, age, sex, impedance)


if __name__ == "__main__":
    unittest.main()
