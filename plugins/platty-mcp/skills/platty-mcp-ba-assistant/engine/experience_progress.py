"""Render only the current decision's neighborhood as a horizontal Mermaid diagram."""


def label(text):
    return ''.join(f'#{ord(ch)};' if ch in '"<>`&\\#|' else ' ' if ch in '\r\n' else ch
                   for ch in str(text))


def render_progress(data, packet_id='', previous=None, situation='', question=''):
    """An option comparison, not a claim that these candidate paths are implemented."""
    packet = next((p for p in data['decision_packets'] if p['id'] == packet_id), None)
    if packet is None:
        return ''
    lines = ['```mermaid', 'flowchart LR']
    if situation:
        lines += [f'  start["{label(situation)}"]', '  start --> q']
    lines.append(f'  q{{"이번 결정: {label(question or packet["topic"])}"}}')
    for i, option in enumerate(packet['options']):
        edge = option['id'] + (' · 추천' if option['id'] == packet['recommendation']['option_id'] else '')
        lines += [f'  o{i}["{label(option["label"])}"]', f'  q -->|"{label(edge)}"| o{i}']
    lines += ['  style q stroke:#2563eb,stroke-width:3px', '```']
    return '\n'.join(lines) + '\n'


def render_full_model(data):
    return render_diagram(data, data['experience_transitions'], set(), full=True)


def render_diagram(data, selected, marked, full=False):
    states = {s['id']: s['name'] for s in data['experience_states']}
    ids = list(states) if full else list(dict.fromkeys(t[k] for t in selected for k in ('from_state', 'to_state')))
    if any(sid not in states for sid in ids):
        return ''

    nodes = {sid: f'n{i}' for i, sid in enumerate(ids)}
    lines = ['```mermaid', 'flowchart LR']
    for sid in ids:
        suffix = ' · 이번 결정' if sid in marked else ''
        lines.append(f'  {nodes[sid]}["{label(states[sid] + suffix)}"]')
    for t in selected:
        condition = label(t.get('user_visible_condition') or t['trigger'])
        lines.append(f'  {nodes[t["from_state"]]} -->|"{condition}"| {nodes[t["to_state"]]}')
    for sid in ids:
        if sid in marked:
            lines.append(f'  style {nodes[sid]} stroke:#2563eb,stroke-width:3px')
    lines.append('```')
    return '\n'.join(lines) + '\n'
