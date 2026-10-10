/**
 * Send≡Run parity fixtures for scripts on MCP results (issues #160, #161).
 *
 * Each case is an MCP call outcome (`McpCallOutcome`, `src/shared/mcp-response.ts`)
 * plus a post-response script and the deterministic env writes / test outcomes
 * it must produce. The Run half (`tests/main/mcp-script-parity.test.ts`) feeds
 * the outcome through the Collection Runner (engine one-shot call mocked); the
 * Send half (renderer) must feed the SAME outcome through its MCP post-call
 * script path — `mcpOutcomeToResponse` → `pm.response`, `mcpScriptInfo` →
 * `pm.mcp`, assertions on the same `NormalizedResponse`. Identical fixtures +
 * identical expectations on both sides = parity proof.
 */
import type { McpCallOutcome } from '../../src/shared/mcp-response'

export interface McpParityCase {
  name: string
  outcome: McpCallOutcome
  /** Post-response (Tests) script. */
  script: string
  /** Declarative assertion rows (RequestEditor "Tests" table shape). */
  assertions?: Array<Record<string, unknown>>
  /** Deterministic env writes (subset match). */
  expectEnv: Record<string, string>
  /** pm.test() / assertion-row outcomes, by name. */
  expectTests: Array<{ name: string; passed: boolean }>
  /** The endpoint verdict (`endpointDidPass`). */
  expectPassed: boolean
}

const timing = { durationMs: 12, sizeBytes: 64 }

export const mcpParityCases: McpParityCase[] = [
  {
    name: 'text tool: pm.response.text() + pm.mcp + env write',
    outcome: {
      capability: 'tool',
      name: 'echo',
      result: { content: [{ type: 'text', text: 'token-xyz' }] },
      timing,
    },
    script: `
      pm.environment.set('mcpTok', pm.response.text());
      pm.test('code 200', () => pm.expect(pm.response.code).to.equal(200));
      pm.test('mcp view', () => {
        pm.expect(pm.mcp.capability).to.equal('tool');
        pm.expect(pm.mcp.name).to.equal('echo');
        pm.expect(pm.mcp.isError).to.equal(false);
        pm.expect(pm.mcp.content[0].text).to.equal('token-xyz');
      });
      pm.test('timing', () => pm.expect(pm.response.responseTime).to.equal(12));
    `,
    assertions: [
      { id: 'a', name: 'row: status 200', type: 'status_equals', enabled: true, expected: 200 },
      { id: 'b', name: 'row: body', type: 'body_contains', enabled: true, expected: 'token' },
    ],
    expectEnv: { mcpTok: 'token-xyz' },
    expectTests: [
      { name: 'row: status 200', passed: true },
      { name: 'row: body', passed: true },
      { name: 'code 200', passed: true },
      { name: 'mcp view', passed: true },
      { name: 'timing', passed: true },
    ],
    expectPassed: true,
  },
  {
    name: 'structuredContent: pm.response.json() + content-type + jsonpath row',
    outcome: {
      capability: 'tool',
      name: 'sum',
      result: { content: [{ type: 'text', text: '5' }], structuredContent: { sum: 5 } },
      timing,
    },
    script: `
      const j = pm.response.json();
      pm.environment.set('sum', String(j.sum));
      pm.test('json', () => pm.expect(j).to.eql({ sum: 5 }));
      pm.test('ct', () => pm.expect(pm.response.headers.get('content-type')).to.equal('application/json'));
      pm.test('structured', () => pm.expect(pm.mcp.structuredContent.sum).to.equal(5));
    `,
    assertions: [
      {
        id: 'j',
        name: 'row: $.sum',
        type: 'body_jsonpath',
        enabled: true,
        jsonPath: '$.sum',
        expected: '5',
      },
    ],
    expectEnv: { sum: '5' },
    expectTests: [
      { name: 'row: $.sum', passed: true },
      { name: 'json', passed: true },
      { name: 'ct', passed: true },
      { name: 'structured', passed: true },
    ],
    expectPassed: true,
  },
  {
    name: 'isError tool with no checks → failed verdict (500 Tool Error)',
    outcome: {
      capability: 'tool',
      name: 'fail',
      result: { content: [{ type: 'text', text: 'nope' }], isError: true },
      timing,
    },
    script: `pm.environment.set('status', pm.response.status + ' ' + pm.response.code);`,
    expectEnv: { status: 'Tool Error 500' },
    expectTests: [],
    expectPassed: false,
  },
  {
    name: 'isError tool expected by a test → passed verdict',
    outcome: {
      capability: 'tool',
      name: 'fail',
      result: { content: [{ type: 'text', text: 'nope' }], isError: true },
      timing,
    },
    script: `pm.test('expected error', () => pm.expect(pm.mcp.isError).to.be.true);`,
    expectEnv: {},
    expectTests: [{ name: 'expected error', passed: true }],
    expectPassed: true,
  },
  {
    name: 'resource: text contents + insomnia alias sees pm.mcp',
    outcome: {
      capability: 'resource',
      name: 'test://greeting',
      result: { contents: [{ uri: 'test://greeting', text: 'Hello' }] },
      timing,
    },
    script: `
      pm.test('text', () => pm.expect(pm.response.text()).to.equal('Hello'));
      pm.test('alias', () => pm.expect(insomnia.mcp.capability).to.equal('resource'));
    `,
    expectEnv: {},
    expectTests: [
      { name: 'text', passed: true },
      { name: 'alias', passed: true },
    ],
    expectPassed: true,
  },
  {
    name: 'prompt: messages JSON',
    outcome: {
      capability: 'prompt',
      name: 'summarize',
      result: { messages: [{ role: 'user', content: { type: 'text', text: 'Sum: abc' } }] },
      timing,
    },
    script: `
      pm.test('messages', () => pm.expect(pm.response.json()[0].role).to.equal('user'));
      pm.test('count', () => pm.expect(pm.mcp.content.length).to.equal(1));
    `,
    expectEnv: {},
    expectTests: [
      { name: 'messages', passed: true },
      { name: 'count', passed: true },
    ],
    expectPassed: true,
  },
  {
    name: 'a failing pm.test fails the verdict',
    outcome: {
      capability: 'tool',
      name: 'echo',
      result: { content: [{ type: 'text', text: 'a' }] },
      timing,
    },
    script: `pm.test('wrong', () => pm.expect(pm.response.text()).to.equal('b'));`,
    expectEnv: {},
    expectTests: [{ name: 'wrong', passed: false }],
    expectPassed: false,
  },
]
