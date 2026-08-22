"""Shared password gate, copied from EBG-Tool's cookie HMAC pattern."""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets

ACCESS_COOKIE = "tender_access"
ACCESS_HMAC_KEY = "huawei-tender-hub-access"
ACCESS_COOKIE_MAX_AGE = 7 * 24 * 60 * 60


def access_password() -> str:
    return os.environ.get("TENDER_ACCESS_PASSWORD") or "ploki890-"


def access_cookie_value(password: str | None = None) -> str:
    secret = password if password is not None else access_password()
    return hmac.new(ACCESS_HMAC_KEY.encode("utf-8"), secret.encode("utf-8"), hashlib.sha256).hexdigest()


def is_valid_access_cookie(value: str | None) -> bool:
    if not value:
        return False
    return secrets.compare_digest(value, access_cookie_value())


def verify_access_password(password: str) -> bool:
    return secrets.compare_digest(access_cookie_value(password), access_cookie_value())
