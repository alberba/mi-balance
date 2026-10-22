#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p "Mi Balance.app/Contents/MacOS"
swiftc tools/scan.swift -o tools/scale-scan
swiftc app/macos.swift -o "Mi Balance.app/Contents/MacOS/MiBalance" -framework Cocoa -framework WebKit
cp app/Info.plist "Mi Balance.app/Contents/Info.plist"
echo "Lista: Mi Balance.app"
