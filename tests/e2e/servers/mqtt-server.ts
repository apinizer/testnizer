/**
 * MQTT broker for the e2e suite (issue #284): the same Aedes broker the engine
 * unit tests use (`tests/helpers/mqtt-aedes-broker.ts`), on the port the
 * supervisor picked. MQTT 3.1.1 only — Aedes rejects an MQTT 5 CONNECT.
 *
 * Non-fatal on purpose: every e2e run — the CI smoke hard gate on all three
 * platforms included — boots its servers through one supervisor, and a broker
 * that cannot start (Aedes is ESM-only and needs Node ≥ 20.10) must not take
 * the whole gate down. The failure is logged, `urls.mqtt` is left out and the
 * MQTT spec skips; the engine unit tests still fail loudly on such a Node.
 */
import { startAedesBroker, type AedesTestBroker } from '../../helpers/mqtt-aedes-broker'

export type MqttServer = AedesTestBroker

export async function startMqttServer(port: number): Promise<MqttServer | null> {
  try {
    return await startAedesBroker({ port })
  } catch (err) {
    console.error('[e2e-servers] MQTT broker did not start; MQTT specs will skip:', err)
    return null
  }
}
