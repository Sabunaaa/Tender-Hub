from tender_scraper.access import access_cookie_value, is_valid_access_cookie, verify_access_password


def test_correct_password_matches_default():
    assert verify_access_password("ploki890-")
    assert is_valid_access_cookie(access_cookie_value())


def test_wrong_password_is_rejected():
    assert not verify_access_password("wrong")
    assert not is_valid_access_cookie("not-a-cookie")
    assert not is_valid_access_cookie(None)
