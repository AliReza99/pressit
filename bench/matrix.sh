#!/usr/bin/env bash
# usage: bench/matrix.sh TAG REPS [PARALLEL] [CELLS]
# CELLS: all (default), on, off or bare. Runs every model x scenario for those cells.
tag=$1; reps=${2:-1}; par=${3:-7}; cells=${4:-all}
dir=$(dirname "$0")
jobs=()
for rep in $(seq 1 "$reps"); do
  for model in haiku sonnet opus; do
    [[ $cells == all || $cells == on ]] && for sc in vague web task explicit; do jobs+=("$model $sc on dev $rep"); done
    [[ $cells == all || $cells == off ]] && for sc in vague web task; do jobs+=("$model $sc off dev $rep"); done
    [[ $cells == all || $cells == bare ]] && for sc in vague web task; do jobs+=("$model $sc off bare $rep"); done
  done
done
printf '%s\n' "${jobs[@]}" | xargs -P "$par" -L 1 sh -c 'python3 -I '"$dir"'/run.py --model $0 --scenario $1 --mcp $2 --env $3 --rep $4 --tag '"$tag"
