import unittest
from app.llm_models_catalog import (
    empty_catalog,
    ensure_model_in_catalog,
    normalize_catalog,
    parse_catalog_json,
)


class TestLlmModelsCatalog(unittest.TestCase):
    def test_empty_catalog_has_three_providers(self):
        c = empty_catalog()
        self.assertEqual(set(c), {"local", "openai", "anthropic"})
        self.assertEqual(c["local"], [])

    def test_normalize_dedupes_and_trims(self):
        c = normalize_catalog({"local": [" a ", "a", "", "b"], "openai": "nope"})
        self.assertEqual(c["local"], ["a", "b"])
        self.assertEqual(c["openai"], [])
        self.assertEqual(c["anthropic"], [])

    def test_ensure_model_appends_once(self):
        c = empty_catalog()
        c = ensure_model_in_catalog(c, "local", "gemma")
        c = ensure_model_in_catalog(c, "local", "gemma")
        self.assertEqual(c["local"], ["gemma"])

    def test_parse_catalog_json(self):
        self.assertEqual(parse_catalog_json(None), empty_catalog())
        self.assertEqual(
            parse_catalog_json('{"local":["x"],"openai":[],"anthropic":[]}'),
            {"local": ["x"], "openai": [], "anthropic": []},
        )


if __name__ == "__main__":
    unittest.main()
