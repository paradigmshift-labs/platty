"""Structural readiness checks for the user experience graph."""


def graph_gaps(data) -> list[str]:
    """Return structural gaps; schema and semantic checks belong to the caller.

    Multiple initial states are allowed for separate actor journeys. Scenario
    paths may begin mid-journey (for example recovery), but cannot teleport
    between states. Every scenario cited as coverage must exercise its edge.
    """
    gaps = []
    states = {item['id']: item for item in data.get('experience_states', [])}
    transitions = {item['id']: item for item in data.get('experience_transitions', [])}
    outgoing = {state_id: [] for state_id in states}
    for transition in transitions.values():
        outgoing.setdefault(transition.get('from_state'), []).append(transition.get('to_state'))

    initial = [state_id for state_id, state in states.items() if state.get('kind') == 'initial']
    if not initial:
        gaps.append('$.experience_states: at least one initial state required')
    reached = set(initial)
    pending = list(initial)
    while pending:
        for target in outgoing.get(pending.pop(), []):
            if target in states and target not in reached:
                reached.add(target)
                pending.append(target)
    for state_id, state in states.items():
        if state_id not in reached:
            gaps.append(f'$.experience_states[{state_id}]: unreachable from any initial state')
        if state.get('kind') != 'final' and not outgoing[state_id]:
            gaps.append(f'$.experience_states[{state_id}]: nonterminal state needs an outgoing transition')

    scenario_edges = {}
    used = set()
    for scenario in data.get('scenarios', []):
        scenario_id = scenario['id']
        edge_ids = [step.get('transition_id') for step in scenario.get('steps', [])]
        scenario_edges[scenario_id] = set(edge_ids)
        used.update(edge_ids)
        previous = None
        for step_number, edge_id in enumerate(edge_ids):
            edge = transitions.get(edge_id)
            path = f'$.scenarios[{scenario_id}].steps[{step_number}]'
            if edge is None:
                gaps.append(f'{path}: unknown transition {edge_id}')
                previous = None
                continue
            if previous is not None and previous.get('to_state') != edge.get('from_state'):
                gaps.append(f'{path}: disconnected path from {previous["id"]} to {edge_id}')
            previous = edge
    for edge_id in transitions:
        if edge_id not in used:
            gaps.append(f'$.experience_transitions[{edge_id}]: transition has no scenario')

    for obligation in data.get('coverage_obligations', []):
        if obligation.get('status') not in ('covered', 'handoff'):
            continue
        path = f'$.coverage_obligations[{obligation["id"]}]'
        scenario_ids = obligation.get('scenario_ids', [])
        if not scenario_ids:
            gaps.append(f'{path}: obligation needs a scenario exercising its transition')
        for scenario_id in scenario_ids:
            if obligation.get('transition_id') not in scenario_edges.get(scenario_id, set()):
                gaps.append(f'{path}: obligation transition is absent from scenario {scenario_id}')
    return gaps
