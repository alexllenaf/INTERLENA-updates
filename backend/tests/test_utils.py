import sys
from datetime import date, datetime
from pathlib import Path
import unittest

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app import utils  # noqa: E402


class UtilsSmokeTests(unittest.TestCase):
    def test_parse_date(self) -> None:
        self.assertEqual(utils.parse_date("2024-01-02"), date(2024, 1, 2))
        self.assertEqual(utils.parse_date(date(2024, 2, 3)), date(2024, 2, 3))
        self.assertEqual(utils.parse_date(datetime(2024, 2, 3, 10, 0)), date(2024, 2, 3))
        self.assertIsNone(utils.parse_date("not-a-date"))

    def test_parse_datetime(self) -> None:
        self.assertEqual(utils.parse_datetime("2024-01-02T03:04:05"), datetime(2024, 1, 2, 3, 4, 5))
        self.assertEqual(utils.parse_datetime(date(2024, 2, 3)), datetime(2024, 2, 3, 0, 0))
        self.assertIsNone(utils.parse_datetime("not-a-date"))

    def test_json_helpers(self) -> None:
        self.assertEqual(utils.parse_json_list(None), [])
        self.assertEqual(utils.parse_json_list("not-json"), [])
        self.assertEqual(utils.parse_json_list("[]"), [])
        self.assertEqual(utils.parse_json_list('[{"a": 1}]'), [{"a": 1}])
        self.assertEqual(utils.list_to_json(None), "[]")
        self.assertEqual(utils.list_to_json([]), "[]")

    def test_build_ics(self) -> None:
        events = [
            {
                "uid": "1",
                "summary": "Interview - Test",
                "description": "Line1\nLine2",
                "start": datetime(2024, 1, 2, 10, 0),
                "end": datetime(2024, 1, 2, 11, 0),
                "all_day": False,
            },
            {
                "uid": "2",
                "summary": "Follow-Up - Test",
                "start": datetime(2024, 1, 3, 0, 0),
                "all_day": True,
            },
        ]
        data = utils.build_ics(events)
        text = data.decode("utf-8")
        self.assertIn("BEGIN:VCALENDAR", text)
        self.assertIn("BEGIN:VEVENT", text)
        self.assertIn("SUMMARY:Interview - Test", text)
        self.assertIn("DTSTART;VALUE=DATE:20240103", text)


if __name__ == "__main__":
    unittest.main()
