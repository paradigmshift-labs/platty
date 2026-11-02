# Explicit design requests

Add a design draft only when the user explicitly asks how to implement a
change, requests a design, or asks for an implementation approach. A question
about existing behavior or what a change affects stops at evidence/impact.

Complete impact investigation and review first. Then use one design subagent
when available, with the active runtime's available model; otherwise draft
in-session and state that independent design delegation was unavailable.
Supply the question, change target, core/companion data, impact inventory,
root-call inventory, exact read ranges, and unresolved findings.

The design author may read named source ranges through the same authorized
Platty connection. It must not edit code, change data, invent missing impact
evidence, or invoke the application APIs. Additional investigation needs are
returned as gaps. Label each material statement:

- `Fact`: directly supported by a cited source range.
- `Proposal`: an engineering choice with its reason and tradeoff.
- `Assumption`: an unresolved source, runtime, policy, or integration dependency.

Draft: goal/scope; feasible approach and alternatives; changed locations;
affected callers and safeguards; migration when applicable; normal, failure,
and regression scenarios; decisions required before implementation.
Trace changed locations and tests back to the inspected impact rows.

The main agent checks cited facts against its actual read ledger and performs
any necessary bounded verification reads. Put a short plain-English design
summary above the developer appendix. Clearly label the result `Design draft`;
it is not an implemented or tested change.
