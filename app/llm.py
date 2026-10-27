"""Minimal OpenAI-compatible chat client (works with Groq, Google AI Studio, etc.)."""
from __future__ import annotations

import json
from typing import Any, Optional

import httpx

from . import config


def _post(messages: list[dict], temperature: float, json_mode: bool) -> Optional[str]:
    if not config.llm_ready():
        return None
    url = f"{config.LLM_BASE_URL}/chat/completions"
    body: dict[str, Any] = {
        "model": config.LLM_MODEL,
        "messages": messages,
        "temperature": temperature,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    headers = {"Authorization": f"Bearer {config.LLM_API_KEY}", "Content-Type": "application/json"}
    r = httpx.post(url, json=body, headers=headers, timeout=config.TOOL_TIMEOUT_SECONDS)
    r.raise_for_status()
    data = r.json()
    return data["choices"][0]["message"]["content"]


def _extract_json(text: str) -> Optional[dict]:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    return None


def chat_json(
    messages: list[dict],
    temperature: float = 0.0,
    max_retries: int = 2,
    fallback: Optional[dict] = None,
) -> Optional[dict]:
    """Return a parsed JSON object from the model, or `fallback` on repeated failure."""
    if not config.llm_ready():
        return fallback

    last_err = None
    for attempt in range(max_retries + 1):
        try:
            # First attempt uses json_mode; retries fall back to plain text to dodge
            # providers that reject response_format.
            text = _post(messages, temperature, json_mode=(attempt == 0))
            if not text:
                continue
            obj = _extract_json(text)
            if obj is not None:
                return obj
            last_err = "unparsable JSON"
        except Exception as e:  # noqa: BLE001
            last_err = f"{type(e).__name__}: {e}"

    if fallback is not None:
        return fallback
    raise RuntimeError(f"LLM JSON call failed: {last_err}")
