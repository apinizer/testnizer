/**
 * What a gRPC row opens with. A tab restores from `request_schema.metadata.grpc`
 * (`restoreProtocolFromMetadata`), and `services` is what makes the selection
 * usable: the dropdowns list it, and Send reads the method's streaming type from it.
 *
 * The `.proto` importer used to write only a top-level `request_schema.grpc`, which
 * no opener read, so those rows opened with no proto, service or method. Rows from
 * then still exist: `protocolMetadataOf` reads them the same way.
 */
export interface ImportedGrpcCall {
  protoPath?: unknown
  serviceName?: unknown
  methodName?: unknown
  requestType?: unknown
  responseType?: unknown
  requestStream?: unknown
  responseStream?: unknown
  serverAddress?: unknown
}

function methodType(call: ImportedGrpcCall): string {
  if (call.requestStream && call.responseStream) return 'bidi_streaming'
  if (call.requestStream) return 'client_streaming'
  if (call.responseStream) return 'server_streaming'
  return 'unary'
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The `metadata` of an imported method: `snapshotProtocol`'s block, one method listed. */
export function importedGrpcMetadata(
  call: ImportedGrpcCall,
  requestBody: string,
): { grpc: Record<string, unknown> } {
  const address = text(call.serverAddress)
  return {
    grpc: {
      address,
      // A proto says nothing about TLS; 443 is the one port that does.
      useTls: /:443$/.test(address),
      protoSource: 'file',
      protoPath: text(call.protoPath),
      selectedService: text(call.serviceName),
      selectedMethod: text(call.methodName),
      services: [
        {
          name: text(call.serviceName),
          methods: [
            {
              name: text(call.methodName),
              type: methodType(call),
              requestType: text(call.requestType),
              responseType: text(call.responseType),
            },
          ],
        },
      ],
      requestBody,
      metadata: [],
    },
  }
}

/** The block an opener hands to `restoreProtocolFromMetadata`, for a parsed `request_schema`. */
export function protocolMetadataOf(schema: {
  metadata?: unknown
  grpc?: unknown
  body?: unknown
}): unknown {
  if (schema.metadata || !schema.grpc || typeof schema.grpc !== 'object') return schema.metadata
  const content = (schema.body as { content?: unknown } | null | undefined)?.content
  return importedGrpcMetadata(schema.grpc as ImportedGrpcCall, text(content))
}
