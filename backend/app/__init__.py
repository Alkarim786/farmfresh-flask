import logging
import os

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from .common import APIError
from .config import Config
from .extensions import db, jwt, limiter, migrate

STATIC_DIR = os.getenv("FRONTEND_DIST", os.path.join(os.path.dirname(__file__), "..", "static"))


def create_app(config_object=Config) -> Flask:
    app = Flask(__name__, static_folder=None)
    app.config.from_object(config_object)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    limiter.init_app(app)
    CORS(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}})

    from . import auth, dashboard, listings, orders, payments, prices, transport
    for mod in (auth, listings, orders, transport, payments, prices, dashboard):
        app.register_blueprint(mod.bp)

    from .cli import register_cli
    register_cli(app)

    @app.errorhandler(APIError)
    def _api_error(e: APIError):
        return e.to_response()

    @app.errorhandler(HTTPException)
    def _http_error(e: HTTPException):
        return jsonify({"error": {"code": e.name.lower().replace(" ", "_"), "message": e.description}}), e.code

    @app.errorhandler(Exception)
    def _unexpected(e: Exception):
        db.session.rollback()
        app.logger.exception("Unhandled error")
        return jsonify({"error": {"code": "server_error", "message": "Something went wrong on our side"}}), 500

    @jwt.expired_token_loader
    def _expired(_h, _p):
        return jsonify({"error": {"code": "token_expired", "message": "Session expired"}}), 401

    @jwt.invalid_token_loader
    @jwt.unauthorized_loader
    def _unauth(reason):
        return jsonify({"error": {"code": "unauthorized", "message": "Please log in"}}), 401

    @app.after_request
    def _headers(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        return resp

    @app.get("/api/health")
    def health():
        db.session.execute(db.text("select 1"))
        return {"status": "ok", "payment_mode": app.config["PAYMENT_MODE"]}

    # Serve the built React app (single-service deploy). Unknown paths fall back to index.html.
    @app.get("/", defaults={"path": ""})
    @app.get("/<path:path>")
    def spa(path):
        if path.startswith("api/"):
            return jsonify({"error": {"code": "not_found", "message": "Unknown API route"}}), 404
        full = os.path.join(STATIC_DIR, path)
        if path and os.path.isfile(full):
            resp = send_from_directory(STATIC_DIR, path)
            if path.startswith("assets/"):
                resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return resp
        if os.path.isfile(os.path.join(STATIC_DIR, "index.html")):
            return send_from_directory(STATIC_DIR, "index.html")
        return jsonify({"message": "FarmFresh API is running. Build the frontend to serve the UI here."})

    return app
