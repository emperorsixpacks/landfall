"""Chat agent tool tests: grounded answers, no invention."""
from __future__ import annotations

import unittest
from unittest import mock

from app import chat


def _result() -> dict:
    return {
        "artist": "Tems",
        "fit_score": 72.2,
        "markets": [
            {"country": "United States", "score": 78.7, "reason": "Fans are strongly concentrated here.", "points": 2449, "affinity": 0.6, "popularity": 0.55, "status": "scored"},
            {"country": "France", "score": 50.0, "reason": "x", "points": 100, "status": "scored"},
            {"country": "Nigeria", "score": 41.7, "reason": "Fans are moderately concentrated here.", "points": 155, "affinity": 0.5, "popularity": 0.49, "status": "scored"},
        ],
        "trace": [],
    }


class TestMentionedMarket(unittest.TestCase):
    def test_mentions_existing_market(self):
        self.assertEqual(chat._mentioned_market("Why is Nigeria ranked #29?", _result()), "Nigeria")

    def test_no_mention(self):
        self.assertIsNone(chat._mentioned_market("What drove the fit score?", _result()))


class TestExplainMarket(unittest.TestCase):
    def test_grounded_rank_score_and_wikipedia(self):
        with mock.patch.object(chat.wiki, "fetch_country_info", return_value={"description": "Country in West Africa", "population": "242 million"}):
            text, _ = chat._explain_market({"country": "Nigeria"}, {"result": _result(), "state": {}, "run_id": "x"})
        self.assertIn("Nigeria", text)
        self.assertIn("41.7", text)
        self.assertIn("United States", text)  # top-market comparison
        self.assertIn("242 million", text)  # wikipedia population woven in

    def test_unknown_market_is_refused(self):
        text, _ = chat._explain_market({"country": "Atlantis"}, {"result": _result(), "state": {}, "run_id": "x"})
        self.assertIn("No market named", text)


class TestValidateChatArgs(unittest.TestCase):
    def test_explain_market_requires_country(self):
        self.assertTrue(chat.validate_chat_args("explain_market", {}))
        self.assertEqual(chat.validate_chat_args("explain_market", {"country": "Nigeria"}), [])


if __name__ == "__main__":
    unittest.main()
