/**
 * MQTT broker for the e2e suite (issue #284): the same Aedes broker the engine
 * unit tests use (`tests/helpers/mqtt-aedes-broker.ts`), on the port the
 * supervisor picked. MQTT 3.1.1 only — Aedes rejects an MQTT 5 CONNECT.
 */
import { startAedesBroker, type AedesTestBroker } from '../../helpers/mqtt-aedes-broker'

export type MqttServer = AedesTestBroker

export function startMqttServer(port: number): Promise<MqttServer> {
  return startAedesBroker({ port })
}
