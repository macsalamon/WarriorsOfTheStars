#!/bin/sh
# Double-click this file in Finder to start Warriors of the Stars with a tunnel to the internet (it does the same as start-internet.sh).
cd "$(dirname "$0")" || exit 1
exec sh ./start-internet.sh
