"""Application login secrets for browser agents."""

import unittest

from app import app_login


class TestAppLogin(unittest.TestCase):
    def test_not_configured_when_missing(self):
        self.assertFalse(app_login.is_configured({}))
        self.assertFalse(app_login.is_configured({"application_username": "u"}))
        self.assertFalse(app_login.is_configured({"application_password": "p"}))
        self.assertIsNone(app_login.sensitive_data_for_agent({}))
        self.assertIsNone(app_login.login_system_message({}))

    def test_configured_injects_secrets(self):
        cfg = {"application_username": "demo", "application_password": "s3cret"}
        self.assertTrue(app_login.is_configured(cfg))
        secrets = app_login.sensitive_data_for_agent(cfg)
        self.assertEqual(
            secrets,
            {"x_app_user": "demo", "x_app_pass": "s3cret"},
        )
        msg = app_login.login_system_message(cfg)
        self.assertIsNotNone(msg)
        assert msg is not None
        self.assertIn("x_app_user", msg)
        self.assertIn("x_app_pass", msg)
        self.assertIn("Application login", msg)
        self.assertIn("Keycloak", msg)  # priority note vs SSO

    def test_merge_with_keycloak_keys(self):
        cfg = {
            "application_username": "appu",
            "application_password": "appp",
            "keycloak_enabled": True,
            "keycloak_base_url": "https://kc.example",
            "keycloak_realm": "r",
            "keycloak_client_id": "c",
            "keycloak_username": "kcu",
            "keycloak_password": "kcp",
        }
        from app import keycloak

        merged = {}
        app_s = app_login.sensitive_data_for_agent(cfg)
        kc_s = keycloak.sensitive_data_for_agent(cfg)
        if app_s:
            merged.update(app_s)
        if kc_s:
            merged.update(kc_s)
        self.assertEqual(merged["x_app_user"], "appu")
        self.assertEqual(merged["x_keycloak_user"], "kcu")


class TestAppLoginPublicShape(unittest.TestCase):
    def test_mask_helper_hides_password(self):
        from app.llm_factory import _mask

        self.assertTrue("••" in (_mask("s3cret") or "") or _mask("s3cret") == "••••")


if __name__ == "__main__":
    unittest.main()
