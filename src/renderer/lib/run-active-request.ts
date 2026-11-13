/**
 * The "run the active request" action behind Ctrl/Cmd+Enter, the command
 * palette's Send (issue #165) and the request editors' Monaco chord — ONE
 * dispatch by the active tab's protocol, so they can never disagree.
 *
 * The rule: the chord does what the protocol's primary button on screen
 * does, behind that button's own disabled / busy gate. It never cancels,
 * disconnects or unsubscribes — a "send" key that stops a running call would
 * surprise (Insomnia toggles the WebSocket connection on its send key; we
 * deliberately do not). Each branch calls the protocol store's existing
 * action, so the withheld-credential reload and masking guards in those
 * actions apply unchanged.
 *
 * Allow-list: a protocol not listed here (AI Chat, Runner, mocks, examples,
 * Tools, no tab, the blank protocol picker) does nothing — in particular it
 * never falls back to an HTTP send of a stale slice (tester finding 10).
 */
import { useTabsStore } from '../stores/tabs.store'
import { useRequestStore } from '../stores/request.store'
import { useResponseStore } from '../stores/response.store'
import { useMcpStore } from '../stores/mcp.store'
import { useGraphQLStore } from '../stores/graphql.store'
import { useSoapStore } from '../stores/soap.store'
import { useGrpcStore } from '../stores/grpc.store'
import { useWebSocketStore } from '../stores/websocket.store'
import { useSocketIOStore } from '../stores/socketio.store'
import { useMqttStore } from '../stores/mqtt.store'
import { useSseStore } from '../stores/sse.store'
import { chooseGraphqlOperation } from '../../shared/graphql-row'
import { editorProtocol, isBlankScratchTab } from './tab-kind'

type Dispatch = void | Promise<void>
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * GraphQL: Run for a query / mutation, Subscribe for a subscription
 * operation. Also the URL field's Enter (`GraphQLQueryPane`), so both read
 * the same rule. A running subscription or query is left alone.
 */
export function runGraphqlPrimaryAction(): Dispatch {
  const s = useGraphQLStore.getState()
  if (s.subscriptionState === 'connecting' || s.subscriptionState === 'connected') return
  if (chooseGraphqlOperation(s.query, s.operationName).isSubscription) return s.subscribe()
  if (s.isLoading) return
  return s.executeQuery()
}

function runSoap(): Dispatch {
  const s = useSoapStore.getState()
  // The Send button: in flight it is Cancel; with a WSDL parsed it needs an operation.
  if (useResponseStore.getState().isLoading) return
  if (s.mode === 'wsdl' && s.parsedWsdl && !s.selectedOperation) return
  return s.sendSoap()
}

function runGrpc(): Dispatch {
  const s = useGrpcStore.getState()
  const sendable =
    s.protoLoaded ||
    (s.protoSource === 'url' && !!s.protoUrl.trim() && !!s.selectedService && !!s.selectedMethod)
  if (!sendable || !s.selectedService || !s.selectedMethod) return
  if (s.isStreaming) {
    // An open client / bidi stream takes the next message (its Send button);
    // a server stream only offers Cancel, and after End Streaming nothing.
    const type = s.getSelectedMethod()?.type
    const writable = type === 'client_streaming' || type === 'bidi_streaming'
    return writable && !s.halfClosed ? s.execute() : undefined
  }
  if (s.isLoading) return
  return s.execute()
}

/** Realtime: Connect when not connected, the composer's Send when connected. */
function realtime(
  state: ConnectionState,
  connect: () => Promise<void>,
  send: (() => Dispatch) | null,
): Dispatch {
  if (state === 'connecting') return
  if (state !== 'connected') return connect()
  return send ? send() : undefined
}

export function runActiveRequest(): Dispatch {
  const { tabs, activeTabId } = useTabsStore.getState()
  const active = tabs.find((t) => t.id === activeTabId)
  // No tab, or the protocol picker of a blank tab: there is no Send on screen.
  if (!active || isBlankScratchTab(active)) return
  switch (editorProtocol(active)) {
    case 'http':
      // In flight the Send button is Cancel — the chord never starts a second send.
      if (useResponseStore.getState().isLoading) return
      return useRequestStore.getState().sendRequest()
    case 'mcp':
      useMcpStore.getState().runPrimaryAction()
      return
    case 'graphql':
      return runGraphqlPrimaryAction()
    case 'soap':
      return runSoap()
    case 'grpc':
      return runGrpc()
    case 'websocket': {
      const s = useWebSocketStore.getState()
      return realtime(s.connectionState, s.connect, () =>
        s.composerContent.trim() ? s.sendMessage() : undefined,
      )
    }
    case 'socketio': {
      // Emit is enabled with any arguments (an empty event name sends `message`).
      const s = useSocketIOStore.getState()
      return realtime(s.connectionState, s.connect, () => s.emit())
    }
    case 'mqtt': {
      const s = useMqttStore.getState()
      return realtime(s.connectionState, s.connect, () =>
        s.composer.topic.trim() ? s.publish() : undefined,
      )
    }
    case 'sse': {
      // A one-way stream: nothing to send once connected.
      const s = useSseStore.getState()
      return realtime(s.connectionState, s.connect, null)
    }
    default:
      return
  }
}
