#!/usr/bin/env bash
# Print a "Usage:Prices" block (dollars per million tokens) for the given models,
# from OpenRouter's public model list. No key needed.
#
#   prices.sh anthropic/claude-sonnet-5 anthropic/claude-haiku-4.5
#   prices.sh --search sonnet          # list matching ids first
#
# The ids are OpenRouter's. If you call a provider directly, rename each key to
# the exact string in your Llm__Model (for example claude-sonnet-5). Prices are
# the provider's list prices as OpenRouter publishes them; check the provider's
# own page before you set a budget on them.
set -euo pipefail

command -v jq >/dev/null || { echo "needs jq" >&2; exit 1; }
list=$(curl -fsS https://openrouter.ai/api/v1/models)

if [[ "${1:-}" == "--search" ]]; then
  jq -r --arg q "${2:?word to search for}" '.data[].id | select(test($q; "i"))' <<<"$list"
  exit 0
fi

[[ $# -gt 0 ]] || { echo "usage: prices.sh <openrouter-model-id>... | --search <word>" >&2; exit 1; }

jq --argjson ids "$(printf '%s\n' "$@" | jq -R . | jq -s .)" '
  def m(x): (x // "0" | tonumber) * 1000000 | . * 1000 | round / 1000;
  [ .data[] | select(.id as $id | $ids | index($id)) ] as $found
  | ($ids - [ $found[].id ]) as $missing
  | if ($missing | length) > 0 then error("not on OpenRouter: \($missing | join(", "))") else . end
  | { Usage: { Prices: ( $found | map({ key: .id, value: {
        Input: m(.pricing.prompt),
        CachedInput: m(.pricing.input_cache_read // .pricing.prompt),
        Output: m(.pricing.completion) } }) | from_entries ) } }
' <<<"$list"
