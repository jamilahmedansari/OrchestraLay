#!/usr/bin/env node

const [, , command] = process.argv

if (!command) {
  console.error('Usage: orchestralay <submit|status|apply>')
  process.exit(1)
}

if (!['submit', 'status', 'apply'].includes(command)) {
  console.error(`Unknown command: ${command}`)
  process.exit(1)
}

console.error(`The ${command} command is scaffolded but not implemented yet.`)
process.exit(0)