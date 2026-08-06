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

    async def test_child_stats_buckets_hitl_and_paused_separately(self):
        from app import db

        parent = await db.create_session("parent task")

        async def _child(branch: str, **fields):
            child = await db.create_session(
                f"child {branch}", parent_id=parent["id"], role="child", branch_id=branch
            )
            await db.update_session(child["id"], **fields)
            return child

        await _child("b1", status="waiting_for_input")
        await _child(
            "b2",
            status="running",
            hitl_pending=db.hitl_pending_to_json(
                {"request_id": "r1", "prompt": "OTP?", "input_type": "otp"}
            ),
        )
        await _child("b3", status="running")
        await _child("b4", status="paused")
        await _child("b5", status="stopped")

        stats = await db.child_stats(parent["id"])
        self.assertEqual(stats["total"], 5)
        self.assertEqual(stats["waiting_for_input"], 2)
        self.assertEqual(stats["running"], 1)
        self.assertEqual(stats["paused"], 1)
        self.assertEqual(stats["stopped"], 1, "paused must not be folded into stopped")

    async def test_child_stats_bulk_matches_per_parent_stats(self):
        from app import db

        p1 = await db.create_session("p1")
        p2 = await db.create_session("p2")
        await db.create_session("c1", parent_id=p1["id"], role="child", branch_id="b1")
        c2 = await db.create_session("c2", parent_id=p1["id"], role="child", branch_id="b2")
        await db.update_session(c2["id"], status="completed")

        bulk = await db.child_stats_bulk([p1["id"], p2["id"]])
        self.assertEqual(bulk[p1["id"]], await db.child_stats(p1["id"]))
        self.assertEqual(bulk[p2["id"]]["total"], 0)
        self.assertEqual(bulk[p1["id"]]["completed"], 1)


if __name__ == "__main__":
    unittest.main()

