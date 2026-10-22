import unittest
from decode import decode


def frame(control=2, flags=0x22, impedance=560, weight=15000):
    return (bytes([control, flags]) + bytes.fromhex("ea070a16140000")
            + impedance.to_bytes(2, "little") + weight.to_bytes(2, "little")).hex()


class DecodeTests(unittest.TestCase):
    def test_captured_mibfs_measurement(self):
        result = decode("0226ea070a16133539e701d23c")
        self.assertEqual(result["weight_kg"], 77.85)
        self.assertEqual(result["impedance_ohm"], 487)
        self.assertTrue(result["stabilized"])
        self.assertFalse(result["load_removed"])

    def test_stable_weight_and_impedance(self):
        result = decode(frame())
        self.assertEqual(result["weight_kg"], 75)
        self.assertEqual(result["impedance_ohm"], 560)
        self.assertTrue(result["stabilized"])
        self.assertFalse(result["load_removed"])
        self.assertEqual(result["scale_timestamp"], "2026-10-22T20:00:00")

    def test_unavailable_impedance_and_step_off(self):
        for raw in (0, 3000, 65533, 65534, 65535):
            self.assertIsNone(decode(frame(impedance=raw))["impedance_ohm"])
        self.assertIsNone(decode(frame(flags=0x20))["impedance_ohm"])
        self.assertTrue(decode(frame(flags=0xa2))["load_removed"])

    def test_pounds_and_unknown_units(self):
        self.assertAlmostEqual(decode(frame(control=3, weight=15000))["weight_kg"], 68.0388555)
        self.assertIsNone(decode(frame(control=0xff))["weight_kg"])

    def test_invalid_dates_and_sizes(self):
        result = decode("0222000000000000003002983a")
        self.assertIsNone(result["scale_timestamp"])
        self.assertEqual(result["weight_kg"], 75)
        with self.assertRaises(ValueError):
            decode("181b")
        with self.assertRaises(ValueError):
            decode("not hex")


if __name__ == "__main__":
    unittest.main()
