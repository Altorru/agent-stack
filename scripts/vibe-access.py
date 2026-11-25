#!/usr/bin/env python3
"""Read Vibe's effective model and live account plan without exposing credentials.

This intentionally uses Vibe's installed Python environment and fails closed if
its private configuration/authentication interfaces change. No completion runs.
"""
import asyncio
import contextlib
import io
import json
import re
import sys
from urllib.parse import urlparse


def safe_text(value):
    value = getattr(value, "value", value)
    return value if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_. /-]{1,128}", value) else None


async def inspect_access(model_alias, effort):
    from vibe.core.config.harness_files import init_harness_files_manager
    from vibe.core.config.default_orchestrator import build_default_orchestrator
    from vibe.core.config.vibe_schema import load_dotenv_values
    from vibe.core.platform_auth._mistral import mistral_credentials, resolve_snapshot
    from vibe.setup.auth.whoami import HttpAccountGateway

    init_harness_files_manager("user", "project")
    load_dotenv_values()
    config = (await build_default_orchestrator(data={"active_model": model_alias})).config
    model = config.get_active_model()
    provider = config.get_provider_for_model(model)
    console = urlparse(config.console_base_url)
    endpoint = urlparse(provider.api_base)
    # Validate endpoints before asking the native credential provider for secrets.
    if (model.alias != model_alias or model.provider != "mistral"
        or provider.name != "mistral" or provider.api_key_env_var != "MISTRAL_API_KEY"
        or endpoint.scheme != "https" or endpoint.netloc != "api.mistral.ai"
        or endpoint.path.rstrip("/") != "/v1" or endpoint.query or endpoint.fragment
        or console.scheme != "https" or console.netloc != "console.mistral.ai"
        or console.path.rstrip("/") or console.query or console.fragment
        or provider.extra_headers):
        return {"ok": False}
    matched = await asyncio.to_thread(mistral_credentials, config)
    if matched is None or matched.provider.name != provider.name:
        return {"ok": False}
    snapshot = await resolve_snapshot(matched.credentials, config.console_base_url)
    auth_mode = safe_text(getattr(snapshot, "kind", None))
    if auth_mode not in {"api_key", "oidc", "user_token", "bearer"}:
        return {"ok": False}
    account = await HttpAccountGateway().read(
        base_url=config.console_base_url, credentials=matched.credentials, timeout=8
    )
    plan_type = safe_text(account.plan_type)
    return {
        "ok": plan_type in {"chat", "mistral_code"},
        "plan_type": plan_type,
        "plan_name": safe_text(account.plan_name),
        "paid_vibe": bool(account.has_paid_vibe_entitlement),
        "auth_mode": auth_mode,
        "model": safe_text(model.alias),
        "effort": safe_text(effort),
    }


def main():
    result = {"ok": False}
    # Native libraries may log authentication failures. Emit only our allowlist.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        try:
            if len(sys.argv) in {2, 3}:
                result = asyncio.run(asyncio.wait_for(
                    inspect_access(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None),
                    timeout=18,
                ))
        except BaseException:
            result = {"ok": False}
    print(json.dumps(result, separators=(",", ":")))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
