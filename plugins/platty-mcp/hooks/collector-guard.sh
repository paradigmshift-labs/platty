#!/bin/sh
# collector-guard — PreToolUse guard for the platty-mcp-search collector agents.
#
# Claude Code plugin agents cannot restrict MCP tools independently of the MCP
# server name (tools/disallowedTools accept only mcp__<server>__* or mcp__*), and
# they ignore a hooks: frontmatter field. This plugin-level hook closes that gap:
# when the calling agent is platty-evidence-collector-docs,
# platty-evidence-collector-code, platty-search-synthesizer,
# platty-claim-auditor, or platty-impact-investigator, an MCP call is allowed only when (1) its server
# segment is the configured Platty server — PLATTY_MCP_SERVER_NAME, default
# "platty" — either bare (mcp__platty__*) or plugin-namespaced
# (mcp__plugin_<plugin>_platty__*), and (2) its tool name (after an optional
# platty_ prefix) is a read-only tool of the Platty Enterprise MCP catalog.
# Every other MCP call from those agents (memory or glossary-alias writes, any
# other server, a tool not in the catalog) is blocked with exit 2.
# The claim auditor is a text comparator that needs no MCP call at all (its
# frontmatter also disallows mcp__*); it is listed here as a second fence.
# The main thread and other agents are never affected.

# Catalog: the 65-tool Enterprise MCP contract minus the 4 writes
# (memory_request, glossary_alias_add/update/remove).
READ_TOOLS='
business_rule_get business_rule_item_get business_rule_item_list
business_rule_list business_rule_search business_rule_spec_resolve
code_routes code_search code_search_guide_get context_status
data_dictionary_get data_dictionary_item_get data_dictionary_item_list
data_dictionary_list data_dictionary_search data_dictionary_spec_resolve
design_get design_item_get design_item_list design_list design_search
design_spec_resolve domain_get domain_list
epic_get epic_list glossary_alias_list glossary_document_get
glossary_document_list glossary_document_search
glossary_term_get glossary_term_list glossary_term_search glossary_translate
graph_trace memory_get memory_list project_get project_list
readonly_workspace_shell route_code route_impact_candidates route_relations
route_resolve route_text_links sot_render spec_business_resolve
spec_get spec_impact_resolve spec_list spec_search
use_case_get use_case_item_get use_case_item_list use_case_list
use_case_search use_case_spec_resolve workspace_git_history
workspace_repo_list workspace_search workspace_sync_status
'

SERVER_NAME=${PLATTY_MCP_SERVER_NAME:-platty}

GUARDED_AGENT='^(platty-mcp:)?platty-(evidence-collector-(docs|code)|search-synthesizer|claim-auditor|impact-investigator)$'

input=$(cat)

# Parse the TOP-LEVEL agent_type and tool_name. Prefer node, then python3; the
# parser prints "OK<TAB><agent_type><TAB><tool_name>" or "ERR" (malformed
# input or a non-object). PLATTY_COLLECTOR_GUARD_PARSER=node|python|scan forces
# one path (tests); the default is auto.
parse_node() {
  printf '%s' "$input" | node -e '
let s = "";
process.stdin.on("data", (d) => { s += d; }).on("end", () => {
  try {
    const j = JSON.parse(s);
    if (j === null || typeof j !== "object" || Array.isArray(j)) throw new Error("not an object");
    const field = (v) => (typeof v === "string" ? v.replace(/[\t\n\r]/g, " ") : "");
    process.stdout.write("OK\t" + field(j.agent_type) + "\t" + field(j.tool_name));
  } catch { process.stdout.write("ERR"); }
});' 2>/dev/null
}
parse_python() {
  printf '%s' "$input" | python3 -c '
import json, sys
try:
    j = json.load(sys.stdin)
    if not isinstance(j, dict):
        raise ValueError("not an object")
    field = lambda v: v.replace("\t", " ").replace("\n", " ").replace("\r", " ") if isinstance(v, str) else ""
    sys.stdout.write("OK\t" + field(j.get("agent_type")) + "\t" + field(j.get("tool_name")))
except Exception:
    sys.stdout.write("ERR")
' 2>/dev/null
}

parser=${PLATTY_COLLECTOR_GUARD_PARSER:-auto}
parsed=''
case "$parser" in
  node) parsed=$(parse_node) ;;
  python) parsed=$(parse_python) ;;
  scan) ;;
  *)
    if command -v node >/dev/null 2>&1; then
      parsed=$(parse_node)
    fi
    if [ -z "$parsed" ] && command -v python3 >/dev/null 2>&1; then
      parsed=$(parse_python)
    fi
    ;;
esac

tab=$(printf '\t')
names=''
case "$parsed" in
  "OK$tab"*)
    rest=${parsed#OK"$tab"}
    agent=${rest%%"$tab"*}
    tool=${rest#*"$tab"}
    if ! printf '%s\n' "$agent" | grep -Eq "$GUARDED_AGENT"; then
      exit 0
    fi
    names=$tool
    ;;
  *)
    # Fallback (malformed input, or neither node nor python3): conservative
    # scan of the flattened text. Strings inside tool_input keep their quotes
    # escaped, but nested object keys can match, so this path fails closed:
    # any guarded agent_type applies the guard, every "tool_name" value present
    # must be allowed, and no tool name at all is blocked.
    compact=$(printf '%s' "$input" | tr -d '\n\r\t ')
    if ! printf '%s' "$compact" | grep -Eq '(^|[^\\])"agent_type":"(platty-mcp:)?platty-(evidence-collector-(docs|code)|search-synthesizer|claim-auditor|impact-investigator)"'; then
      exit 0
    fi
    names=$(printf '%s' "$compact" | grep -o '"tool_name":"[^"\\]*"' | sed 's/^"tool_name":"//; s/"$//')
    ;;
esac

if [ -z "$names" ]; then
  echo "platty-mcp: collector agent tool call without a readable tool name is blocked." >&2
  exit 2
fi

is_allowed() {
  case "$1" in
    mcp__*__*) ;;
    *) return 1 ;;
  esac
  rest=${1#mcp__}
  server=${rest%%__*}
  bare=${rest#*__}
  case "$server" in
    "$SERVER_NAME" | plugin_*_"$SERVER_NAME") ;;
    *) return 1 ;;
  esac
  case "$bare" in
    *__*) return 1 ;;
  esac
  bare=${bare#platty_}
  for allowed in $READ_TOOLS; do
    if [ "$bare" = "$allowed" ]; then
      return 0
    fi
  done
  return 1
}

for tool in $names; do
  if ! is_allowed "$tool"; then
    echo "platty-mcp: $tool is blocked for the platty-mcp-search agents; they may call read-only tools of the Platty MCP server '$SERVER_NAME' only." >&2
    exit 2
  fi
done
exit 0
