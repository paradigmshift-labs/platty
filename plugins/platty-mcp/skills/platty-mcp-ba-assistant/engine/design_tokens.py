"""Resolve design token values from nested DTCG-style knowledge packs."""


def _token_root(pack):
    return pack.get("tokens", {}) if isinstance(pack, dict) else {}


def _entry_at(tokens, token):
    cursor = tokens if isinstance(tokens, dict) else {}
    for part in token.split("."):
        if not isinstance(cursor, dict):
            return None
        cursor = cursor.get(part)
    if cursor is None:
        return None
    return cursor if isinstance(cursor, dict) else {"value": cursor}


def _declared_tokens(tokens):
    declared = set()
    stack = [("", tokens)]
    while stack:
        prefix, value = stack.pop()
        if not isinstance(value, dict):
            if prefix:
                declared.add(prefix)
            continue
        if "$value" in value or "value" in value:
            if prefix:
                declared.add(prefix)
            continue
        for key, child in value.items():
            if not str(key).startswith("$"):
                stack.append((key if not prefix else prefix + "." + key, child))
    return declared


def _normalize(value):
    if isinstance(value, dict) and value.get("colorSpace") == "srgb":
        components = value.get("components", [])
        if len(components) >= 3:
            return "#" + "".join(f"{round(max(0, min(1, float(component))) * 255):02x}" for component in components[:3])
    if isinstance(value, dict) and "value" in value and "unit" in value:
        return f"{value['value']}{value['unit']}"
    return str(value)


def _resolve(tokens, declared, token, resolving, resolved, errors):
    if token in resolved:
        return resolved[token]
    if token in resolving:
        errors.append("cyclic token reference " + token)
        return None
    entry = _entry_at(tokens, token)
    if not isinstance(entry, dict) or token not in declared:
        errors.append("missing token reference " + token)
        return None
    resolving.add(token)
    value = entry.get("$value", entry.get("value", ""))
    if isinstance(value, str) and value.startswith("{") and value.endswith("}"):
        value = _resolve(tokens, declared, value[1:-1], resolving, resolved, errors)
        if value is None:
            resolving.remove(token)
            return None
    normalized = _normalize(value)
    resolving.remove(token)
    resolved[token] = normalized
    return normalized


def resolve_token_map(pack):
    tokens = _token_root(pack)
    declared = _declared_tokens(tokens)
    resolved = {}
    errors = []
    for token in sorted(declared):
        before = len(errors)
        value = _resolve(tokens, declared, token, set(), resolved, errors)
        if value is None or len(errors) > before:
            resolved.pop(token, None)
    return resolved, errors


def resolved_token_value(pack, token):
    resolved, errors = resolve_token_map(pack)
    return resolved.get(token, ""), errors
