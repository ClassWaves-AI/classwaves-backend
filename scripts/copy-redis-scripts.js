#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const srcDir = path.resolve(__dirname, '../src/redis-scripts')
const destDir = path.resolve(__dirname, '../dist/redis-scripts')

if (!fs.existsSync(srcDir)) {
  process.exit(0)
}

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true })
}

for (const file of fs.readdirSync(srcDir)) {
  if (!file.endsWith('.lua')) {
    continue
  }
  const src = path.join(srcDir, file)
  const dest = path.join(destDir, file)
  fs.copyFileSync(src, dest)
}

