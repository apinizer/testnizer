import path from 'node:path'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'

export interface GrpcServer {
  port: number
  address: string
  close: () => Promise<void>
}

export async function startGrpcServer(port: number): Promise<GrpcServer> {
  const protoPath = path.join(__dirname, 'echo.proto')

  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })
  const proto = grpc.loadPackageDefinition(packageDefinition) as grpc.GrpcObject
  const echoPkg = proto.echo as grpc.GrpcObject
  const EchoService = echoPkg.EchoService as grpc.ServiceClientConstructor

  const server = new grpc.Server()
  server.addService(EchoService.service, {
    UnaryEcho: (
      call: grpc.ServerUnaryCall<{ message: string }, { message: string }>,
      callback: grpc.sendUnaryData<{ message: string }>,
    ) => {
      callback(null, { message: `echo: ${call.request.message}` })
    },
  })

  const address = `127.0.0.1:${port}`
  await new Promise<void>((resolve, reject) => {
    server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (err) => {
      if (err) reject(err)
      else {
        server.start()
        resolve()
      }
    })
  })

  return {
    port,
    address,
    close: () =>
      new Promise((resolve, reject) => {
        server.tryShutdown((err) => (err ? reject(err) : resolve()))
      }),
  }
}
