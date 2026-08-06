import tempfile
import unittest
from pathlib import Path


class TestSessionChildren(unittest.IsolatedAsyncioTestCase):
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

    async def test_create_child_and_stats(self):
        from app import db

        parent = await db.create_session("parent task")
        child = await db.create_session(
            "child task",
            parent_id=parent["id"],
            role="child",
            branch_id="p1.b1",
            attempt=1,
        )
        kids = await db.list_child_sessions(parent["id"])
        self.assertEqual(len(kids), 1)
        self.assertEqual(kids[0]["id"], child["id"])

        listed = await db.list_sessions(include_children=False)
        self.assertTrue(all(s.get("role") != "child" for s in listed))

        stats = await db.child_stats(parent["id"])
        self.assertEqual(stats["total"], 1)
        self.assertEqual(stats["queued"], 1)


if __name__ == "__main__":
    unittest.main()

