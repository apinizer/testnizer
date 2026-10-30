/**
 * A small MQTT 5.0 broker for tests (issue #284), built on `mqtt-packet` —
 * Aedes 1.x refuses MQTT 5 CONNECT, so the MQTT 5 surface (CONNACK reason
 * codes and properties, SUBACK reason codes, PUBLISH properties, server
 * DISCONNECT with a reason) is asserted against this one.
 *
 * Deliberately small: one session per socket, no persistence, QoS 1 / 2
 * acknowledged, messages fanned out to matching subscriptions (`+` / `#`)
 * with their properties, topic aliases resolved per client.
 *
 *   - `refuse`: answer every CONNECT with this CONNACK reason code;
 *   - topics under `forbidden/` are refused at SUBSCRIBE (0x87);
 *   - `kick(clientId, reasonCode, reasonString)` sends DISCONNECT and closes;
 *   - `connects` / `published` record what clients sent.
 */
import net from 'node:net'
import mqttPacket from 'mqtt-packet'

type Packet = Record<string, unknown> & { cmd: string }

export interface Mqtt5StubBroker {
  port: number
  url: string
  /** Every CONNECT packet received. */
  connects: Packet[]
  /** Every PUBLISH received from a client (after alias resolution). */
  published: Packet[]
  kick: (clientId: string, reasonCode: number, reasonString?: string) => boolean
  close: () => Promise<void>
}

interface Session {
  socket: net.Socket
  clientId: string
  subs: Map<string, number>
  aliases: Map<number, string>
  nextId: number
}

/** MQTT topic filter match (`+` one level, `#` the rest). */
export function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/')
  const t = topic.split('/')
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true
    if (i >= t.length) return false
    if (f[i] !== '+' && f[i] !== t[i]) return false
  }
  return f.length === t.length
}

const OPTS = { protocolVersion: 5 as const }

export async function startMqtt5StubBroker(
  opts: { refuse?: number; connackProperties?: Record<string, unknown> } = {},
): Promise<Mqtt5StubBroker> {
  const sessions = new Set<Session>()
  const connects: Packet[] = []
  const published: Packet[] = []
  const sockets = new Set<net.Socket>()

  const send = (s: Session, packet: Packet): void => {
    if (!s.socket.destroyed) s.socket.write(mqttPacket.generate(packet as never, OPTS))
  }

  const fanOut = (packet: Packet): void => {
    const topic = String(packet.topic)
    for (const s of sessions) {
      let qos = -1
      for (const [filter, q] of s.subs) if (topicMatches(filter, topic)) qos = Math.max(qos, q)
      if (qos < 0) continue
      const props = { ...((packet.properties as Record<string, unknown>) ?? {}) }
      delete props.topicAlias
      const out: Packet = {
        cmd: 'publish',
        topic,
        payload: packet.payload,
        qos: Math.min(qos, Number(packet.qos)),
        retain: false,
        dup: false,
        ...(Object.keys(props).length > 0 ? { properties: props } : {}),
      }
      if (Number(out.qos) > 0) out.messageId = s.nextId++ % 65535 || 1
      send(s, out)
    }
  }

  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    const parser = mqttPacket.parser(OPTS)
    let session: Session | null = null
    parser.on('packet', (raw) => {
      const packet = raw as unknown as Packet
      switch (packet.cmd) {
        case 'connect': {
          connects.push(packet)
          if (opts.refuse) {
            socket.write(
              mqttPacket.generate(
                { cmd: 'connack', sessionPresent: false, reasonCode: opts.refuse } as never,
                OPTS,
              ),
            )
            socket.end()
            return
          }
          session = {
            socket,
            clientId: String(packet.clientId),
            subs: new Map(),
            aliases: new Map(),
            nextId: 1,
          }
          sessions.add(session)
          send(session, {
            cmd: 'connack',
            sessionPresent: false,
            reasonCode: 0,
            properties: { topicAliasMaximum: 10, ...(opts.connackProperties ?? {}) },
          })
          return
        }
        case 'subscribe': {
          if (!session) return
          const subs = packet.subscriptions as Array<{ topic: string; qos: number }>
          const granted = subs.map((sub) => {
            if (sub.topic.startsWith('forbidden/')) return 0x87
            session!.subs.set(sub.topic, sub.qos)
            return sub.qos
          })
          send(session, { cmd: 'suback', messageId: packet.messageId, granted })
          return
        }
        case 'unsubscribe': {
          if (!session) return
          for (const t of packet.unsubscriptions as string[]) session.subs.delete(t)
          send(session, {
            cmd: 'unsuback',
            messageId: packet.messageId,
            granted: (packet.unsubscriptions as string[]).map(() => 0),
          })
          return
        }
        case 'publish': {
          if (!session) return
          const props = (packet.properties as Record<string, unknown>) ?? {}
          let topic = String(packet.topic ?? '')
          const alias = props.topicAlias as number | undefined
          if (alias !== undefined) {
            if (topic) session.aliases.set(alias, topic)
            else topic = session.aliases.get(alias) ?? ''
          }
          const resolved = { ...packet, topic }
          published.push(resolved)
          if (packet.qos === 1) send(session, { cmd: 'puback', messageId: packet.messageId })
          if (packet.qos === 2) send(session, { cmd: 'pubrec', messageId: packet.messageId })
          fanOut(resolved)
          return
        }
        case 'pubrel':
          if (session) send(session, { cmd: 'pubcomp', messageId: packet.messageId })
          return
        case 'pingreq':
          if (session) send(session, { cmd: 'pingresp' })
          return
        case 'disconnect':
          socket.end()
          return
        default:
          return
      }
    })
    socket.on('data', (buf) => parser.parse(buf))
    socket.on('close', () => {
      if (session) sessions.delete(session)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port

  return {
    port,
    url: `mqtt://127.0.0.1:${port}`,
    connects,
    published,
    kick: (clientId, reasonCode, reasonString) => {
      for (const s of sessions) {
        if (s.clientId !== clientId) continue
        send(s, {
          cmd: 'disconnect',
          reasonCode,
          ...(reasonString ? { properties: { reasonString } } : {}),
        })
        s.socket.end()
        return true
      }
      return false
    },
    close: async () => {
      for (const s of sockets) s.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
