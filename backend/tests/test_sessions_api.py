import json
import tempfile
import unittest
from pathlib import Path


class TestCreateSessionRequest(unittest.TestCase):
    def test_force_parallel_defaults_false(self):
        from app.models import CreateSessionRequest

        req = CreateSessionRequest(task="hello")
        self.assertFalse(req.force_parallel)

    def test_force_parallel_accepts_true(self):
        from app.models import CreateSessionRequest

        req = CreateSessionRequest(task="hello", force_parallel=True)
        self.assertTrue(req.force_parallel)


class TestSessionEnrichment(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db_path = Path(self.tmp.name) / "app.db"
        import app.db as dbmod

        self._prev = dbmod.DB_PATH
        dbmod.DB_PATH = db_path
        await dbmod.init_db()

    async def asyncTearDown(self):
        import app.db as dbmod

        dbmod.DB_PATH = self._prev
        self.tmp.cleanup()

    async def test_enrich_orchestrator_adds_plan_and_child_stats(self):
        from app import db
        from app.routes.sessions import _enrich_session

        plan = {"phases": [{"id": "p1", "branches": []}]}
        parent = await db.create_session("parent", force_parallel=True)
        await db.update_session(
            parent["id"],
            role="orchestrator",
            plan_json=json.dumps(plan),
        )
        await db.create_session(
            "child",
            parent_id=parent["id"],
            role="child",
            branch_id="p1.b1",
        )
        parent = await db.get_session(parent["id"])
        enriched = await _enrich_session(parent)

        self.assertEqual(enriched["plan"], plan)
        self.assertIn("plan_json", enriched)
        self.assertEqual(enriched["child_stats"]["total"], 1)

    async def test_get_children_route_returns_child_sessions(self):
        from app import db
        from app.routes.sessions import get_children

        parent = await db.create_session("parent")
        child = await db.create_session(
            "child",
            parent_id=parent["id"],
            role="child",
            branch_id="p1.b1",
        )
        result = await get_children(parent["id"])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["id"], child["id"])


if __name__ == "__main__":
    unittest.main()
