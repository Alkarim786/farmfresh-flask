def test_register_login_and_me(client, api):
    api.register("FARMER", "Ravi Farmer", farm_name="Ravi Farm")
    r = client.post("/api/v1/auth/login", json={"email": "ravi.farmer@test.in", "password": "password123"})
    assert r.status_code == 200
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {r.json['access_token']}"})
    assert me.json["role"] == "FARMER" and me.json["farm_name"] == "Ravi Farm"
    # refresh token issues a new access token
    rr = client.post("/api/v1/auth/refresh", headers={"Authorization": f"Bearer {r.json['refresh_token']}"})
    assert rr.status_code == 200 and rr.json["access_token"]


def test_login_errors_do_not_reveal_accounts(client, api):
    api.register("BUYER", "Asha Buyer")
    wrong_pw = client.post("/api/v1/auth/login", json={"email": "asha.buyer@test.in", "password": "nope12345"})
    no_user = client.post("/api/v1/auth/login", json={"email": "ghost@test.in", "password": "nope12345"})
    assert wrong_pw.status_code == no_user.status_code == 401
    assert wrong_pw.json["error"]["message"] == no_user.json["error"]["message"]


def test_register_validation(client, api):
    api.register("BUYER", "Dup User")
    dup = client.post("/api/v1/auth/register", json={"name": "Dup User", "email": "dup.user@test.in",
                                                     "password": "password123", "role": "BUYER"})
    assert dup.status_code == 409
    admin = client.post("/api/v1/auth/register", json={"name": "Sneaky", "email": "s@test.in",
                                                       "password": "password123", "role": "ADMIN"})
    assert admin.status_code == 400  # admin can't be self-registered
    short = client.post("/api/v1/auth/register", json={"name": "Shorty", "email": "x@test.in",
                                                       "password": "123", "role": "BUYER"})
    assert short.status_code == 400 and "password" in short.json["error"]["fields"]


def test_role_based_access(client, api):
    buyer = api.register("BUYER")
    r = client.post("/api/v1/listings", headers=api.h(buyer), json={"crop": "Okra", "qty_total": 5, "price": 30,
                                                                    "location": "X"})
    assert r.status_code == 403
    assert client.post("/api/v1/listings", json={}).status_code == 401
    assert client.get("/api/v1/admin/users", headers=api.h(buyer)).status_code == 403


def test_only_owner_can_edit_listing(client, api):
    f1, f2 = api.register("FARMER", "Farmer One"), api.register("FARMER", "Farmer Two")
    listing = api.listing(f1)
    r = client.patch(f"/api/v1/listings/{listing['id']}", json={"price": 1}, headers=api.h(f2))
    assert r.status_code == 403
    r = client.patch(f"/api/v1/listings/{listing['id']}", json={"price": 25.5}, headers=api.h(f1))
    assert r.status_code == 200 and r.json["price"] == "25.50"


def test_listing_validation_and_search(client, api):
    f = api.register("FARMER")
    bad = client.post("/api/v1/listings", headers=api.h(f), json={"crop": "Tomato", "qty_total": -5, "price": 10,
                                                                  "location": "X"})
    assert bad.status_code == 400
    api.listing(f, crop="tomato", price=18, location="Villupuram")
    api.listing(f, crop="Onion", price=30, location="Hosur", organic=True)
    assert client.get("/api/v1/listings?q=tomato").json["total"] == 1
    assert client.get("/api/v1/listings?max_price=20").json["items"][0]["crop"] == "Tomato"
    assert client.get("/api/v1/listings?organic=1").json["items"][0]["crop"] == "Onion"
    assert client.get("/api/v1/listings?sort=price_desc").json["items"][0]["price"] == "30.00"


def test_listing_photo_upload_and_serve(client, api):
    import base64
    f = api.register("FARMER")
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
    l = api.listing(f, images=["data:image/png;base64," + base64.b64encode(png).decode()])
    r = client.get(l["images"][0])
    assert r.status_code == 200 and r.mimetype == "image/png" and r.data == png
    bad = client.post("/api/v1/listings", headers=api.h(f), json={"crop": "A", "qty_total": 1, "price": 1,
                                                                  "location": "X", "images": ["data:text/html;base64,PGI+"]})
    assert bad.status_code == 400
