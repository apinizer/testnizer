#!/usr/bin/env node
/**
 * Minimal MCP stdio server stub for E2E test MST-148.
 * Implements the JSON-RPC 2.0 MCP protocol over stdio.
 * Registers one tool: "ping" that returns "pong".
 */
'use strict'

const readline = require('readline')

const rl = readline.createInterface({ input: process.stdin, terminal: false })

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

let initialized = false

rl.on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }

  const id = msg.id ?? null

  if (msg.method === 'initialize') {
    initialized = true
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-stdio-stub', version: '1.0.0' },
      },
    })
    return
  }

  if (msg.method === 'notifications/initialized') {
    // notification — no response
    return
  }

  if (!initialized) {
    send({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Not initialized' } })
    return
  }

  if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'ping',
            description: 'Returns pong',
            inputSchema: { type: 'object', properties: {}, required: [] },
          },
          {
            name: 'fail',
            description: 'Always returns an error result',
            inputSchema: { type: 'object', properties: {}, required: [] },
          },
        ],
      },
    })
    return
  }

  if (msg.method === 'tools/call') {
    const toolName = msg.params?.name
    if (toolName === 'ping') {
      send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: 'pong' }] },
      })
    } else if (toolName === 'fail') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: 'error: tool intentionally failed' }],
          isError: true,
        },
      })
    } else {
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown tool: ${toolName}` },
      })
    }
    return
  }

  // Fallback
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${msg.method}` } })
})

// Keep alive until stdin closes
process.stdin.resume()
process.stdin.on('end', () => process.exit(0))
