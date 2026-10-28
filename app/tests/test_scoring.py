"""Mutation test: changing mocked tag overlap must change the fit score."""
from __future__ import annotations

import unittest

from app import scoring


def _fit(comparable, catalog, audience, hooks=None):
    return scoring.score_fit(
        {
            "comparable_tags": comparable,
            "catalog_tags": catalog,
            "audience_tags": audience,
            "hooks": hooks or [{"score": 0.8}],
        }
    )["fit"]


class TestFitMutation(unittest.TestCase):
    def test_fit_changes_when_tag_overlap_mutates(self):
        catalog = ["afrobeats", "reggae"]
        audience = ["afrobeats", "reggae", "soul"]
        base = _fit(["afrobeats"], catalog, audience)
        mutated = _fit(["afrobeats", "reggae"], catalog, audience)
        self.assertIsNotNone(base)
        self.assertIsNotNone(mutated)
        self.assertGreater(mutated, base, "adding an overlapping tag should raise the fit")

    def test_missing_part_is_renormalized_and_flagged(self):
        out = scoring.score_fit(
            {
                "comparable_tags": ["afrobeats"],
                "catalog_tags": ["afrobeats", "x"],
                "audience_tags": [],
                "hooks": [],
            }
        )
        self.assertIsNotNone(out["fit"])
        self.assertIn("audience_match unavailable", out["warnings"])
        self.assertIsNone(out["clip_strength"])

    def test_clip_strength_is_reported_separately(self):
        out = scoring.score_fit(
            {
                "comparable_tags": ["afrobeats"],
                "catalog_tags": ["afrobeats"],
                "audience_tags": ["afrobeats"],
                "hooks": [{"score": 0.77}],
            }
        )
        self.assertEqual(out["clip_strength"], 77.0)
        self.assertNotIn("clip_strength", out["breakdown"])


if __name__ == "__main__":
    unittest.main()
